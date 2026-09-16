// PRISM Security Test Helpers
// Provides reusable factories and assertion helpers for security test suites
const assert = require('node:assert');
const crypto = require('node:crypto');
const { getDatabase } = require('../../src/db/database');
const { hashPassword } = require('../../src/security/passwordService');
const { createSession } = require('../../src/security/sessionService');

/**
 * Creates a test organization
 */
function createTestOrganization(name = 'Test Org') {
  const db = getDatabase();
  const id = `org_test_${crypto.randomUUID().substring(0, 8)}`;
  const slug = `slug-${crypto.randomUUID().substring(0, 8)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO organizations (id, name, slug, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, name, slug, now, now);

  return { id, name, slug };
}

/**
 * Creates a test user with hashed password
 */
function createTestUser(email, password = 'TestPassword2026!', displayName = 'Test User') {
  const db = getDatabase();
  const id = `usr_test_${crypto.randomUUID().substring(0, 8)}`;
  const passwordHash = hashPassword(password);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)
  `).run(id, email.toLowerCase(), passwordHash, displayName, now, now);

  return { id, email: email.toLowerCase(), displayName };
}

/**
 * Creates organization membership
 */
function createMembership(userId, organizationId, role = 'MEMBER') {
  const db = getDatabase();
  const id = `mem_${crypto.randomUUID().substring(0, 8)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO organization_memberships (id, user_id, organization_id, role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)
  `).run(id, userId, organizationId, role, now, now);

  return { id, userId, organizationId, role };
}

/**
 * Creates a valid session and returns raw bearer token
 */
function authenticateAs(userId, organizationId) {
  const session = createSession(userId, organizationId);
  return session.token;
}

/**
 * Assert response is 401 Unauthorized
 */
function assertUnauthorized(res, message = 'Expected 401 Unauthorized') {
  assert.strictEqual(res.statusCode, 401, message);
}

/**
 * Assert response is 403 Forbidden
 */
function assertForbidden(res, message = 'Expected 403 Forbidden') {
  assert.strictEqual(res.statusCode, 403, message);
}

/**
 * Assert response is 404 Not Found
 */
function assertNotFound(res, message = 'Expected 404 Not Found') {
  assert.strictEqual(res.statusCode, 404, message);
}

module.exports = {
  createTestOrganization,
  createTestUser,
  createMembership,
  authenticateAs,
  assertUnauthorized,
  assertForbidden,
  assertNotFound
};
