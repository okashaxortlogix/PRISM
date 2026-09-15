// PRISM Cross-Tenant Isolation & IDOR Security Test Suite
// Verifies server-side tenant boundaries across read, write, update, and delete operations
const assert = require('node:assert');
const app = require('../../src/server');
const { getDatabase } = require('../../src/db/database');
const {
  createTestOrganization,
  createTestUser,
  createMembership,
  authenticateAs
} = require('./testHelpers');

async function runTenantIsolationTests() {
  console.log('\n=====================================================');
  console.log('🛡️ RUNNING PRISM MULTI-TENANT ISOLATION & IDOR TESTS');
  console.log('=====================================================');

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const db = getDatabase();

  try {
    // ---------------------------------------------------------------
    // 1. Fixture Setup: Tenant Alpha vs Tenant Beta
    // ---------------------------------------------------------------
    console.log('Setting up isolated tenants Alpha and Beta fixtures...');
    const orgAlpha = createTestOrganization('Alpha Corp');
    const orgBeta = createTestOrganization('Beta Industries');

    const userAlpha = createTestUser(`alice_${Date.now()}@alpha.internal`, 'AlphaPass2026!', 'Alice Alpha');
    const userBeta = createTestUser(`bob_${Date.now()}@beta.internal`, 'BetaPass2026!', 'Bob Beta');

    createMembership(userAlpha.id, orgAlpha.id, 'OWNER');
    createMembership(userBeta.id, orgBeta.id, 'OWNER');

    const tokenAlpha = authenticateAs(userAlpha.id, orgAlpha.id);
    const tokenBeta = authenticateAs(userBeta.id, orgBeta.id);

    // Create Project Alpha and Project Beta
    const now = new Date().toISOString();
    const projAlphaId = `prj_alpha_${Date.now().toString(36)}`;
    const projBetaId = `prj_beta_${Date.now().toString(36)}`;

    db.prepare(`
      INSERT INTO projects (id, organization_id, name, description, status, created_at, updated_at)
      VALUES (?, ?, 'Alpha Payment Gateway', 'Alpha core', 'ACTIVE', ?, ?)
    `).run(projAlphaId, orgAlpha.id, now, now);

    db.prepare(`
      INSERT INTO projects (id, organization_id, name, description, status, created_at, updated_at)
      VALUES (?, ?, 'Beta Order Pipeline', 'Beta core', 'ACTIVE', ?, ?)
    `).run(projBetaId, orgBeta.id, now, now);

    // Create Investigation Alpha and Investigation Beta
    const invAlphaId = `inv_alpha_${Date.now().toString(36)}`;
    const invBetaId = `inv_beta_${Date.now().toString(36)}`;

    db.prepare(`
      INSERT INTO investigations (id, project_id, created_by, title, problem_statement, status, severity, scope, started_at, updated_at)
      VALUES (?, ?, ?, 'Alpha Latency Spike', 'p99 degradation', 'DRAFT', 'SEV2', '{}', ?, ?)
    `).run(invAlphaId, projAlphaId, userAlpha.id, now, now);

    db.prepare(`
      INSERT INTO investigations (id, project_id, created_by, title, problem_statement, status, severity, scope, started_at, updated_at)
      VALUES (?, ?, ?, 'Beta Data Leak', 'unauthorized export', 'DRAFT', 'SEV1', '{}', ?, ?)
    `).run(invBetaId, projBetaId, userBeta.id, now, now);

    // Create Evidence for Beta
    const eviBetaId = `evi_beta_${Date.now().toString(36)}`;
    db.prepare(`
      INSERT INTO evidence (id, investigation_id, type, source, source_ref, title, content, observed_at, collected_at, reliability, provenance, hash)
      VALUES (?, ?, 'LOG_EVIDENCE', 'datadog', 'alert-99', 'Beta Confidential Trace', 'sensitive beta payload', ?, ?, 0.95, '{"source":"datadog"}', 'hash123')
    `).run(eviBetaId, invBetaId, now, now);

    // Create Memory for Beta
    const memBetaId = `mem_beta_${Date.now().toString(36)}`;
    db.prepare(`
      INSERT INTO memories (id, organization_id, project_id, investigation_id, title, summary, root_cause, resolution, tags, freshness_score, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'Beta Secret Postmortem', 'internal memo', 'beta root cause', 'fixed', '[]', 1.0, ?, ?)
    `).run(memBetaId, orgBeta.id, projBetaId, invBetaId, now, now);

    console.log('  ✔ Multi-tenant fixtures created successfully');

    // ---------------------------------------------------------------
    // 2. Cross-Tenant Read Protection (IDOR)
    // ---------------------------------------------------------------
    console.log('\nTesting Cross-Tenant Read Protection (User Alpha -> Beta Resources):');

    // User Alpha requests Project Alpha -> 200 OK
    const readOwnProj = await fetch(`${baseUrl}/api/v1/projects/${projAlphaId}`, {
      headers: { 'Authorization': `Bearer ${tokenAlpha}` }
    });
    assert.strictEqual(readOwnProj.status, 200, 'User Alpha should access own Project Alpha');

    // User Alpha requests Project Beta -> 404 NOT FOUND (prevents tenant existence discovery)
    const readCrossProj = await fetch(`${baseUrl}/api/v1/projects/${projBetaId}`, {
      headers: { 'Authorization': `Bearer ${tokenAlpha}` }
    });
    assert.strictEqual(readCrossProj.status, 404, 'User Alpha must NOT be able to access Project Beta');
    console.log('  ✔ User Alpha -> Project Beta: 404 NOT FOUND');

    // User Alpha requests Investigation Alpha -> 200 OK
    const readOwnInv = await fetch(`${baseUrl}/api/v1/investigations/${invAlphaId}`, {
      headers: { 'Authorization': `Bearer ${tokenAlpha}` }
    });
    assert.strictEqual(readOwnInv.status, 200, 'User Alpha should access own Investigation Alpha');

    // User Alpha requests Investigation Beta -> 404 NOT FOUND
    const readCrossInv = await fetch(`${baseUrl}/api/v1/investigations/${invBetaId}`, {
      headers: { 'Authorization': `Bearer ${tokenAlpha}` }
    });
    assert.strictEqual(readCrossInv.status, 404, 'User Alpha must NOT be able to access Investigation Beta');
    console.log('  ✔ User Alpha -> Investigation Beta: 404 NOT FOUND');

    // User Alpha requests Evidence Beta -> 404 NOT FOUND
    const readCrossEvidence = await fetch(`${baseUrl}/api/v1/evidence/${eviBetaId}/verify-integrity`, {
      headers: { 'Authorization': `Bearer ${tokenAlpha}` }
    });
    assert.strictEqual(readCrossEvidence.status, 404, 'User Alpha must NOT be able to access Evidence Beta');
    console.log('  ✔ User Alpha -> Evidence Beta: 404 NOT FOUND');

    // User Alpha requests Memory Beta -> 404 NOT FOUND
    const readCrossMemory = await fetch(`${baseUrl}/api/v1/memories/${memBetaId}`, {
      headers: { 'Authorization': `Bearer ${tokenAlpha}` }
    });
    assert.strictEqual(readCrossMemory.status, 404, 'User Alpha must NOT be able to access Memory Beta');
    console.log('  ✔ User Alpha -> Memory Beta: 404 NOT FOUND');

    // User Alpha requests Report Beta -> 404 NOT FOUND
    const readCrossReport = await fetch(`${baseUrl}/api/v1/investigations/${invBetaId}/report?format=json`, {
      headers: { 'Authorization': `Bearer ${tokenAlpha}` }
    });
    assert.strictEqual(readCrossReport.status, 404, 'User Alpha must NOT be able to export Report Beta');
    console.log('  ✔ User Alpha -> Report Beta: 404 NOT FOUND');

    // User Alpha lists projects: must NOT contain Beta projects
    const listProjects = await fetch(`${baseUrl}/api/v1/projects`, {
      headers: { 'Authorization': `Bearer ${tokenAlpha}` }
    });
    const projectsData = await listProjects.json();
    assert.ok(projectsData.data.every(p => p.organization_id === orgAlpha.id), 'Project listing must strictly contain only Alpha projects');
    assert.ok(!projectsData.data.some(p => p.id === projBetaId), 'Beta project must not appear in Alpha project listing');
    console.log('  ✔ User Alpha project listing strictly scoped to Alpha organization');

    // User Alpha lists investigations: must NOT contain Beta investigations
    const listInvs = await fetch(`${baseUrl}/api/v1/investigations`, {
      headers: { 'Authorization': `Bearer ${tokenAlpha}` }
    });
    const invsData = await listInvs.json();
    assert.ok(!invsData.data.some(i => i.id === invBetaId), 'Beta investigation must not appear in Alpha investigations listing');
    console.log('  ✔ User Alpha investigation listing strictly scoped to Alpha organization');

    // User Alpha lists memories: must NOT contain Beta memories
    const listMems = await fetch(`${baseUrl}/api/v1/memories`, {
      headers: { 'Authorization': `Bearer ${tokenAlpha}` }
    });
    const memsData = await listMems.json();
    assert.ok(!memsData.data.some(m => m.id === memBetaId), 'Beta memory must not appear in Alpha memory listing');
    console.log('  ✔ User Alpha memory listing strictly scoped to Alpha organization');

    // ---------------------------------------------------------------
    // 3. Cross-Tenant Write Protection
    // ---------------------------------------------------------------
    console.log('\nTesting Cross-Tenant Write Protection:');

    // User Alpha attempts to create an Investigation under Beta's project
    const crossCreateInv = await fetch(`${baseUrl}/api/v1/investigations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenAlpha}`
      },
      body: JSON.stringify({
        project_id: projBetaId,
        title: 'Exploit Injection',
        problem_statement: 'Cross tenant attack attempt'
      })
    });
    assert.strictEqual(crossCreateInv.status, 403, 'Cross-project creation must be forbidden');
    console.log('  ✔ User Alpha cannot create Investigation under Beta Project (403 FORBIDDEN)');

    // User Alpha attempts to attach evidence to Beta's investigation
    const crossAddEvidence = await fetch(`${baseUrl}/api/v1/investigations/${invBetaId}/evidence`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenAlpha}`
      },
      body: JSON.stringify({
        type: 'RUNTIME_LOG',
        title: 'Malicious Injected Evidence',
        source: 'attacker',
        source_ref: 'tamper-1',
        content: 'payload'
      })
    });
    assert.strictEqual(crossAddEvidence.status, 404, 'Cannot attach evidence to other tenant investigation');
    console.log('  ✔ User Alpha cannot attach evidence to Beta Investigation (404 NOT FOUND)');

    // User Alpha attempts to advance Beta's investigation state
    const crossTransition = await fetch(`${baseUrl}/api/v1/investigations/${invBetaId}/transition`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenAlpha}`
      },
      body: JSON.stringify({ targetState: 'COMPLETED' })
    });
    assert.strictEqual(crossTransition.status, 404, 'Cannot mutate other tenant investigation state');
    console.log('  ✔ User Alpha cannot transition Beta Investigation state (404 NOT FOUND)');

    // User Alpha attempts to delete Beta's project
    const crossDeleteProj = await fetch(`${baseUrl}/api/v1/projects/${projBetaId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenAlpha}` }
    });
    assert.strictEqual(crossDeleteProj.status, 404, 'Cannot delete other tenant project');
    console.log('  ✔ User Alpha cannot delete Beta Project (404 NOT FOUND)');

    // User Alpha attempts to delete Beta's investigation
    const crossDeleteInv = await fetch(`${baseUrl}/api/v1/investigations/${invBetaId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenAlpha}` }
    });
    assert.strictEqual(crossDeleteInv.status, 404, 'Cannot delete other tenant investigation');
    console.log('  ✔ User Alpha cannot delete Beta Investigation (404 NOT FOUND)');

    // User Alpha attempts to delete Beta's memory
    const crossDeleteMem = await fetch(`${baseUrl}/api/v1/memories/${memBetaId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenAlpha}` }
    });
    assert.strictEqual(crossDeleteMem.status, 404, 'Cannot delete other tenant memory');
    console.log('  ✔ User Alpha cannot delete Beta Memory (404 NOT FOUND)');

    // Verify Beta Project, Investigation, Evidence, and Memory STILL EXIST completely intact
    const verifyBetaProj = db.prepare('SELECT id FROM projects WHERE id = ?').get(projBetaId);
    assert.ok(verifyBetaProj, 'Beta Project must still exist intact');
    const verifyBetaInv = db.prepare('SELECT id FROM investigations WHERE id = ?').get(invBetaId);
    assert.ok(verifyBetaInv, 'Beta Investigation must still exist intact');
    const verifyBetaEvi = db.prepare('SELECT id FROM evidence WHERE id = ?').get(eviBetaId);
    assert.ok(verifyBetaEvi, 'Beta Evidence must still exist intact');
    const verifyBetaMem = db.prepare('SELECT id FROM memories WHERE id = ?').get(memBetaId);
    assert.ok(verifyBetaMem, 'Beta Memory must still exist intact');
    console.log('  ✔ All Beta resources confirmed completely intact in database');

    // ---------------------------------------------------------------
    // 4. Client Request Body Organization Override Protection
    // ---------------------------------------------------------------
    console.log('\nTesting Client Request Body Organization Override Protection:');
    // When User Alpha creates a project specifying organization_id = orgBeta.id in body,
    // the server MUST ignore client body and strictly bind to User Alpha's organization!
    const spoofBodyProj = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenAlpha}`
      },
      body: JSON.stringify({
        name: 'Trojan Project',
        organization_id: orgBeta.id // Malicious payload
      })
    });
    const spoofProjData = await spoofBodyProj.json();
    assert.strictEqual(spoofBodyProj.status, 201);
    assert.strictEqual(spoofProjData.data.organization_id, orgAlpha.id, 'Server MUST enforce token organization_id and ignore request body spoofing');
    console.log('  ✔ Server safely ignored body organization_id and bound to token tenant (orgAlpha)');

    // Verify User Beta cannot access the trojan project
    const betaCheckTrojan = await fetch(`${baseUrl}/api/v1/projects/${spoofProjData.data.id}`, {
      headers: { 'Authorization': `Bearer ${tokenBeta}` }
    });
    assert.strictEqual(betaCheckTrojan.status, 404);
    console.log('  ✔ User Beta cannot see the project created by User Alpha');

    console.log('\n✔ ALL MULTI-TENANT ISOLATION & IDOR TESTS PASSED (100% GREEN)');
  } finally {
    server.close();
  }
}

if (require.main === module) {
  runTenantIsolationTests().catch(err => {
    console.error('❌ Tenant isolation test suite failed:', err);
    process.exit(1);
  });
}

module.exports = { runTenantIsolationTests };
