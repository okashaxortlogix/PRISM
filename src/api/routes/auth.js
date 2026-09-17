// PRISM Authentication API Route
// Strictly adheres to P0-01 Security & Identity Specification
const express = require('express');
const router = express.Router();
const crypto = require('node:crypto');
const { getDatabase } = require('../../db/database');
const { validatePasswordStrength, hashPassword, verifyPassword } = require('../../security/passwordService');
const { createSession, revokeSession, switchSessionOrganization } = require('../../security/sessionService');
const { authenticate } = require('../../security/authMiddleware');
const { loginRateLimiter, registerRateLimiter } = require('../../security/rateLimiter');
const { recordSecurityAudit } = require('../../security/auditService');

// Email regex validation
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/v1/auth/register
router.post('/register', registerRateLimiter.middleware(), (req, res) => {
  try {
    const email = req.body.email;
    const password = req.body.password;
    const displayName = req.body.displayName || req.body.display_name;
    const organizationName = req.body.organizationName || req.body.organization_name;

    // 1. Input Validation
    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A valid email address is required.' }
      });
    }

    if (!displayName || typeof displayName !== 'string' || displayName.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Display name must be at least 2 characters long.' }
      });
    }

    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        success: false,
        error: { code: 'WEAK_PASSWORD', message: passwordValidation.message }
      });
    }

    const db = getDatabase();
    const cleanEmail = email.trim().toLowerCase();

    // 2. Check duplicate email
    const existing = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(cleanEmail);
    if (existing) {
      return res.status(409).json({
        success: false,
        error: { code: 'DUPLICATE_ACCOUNT', message: 'An account with this email already exists.' }
      });
    }

    const userId = `usr_${crypto.randomUUID().substring(0, 8)}`;
    const orgId = `org_${crypto.randomUUID().substring(0, 8)}`;
    const membershipId = `mem_${crypto.randomUUID().substring(0, 8)}`;
    const now = new Date().toISOString();

    const passwordHash = hashPassword(password);
    const orgName = (organizationName && typeof organizationName === 'string' && organizationName.trim()) 
      ? organizationName.trim() 
      : `${displayName.trim()}'s Workspace`;
    
    const slugBase = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'workspace';
    const slug = `${slugBase}-${crypto.randomBytes(3).toString('hex')}`;

    // 3. Atomically create User, Organization, and Membership
    db.prepare(`
      INSERT INTO organizations (id, name, slug, status, created_at, updated_at)
      VALUES (?, ?, ?, 'ACTIVE', ?, ?)
    `).run(orgId, orgName, slug, now, now);

    db.prepare(`
      INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)
    `).run(userId, cleanEmail, passwordHash, displayName.trim(), now, now);

    db.prepare(`
      INSERT INTO organization_memberships (id, organization_id, user_id, role, status, created_at, updated_at)
      VALUES (?, ?, ?, 'OWNER', 'ACTIVE', ?, ?)
    `).run(membershipId, orgId, userId, now, now);

    // 4. Create Session
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const session = createSession({
      userId,
      activeOrganizationId: orgId,
      ipAddress: ip,
      userAgent
    });

    // 5. Audit Event
    recordSecurityAudit({
      organizationId: orgId,
      actorId: userId,
      eventType: 'USER_REGISTERED',
      targetType: 'USER',
      targetId: userId,
      metadata: { email: cleanEmail, orgName }
    });

    recordSecurityAudit({
      organizationId: orgId,
      actorId: userId,
      eventType: 'SESSION_CREATED',
      targetType: 'SESSION',
      targetId: session.sessionId,
      metadata: { ip }
    });

    // Set secure cookie
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
    const cookieFlags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${isSecure ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', `prism_session=${session.rawToken}; ${cookieFlags}`);

    res.status(201).json({
      success: true,
      data: {
        expiresAt: session.expiresAt,
        role: 'OWNER',
        user: {
          id: userId,
          email: cleanEmail,
          displayName: displayName.trim()
        },
        organization: {
          id: orgId,
          name: orgName,
          slug,
          role: 'OWNER'
        }
      }
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Registration failed due to an internal error.' }
    });
  }
});

