// PRISM Session Management Service
// Cryptographically secure, stateful server-managed sessions with SHA-256 token hashing
const crypto = require('node:crypto');
const { getDatabase } = require('../db/database');

const SESSION_DURATION_HOURS = 24;

/**
 * Computes deterministic SHA-256 hash for database token lookup
 */
function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Creates a new authenticated session in SQLite
 */
function createSession(optsOrUserId, activeOrgId) {
  let userId, activeOrganizationId, ipAddress = null, userAgent = null, durationHours = SESSION_DURATION_HOURS;
  if (typeof optsOrUserId === 'object') {
    userId = optsOrUserId.userId;
    activeOrganizationId = optsOrUserId.activeOrganizationId;
    ipAddress = optsOrUserId.ipAddress || null;
    userAgent = optsOrUserId.userAgent || null;
    if (optsOrUserId.durationHours) durationHours = optsOrUserId.durationHours;
  } else {
    userId = optsOrUserId;
    activeOrganizationId = activeOrgId;
  }

  const db = getDatabase();
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const sessionId = `ses_${crypto.randomUUID().substring(0, 10)}`;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationHours * 3600 * 1000).toISOString();

  db.prepare(`
    INSERT INTO sessions (id, token_hash, user_id, active_organization_id, ip_address, user_agent, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, tokenHash, userId, activeOrganizationId, ipAddress, userAgent, expiresAt, now.toISOString());

  return {
    sessionId,
    token: rawToken,
    rawToken,
    expiresAt,
    activeOrganizationId
  };
}

/**
 * Validates a session token and retrieves the associated user, organization, and membership
 */
function validateSession(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') {
    return null;
  }

  const db = getDatabase();
  const tokenHash = hashToken(rawToken);
  const now = new Date().toISOString();

  // Fetch active session with join to user, organization, and active membership
  const sessionRecord = db.prepare(`
    SELECT 
      s.id as session_id,
      s.user_id,
      s.active_organization_id,
      s.expires_at,
      u.email,
      u.display_name,
      u.status as user_status,
      o.name as organization_name,
      o.slug as organization_slug,
      o.status as organization_status,
      m.role,
      m.status as membership_status
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    JOIN organizations o ON s.active_organization_id = o.id
    LEFT JOIN organization_memberships m ON (m.user_id = u.id AND m.organization_id = o.id)
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(tokenHash, now);

  if (!sessionRecord) {
    return null;
  }

  if (sessionRecord.user_status !== 'ACTIVE' || sessionRecord.organization_status !== 'ACTIVE' || sessionRecord.membership_status !== 'ACTIVE') {
    return null;
  }

  // Fetch all organizations the user is a member of (for switching/display)
  const memberships = db.prepare(`
    SELECT 
      m.organization_id,
      m.role,
      o.name as organization_name,
      o.slug as organization_slug
    FROM organization_memberships m
    JOIN organizations o ON m.organization_id = o.id
    WHERE m.user_id = ? AND m.status = 'ACTIVE' AND o.status = 'ACTIVE'
  `).all(sessionRecord.user_id);

  return {
    sessionId: sessionRecord.session_id,
    user: {
      id: sessionRecord.user_id,
      email: sessionRecord.email,
      displayName: sessionRecord.display_name
    },
    organization: {
      id: sessionRecord.active_organization_id,
      name: sessionRecord.organization_name,
      slug: sessionRecord.organization_slug
    },
    role: sessionRecord.role || 'VIEWER',
    memberships,
    expiresAt: sessionRecord.expires_at
  };
}

/**
 * Revokes an individual session token
 */
function revokeSession(rawToken) {
  if (!rawToken) return false;
  const db = getDatabase();
  const tokenHash = hashToken(rawToken);
  const result = db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  return result.changes > 0;
}

/**
 * Revokes all sessions for a specific user
 */
function revokeAllUserSessions(userId) {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  return result.changes;
}

/**
 * Switches the active organization for an existing session after validating membership
 */
function switchSessionOrganization(sessionId, userId, newOrganizationId) {
  const db = getDatabase();

  // Verify that the user is actually a member of the requested organization
  const membership = db.prepare(`
    SELECT role FROM organization_memberships
    WHERE user_id = ? AND organization_id = ? AND status = 'ACTIVE'
  `).get(userId, newOrganizationId);

  if (!membership) {
    throw new Error('Access denied: User is not an active member of this organization.');
  }

  db.prepare(`
    UPDATE sessions
    SET active_organization_id = ?
    WHERE id = ? AND user_id = ?
  `).run(newOrganizationId, sessionId, userId);

  return {
    organizationId: newOrganizationId,
    role: membership.role
  };
}

module.exports = {
  createSession,
  validateSession,
  revokeSession,
  revokeAllUserSessions,
  switchSessionOrganization
};
