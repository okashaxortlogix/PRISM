// PRISM Role-Based Access Control (RBAC) Security Test Suite
// Verifies permissions for OWNER, ADMIN, MEMBER, and VIEWER roles
const assert = require('node:assert');
const app = require('../../src/server');
const { getDatabase } = require('../../src/db/database');
const {
  createTestOrganization,
  createTestUser,
  createMembership,
  authenticateAs
} = require('./testHelpers');

async function runRoleAuthTests() {
  console.log('\n=====================================================');
  console.log('🛡️ RUNNING ROLE-BASED ACCESS CONTROL (RBAC) TESTS');
  console.log('=====================================================');

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const db = getDatabase();

  try {
    const org = createTestOrganization('RBAC Verification Org');

    // Create 4 users with different roles in the same organization
    const owner = createTestUser(`owner_${Date.now()}@test.internal`, 'OwnerPass123!', 'Alice Owner');
    const admin = createTestUser(`admin_${Date.now()}@test.internal`, 'AdminPass123!', 'Bob Admin');
    const member = createTestUser(`member_${Date.now()}@test.internal`, 'MemberPass123!', 'Charlie Member');
    const viewer = createTestUser(`viewer_${Date.now()}@test.internal`, 'ViewerPass123!', 'David Viewer');

    createMembership(owner.id, org.id, 'OWNER');
    createMembership(admin.id, org.id, 'ADMIN');
    createMembership(member.id, org.id, 'MEMBER');
    createMembership(viewer.id, org.id, 'VIEWER');

    const tokenOwner = authenticateAs(owner.id, org.id);
    const tokenAdmin = authenticateAs(admin.id, org.id);
    const tokenMember = authenticateAs(member.id, org.id);
    const tokenViewer = authenticateAs(viewer.id, org.id);

    // 1. VIEWER Role Tests
    console.log('Test 1: VIEWER Role Permissions (Read-Only Enforcement)');
    // VIEWER can read projects
    const viewerGetProjects = await fetch(`${baseUrl}/api/v1/projects`, {
      headers: { 'Authorization': `Bearer ${tokenViewer}` }
    });
    assert.strictEqual(viewerGetProjects.status, 200, 'Viewer should be allowed to view projects');

    // VIEWER cannot create a project (requires ADMIN or OWNER)
    const viewerCreateProj = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenViewer}`
      },
      body: JSON.stringify({ name: 'Unauthorized Viewer Project' })
    });
    assert.strictEqual(viewerCreateProj.status, 403, 'Viewer must not be allowed to create project');
    console.log('  ✔ Viewer blocked from project creation (403 FORBIDDEN)');

    // VIEWER cannot create an investigation (requires MEMBER, ADMIN, OWNER)
    const viewerCreateInv = await fetch(`${baseUrl}/api/v1/investigations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenViewer}`
      },
      body: JSON.stringify({ title: 'Viewer Inv', problem_statement: 'test' })
    });
    assert.strictEqual(viewerCreateInv.status, 403, 'Viewer must not be allowed to create investigation');
    console.log('  ✔ Viewer blocked from investigation creation (403 FORBIDDEN)');

    // VIEWER cannot view audit logs (requires ADMIN or OWNER)
    const viewerGetAudit = await fetch(`${baseUrl}/api/v1/audit`, {
      headers: { 'Authorization': `Bearer ${tokenViewer}` }
    });
    assert.strictEqual(viewerGetAudit.status, 403, 'Viewer must not be allowed to view audit logs');
    console.log('  ✔ Viewer blocked from audit logs (403 FORBIDDEN)');

    // 2. MEMBER Role Tests
    console.log('\nTest 2: MEMBER Role Permissions (Investigation Mutator, No Org Administration)');
    // MEMBER cannot create a project
    const memberCreateProj = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenMember}`
      },
      body: JSON.stringify({ name: 'Unauthorized Member Project' })
    });
    assert.strictEqual(memberCreateProj.status, 403, 'Member must not be allowed to create project');
    console.log('  ✔ Member blocked from project creation (403 FORBIDDEN)');

    // Admin creates project for the org first
    const adminCreateProj = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenAdmin}`
      },
      body: JSON.stringify({ name: 'Admin Created Project' })
    });
    const projData = await adminCreateProj.json();
    assert.strictEqual(adminCreateProj.status, 201, 'Admin must be allowed to create project');

    // MEMBER can create an investigation in this project
    const memberCreateInv = await fetch(`${baseUrl}/api/v1/investigations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenMember}`
      },
      body: JSON.stringify({
        project_id: projData.data.id,
        title: 'Member Created Investigation',
        problem_statement: 'High memory usage'
      })
    });
    const invData = await memberCreateInv.json();
    assert.strictEqual(memberCreateInv.status, 201, 'Member should be allowed to create investigation');
    console.log('  ✔ Member successfully created investigation');

    // MEMBER can add evidence
    const memberAddEvidence = await fetch(`${baseUrl}/api/v1/investigations/${invData.data.id}/evidence`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenMember}`
      },
      body: JSON.stringify({
        type: 'LOG_EVIDENCE',
        title: 'Memory dump stacktrace',
        source: 'kubernetes',
        source_ref: 'pod-mem-1',
        content: 'OOM killed'
      })
    });
    assert.strictEqual(memberAddEvidence.status, 201, 'Member should be allowed to add evidence');
    console.log('  ✔ Member successfully added evidence');

    // MEMBER cannot view audit logs
    const memberGetAudit = await fetch(`${baseUrl}/api/v1/audit`, {
      headers: { 'Authorization': `Bearer ${tokenMember}` }
    });
    assert.strictEqual(memberGetAudit.status, 403, 'Member must not be allowed to view audit logs');
    console.log('  ✔ Member blocked from audit logs (403 FORBIDDEN)');

    // 3. ADMIN Role Tests
    console.log('\nTest 3: ADMIN Role Permissions (Project Administration & Audit View)');
    // ADMIN can view audit logs
    const adminGetAudit = await fetch(`${baseUrl}/api/v1/audit`, {
      headers: { 'Authorization': `Bearer ${tokenAdmin}` }
    });
    assert.strictEqual(adminGetAudit.status, 200, 'Admin should be allowed to view audit logs');
    console.log('  ✔ Admin successfully accessed audit logs');

    // ADMIN can delete project
    const adminDeleteProj = await fetch(`${baseUrl}/api/v1/projects/${projData.data.id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenAdmin}` }
    });
    assert.strictEqual(adminDeleteProj.status, 200, 'Admin should be allowed to delete project');
    console.log('  ✔ Admin successfully deleted project');

    console.log('\n✔ ALL RBAC AUTHORIZATION TESTS PASSED (100% GREEN)');
  } finally {
    server.close();
  }
}

if (require.main === module) {
  runRoleAuthTests().catch(err => {
    console.error('❌ Role auth test suite failed:', err);
    process.exit(1);
  });
}

module.exports = { runRoleAuthTests };