// POST /api/v1/auth/login
router.post('/login', loginRateLimiter.middleware(), (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Email and password are required.' }
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const db = getDatabase();

    // 1. Fetch user by email
    const user = db.prepare(`
      SELECT id, email, password_hash, display_name, status
      FROM users
      WHERE lower(email) = ?
    `).get(cleanEmail);

    if (!user || user.status !== 'ACTIVE') {
      recordSecurityAudit({
        organizationId: 'system',
        actorId: 'anonymous',
        eventType: 'LOGIN_FAILURE',
        targetType: 'USER',
        targetId: cleanEmail,
        metadata: { reason: 'User not found or inactive' }
      });

      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }
      });
    }

    // 2. Verify password
    const valid = verifyPassword(password, user.password_hash);
    if (!valid) {
      let auditOrg = 'system';
      const userOrg = db.prepare('SELECT organization_id FROM organization_memberships WHERE user_id = ? LIMIT 1').get(user.id);
      if (userOrg) auditOrg = userOrg.organization_id;

      recordSecurityAudit({
        organizationId: auditOrg,
        actorId: user.id,
        eventType: 'LOGIN_FAILURE',
        targetType: 'USER',
        targetId: user.id,
        metadata: { reason: 'Password mismatch' }
      });

      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }
      });
    }

    // 3. Resolve active organization from memberships
    const membership = db.prepare(`
      SELECT m.organization_id, m.role, o.name as organization_name, o.slug as organization_slug
      FROM organization_memberships m
      JOIN organizations o ON m.organization_id = o.id
      WHERE m.user_id = ? AND m.status = 'ACTIVE' AND o.status = 'ACTIVE'
      ORDER BY m.created_at ASC
    `).get(user.id);

    if (!membership) {
      return res.status(403).json({
        success: false,
        error: { code: 'NO_ACTIVE_MEMBERSHIP', message: 'User does not belong to any active organization.' }
      });
    }

    // 4. Create Session
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const session = createSession({
      userId: user.id,
      activeOrganizationId: membership.organization_id,
      ipAddress: ip,
      userAgent
    });

    // 5. Audit Login Success
    recordSecurityAudit({
      organizationId: membership.organization_id,
      actorId: user.id,
      eventType: 'LOGIN_SUCCESS',
      targetType: 'USER',
      targetId: user.id,
      metadata: { ip }
    });

    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
    const cookieFlags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${isSecure ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', `prism_session=${session.rawToken}; ${cookieFlags}`);

    res.json({
      success: true,
      data: {
        expiresAt: session.expiresAt,
        role: membership.role,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name
        },
        organization: {
          id: membership.organization_id,
          name: membership.organization_name,
          slug: membership.organization_slug,
          role: membership.role
        }
      }
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Login failed due to an internal error.' }
    });
  }
});

// POST /api/v1/auth/logout
router.post('/logout', (req, res) => {
  try {
    let token = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.headers['cookie']) {
      const match = req.headers['cookie'].match(/prism_session=([^;]+)/);
      if (match) token = match[1].trim();
    }

    if (token) {
      revokeSession(token);
    }

    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
    res.setHeader('Set-Cookie', `prism_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure ? '; Secure' : ''}`);
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// GET /api/v1/auth/me
router.get('/me', authenticate, (req, res) => {
  res.json({
    success: true,
    data: {
      user: req.user,
      role: req.role,
      organization: {
        ...req.organization,
        role: req.role
      },
      memberships: req.memberships
    }
  });
});

// POST /api/v1/auth/switch-org
router.post('/switch-org', authenticate, (req, res) => {
  try {
    const { organizationId } = req.body;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'organizationId is required.' }
      });
    }

    const switched = switchSessionOrganization(req.sessionId, req.user.id, organizationId);

    recordSecurityAudit({
      organizationId,
      actorId: req.user.id,
      eventType: 'ORGANIZATION_SWITCHED',
      targetType: 'SESSION',
      targetId: req.sessionId,
      metadata: { newOrganizationId: organizationId }
    });

    res.json({
      success: true,
      data: switched
    });
  } catch (err) {
    res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: err.message }
    });
  }
});

module.exports = router;
