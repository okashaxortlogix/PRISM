// PRISM Header Spoofing & Identity Tampering Security Test Suite
// Verifies that untrusted client headers (x-prism-user-id, x-prism-org-id) are never trusted
const assert = require('node:assert');
const app = require('../../src/server');
const { getDatabase } = require('../../src/db/database');
const {
  createTestOrganization,
  createTestUser,
  createMembership,
  authenticateAs
} = require('./testHelpers');

async function runHeaderSpoofingTests() {
  console.log('\n=====================================================');
  console.log('🛡️ RUNNING HEADER SPOOFING & IDENTITY TAMPERING TESTS');
  console.log('=====================================================');

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const db = getDatabase();

  try {
    const orgA = createTestOrganization('Org Spoof Target A');
    const orgB = createTestOrganization('Org Spoof Victim B');

    const userA = createTestUser(`attacker_${Date.now()}@spoof.internal`, 'Pass12345!', 'Attacker A');
    const userB = createTestUser(`victim_${Date.now()}@spoof.internal`, 'Pass12345!', 'Victim B');

    createMembership(userA.id, orgA.id, 'OWNER');
    createMembership(userB.id, orgB.id, 'OWNER');

    const tokenA = authenticateAs(userA.id, orgA.id);

    // Create a secret project in Org B
    const now = new Date().toISOString();
    const projBId = `prj_victim_${Date.now().toString(36)}`;
    db.prepare(`
      INSERT INTO projects (id, organization_id, name, description, status, created_at, updated_at)
      VALUES (?, ?, 'Victim Confidential Project', 'Secret', 'ACTIVE', ?, ?)
    `).run(projBId, orgB.id, now, now);

    // 1. Unauthenticated request with x-prism-user-id and x-prism-org-id headers MUST FAIL with 401
    console.log('Test 1: Unauthenticated request attempting header-based impersonation');
    const unauthSpoof = await fetch(`${baseUrl}/api/v1/projects`, {
      headers: {
        'x-prism-user-id': userB.id,
        'x-prism-org-id': orgB.id
      }
    });
    assert.strictEqual(unauthSpoof.status, 401, 'Headers x-prism-user-id / x-prism-org-id alone MUST NOT grant access');
    console.log('  ✔ Server rejected header-only impersonation with 401 UNAUTHORIZED');

    // 2. Authenticated User A sending x-prism-user-id: User B and x-prism-org-id: Org B
    console.log('Test 2: Authenticated User A attempting header spoofing to become User B in Org B');
    const authSpoofMe = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: {
        'Authorization': `Bearer ${tokenA}`,
        'x-prism-user-id': userB.id,
        'x-prism-org-id': orgB.id
      }
    });
    const authSpoofMeData = await authSpoofMe.json();
    assert.strictEqual(authSpoofMe.status, 200);
    // Identity must strictly remain User A and Org A
    assert.strictEqual(authSpoofMeData.data.user.id, userA.id, 'Identity MUST NOT be spoofed by x-prism-user-id');
    assert.strictEqual(authSpoofMeData.data.organization.id, orgA.id, 'Organization MUST NOT be spoofed by x-prism-org-id');
    console.log('  ✔ Server ignored x-prism-user-id / x-prism-org-id; identity remained User A in Org A');

    // 3. User A attempts to access Org B project using spoofed headers
    console.log('Test 3: User A attempts to access Org B project using spoofed headers');
    const spoofProjectAccess = await fetch(`${baseUrl}/api/v1/projects/${projBId}`, {
      headers: {
        'Authorization': `Bearer ${tokenA}`,
        'x-prism-user-id': userB.id,
        'x-prism-org-id': orgB.id
      }
    });
    assert.strictEqual(spoofProjectAccess.status, 404, 'User A must not access Org B project even with spoof headers');
    console.log('  ✔ Access to victim project denied (404 NOT FOUND)');

    // 4. User A attempts x-organization-id header to switch to Org B without membership
    console.log('Test 4: User A attempts x-organization-id to switch to Org B without membership');
    const unauthorizedOrgSwitch = await fetch(`${baseUrl}/api/v1/projects`, {
      headers: {
        'Authorization': `Bearer ${tokenA}`,
        'x-organization-id': orgB.id
      }
    });
    assert.strictEqual(unauthorizedOrgSwitch.status, 403, 'Attempting to switch to un-membered org must be 403 FORBIDDEN');
    const deniedData = await unauthorizedOrgSwitch.json();
    assert.strictEqual(deniedData.error.code, 'FORBIDDEN');
    console.log('  ✔ Server returned 403 FORBIDDEN and blocked organization switch');

    // 5. Verify security audit event was recorded for authorization denial
    const auditRecord = db.prepare(`
      SELECT * FROM audit_events 
      WHERE actor_id = ? AND event_type = 'AUTHORIZATION_DENIED'
      ORDER BY created_at DESC LIMIT 1
    `).get(userA.id);
    assert.ok(auditRecord, 'Security audit must record AUTHORIZATION_DENIED event');
    assert.strictEqual(auditRecord.target_id, orgB.id);
    console.log('  ✔ Security audit log confirmed: AUTHORIZATION_DENIED recorded for actor A');

    console.log('\n✔ ALL HEADER SPOOFING & TAMPERING TESTS PASSED (100% GREEN)');
  } finally {
    server.close();
  }
}

if (require.main === module) {
  runHeaderSpoofingTests().catch(err => {
    console.error('❌ Header spoofing test suite failed:', err);
    process.exit(1);
  });
}

module.exports = { runHeaderSpoofingTests };
