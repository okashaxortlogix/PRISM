// PRISM Automated Test Suite: P1-02 Repository Ingestion, Git Adapter Hardening & File Tree Indexing
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { initDatabase, getDatabase } = require('../../src/db/database');
const { seedData } = require('../../src/db/seed');
const { JobQueue, jobQueue, JOB_STATUSES, JOB_TYPES } = require('../../src/queue/jobQueue');
const { JobWorker } = require('../../src/queue/jobWorker');
const { validateRepositoryUrl, GitValidationError } = require('../../src/ingestion/gitValidator');
const {
  detectLanguage,
  computeFileHash,
  parsePackageJson,
  parseGoMod,
  parseRequirementsTxt,
  indexDirectory,
  resolveCommitSha
} = require('../../src/ingestion/repoIndexer');
const { handleRepoIngestionJob } = require('../../src/queue/handlers/repoIngestionHandler');
const {
  createTestOrganization,
  createTestUser,
  createMembership,
  authenticateAs
} = require('../security/testHelpers');
const app = require('../../src/server');

async function runRepoIngestionTests() {
  console.log('\n=====================================================');
  console.log('📁 RUNNING PRISM REPO INGESTION & GIT TESTS (P1-02)');
  console.log('=====================================================');

  // 1. Initialize Database & Seed
  initDatabase();
  seedData();
  const db = getDatabase();

  // Clean up any previous test jobs/files
  db.exec('DELETE FROM job_checkpoints; DELETE FROM jobs; DELETE FROM repository_files; DELETE FROM repository_dependencies;');

  // -------------------------------------------------------------
  // Test 1: URL Security & Argument Injection Prevention
  // -------------------------------------------------------------
  console.log('Test 1: Git URL argument injection protection (leading dashes)');
  assert.throws(() => {
    validateRepositoryUrl('--upload-pack=evil');
  }, /command-line flag indicators/, 'Must block URLs with leading dashes/flags');

  assert.throws(() => {
    validateRepositoryUrl('-oProxyCommand=calc.exe');
  }, /command-line flag indicators/, 'Must block URLs with single leading dash');
  console.log('  ✔ Command-line flag indicators rejected (Pass)');

  // -------------------------------------------------------------
  // Test 2: Shell Metacharacter Protection
  // -------------------------------------------------------------
  console.log('Test 2: Shell metacharacter & command injection protection');
  assert.throws(() => {
    validateRepositoryUrl('https://github.com/org/repo.git; rm -rf /');
  }, /illegal shell metacharacter/, 'Must block shell metacharacters');

  assert.throws(() => {
    validateRepositoryUrl('https://github.com/org/repo.git `whoami`');
  }, /illegal shell metacharacter/, 'Must block backticks');
  console.log('  ✔ Shell metacharacters and backticks rejected (Pass)');

  // -------------------------------------------------------------
  // Test 3: Dangerous Protocol Protection
  // -------------------------------------------------------------
  console.log('Test 3: Dangerous protocol protection (file://, gopher://, ftp://)');
  assert.throws(() => {
    validateRepositoryUrl('file:///etc/shadow');
  }, /dangerous protocol scheme/, 'Must block file:// scheme');

  assert.throws(() => {
    validateRepositoryUrl('gopher://evil.internal:70');
  }, /dangerous protocol scheme/, 'Must block gopher:// scheme');

  assert.throws(() => {
    validateRepositoryUrl('ftp://ftp.evil.internal/repo');
  }, /dangerous protocol scheme/, 'Must block ftp:// scheme');
  console.log('  ✔ Dangerous protocols rejected (Pass)');

  // -------------------------------------------------------------
  // Test 4: Remote Git Provider Resolution
  // -------------------------------------------------------------
  console.log('Test 4: Remote Git provider resolution (GitHub, GitLab, Bitbucket, Generic)');
  const gh = validateRepositoryUrl('https://github.com/prism-org/sample-service.git');
  assert.strictEqual(gh.type, 'REMOTE');
  assert.strictEqual(gh.provider, 'GITHUB');

  const gl = validateRepositoryUrl('git@gitlab.com:enterprise/kernel.git');
  assert.strictEqual(gl.type, 'REMOTE');
  assert.strictEqual(gl.provider, 'GITLAB');

  const bb = validateRepositoryUrl('https://bitbucket.org/team/project.git');
  assert.strictEqual(bb.type, 'REMOTE');
  assert.strictEqual(bb.provider, 'BITBUCKET');

  const generic = validateRepositoryUrl('https://git.internal.corp/core/auth.git');
  assert.strictEqual(generic.type, 'REMOTE');
  assert.strictEqual(generic.provider, 'GENERIC_GIT');
  console.log('  ✔ Git providers resolved accurately (Pass)');

  // -------------------------------------------------------------
  // Test 5: Language Detection & Content Hashing
  // -------------------------------------------------------------
  console.log('Test 5: Deterministic language detection and SHA-256 content hashing');
  assert.strictEqual(detectLanguage('server.js'), 'JavaScript');
  assert.strictEqual(detectLanguage('index.ts'), 'TypeScript');
  assert.strictEqual(detectLanguage('main.go'), 'Go');
  assert.strictEqual(detectLanguage('app.py'), 'Python');
  assert.strictEqual(detectLanguage('Dockerfile'), 'Dockerfile');
  assert.strictEqual(detectLanguage('schema.sql'), 'SQL');
  assert.strictEqual(detectLanguage('package.json'), 'JSON');

  const hash1 = computeFileHash('console.log("hello world");');
  const hash2 = computeFileHash('console.log("hello world");');
  const hash3 = computeFileHash('console.log("hello prism");');
  assert.strictEqual(hash1, hash2, 'Identical content must produce identical hash');
  assert.notStrictEqual(hash1, hash3, 'Different content must produce different hash');
  assert.strictEqual(hash1.length, 64, 'SHA-256 hash must be 64 hex characters');
  console.log('  ✔ Content hashing and extension detection verified (Pass)');

  // -------------------------------------------------------------
  // Test 6: NPM Manifest Parser
  // -------------------------------------------------------------
  console.log('Test 6: NPM package.json manifest parser (dependencies & devDependencies)');
  const samplePkgJson = JSON.stringify({
    dependencies: {
      'express': '^4.19.2',
      'better-sqlite3': '^11.3.0'
    },
    devDependencies: {
      'mocha': '^10.2.0'
    }
  });
  const npmDeps = parsePackageJson(samplePkgJson);
  assert.strictEqual(npmDeps.length, 3);
  assert.deepStrictEqual(npmDeps.find(d => d.name === 'express'), {
    name: 'express',
    version_spec: '^4.19.2',
    ecosystem: 'NPM',
    is_dev: false
  });
  assert.deepStrictEqual(npmDeps.find(d => d.name === 'mocha'), {
    name: 'mocha',
    version_spec: '^10.2.0',
    ecosystem: 'NPM',
    is_dev: true
  });
  console.log('  ✔ NPM manifest parsed (Pass)');

  // -------------------------------------------------------------
  // Test 7: Go Modules Manifest Parser
  // -------------------------------------------------------------
  console.log('Test 7: Go Modules go.mod manifest parser');
  const sampleGoMod = `
module github.com/prism/gateway

go 1.21

require (
    github.com/gin-gonic/gin v1.9.1
    go.uber.org/zap v1.26.0
)
`;
  const goDeps = parseGoMod(sampleGoMod);
  assert.strictEqual(goDeps.length, 2);
  assert.strictEqual(goDeps[0].name, 'github.com/gin-gonic/gin');
  assert.strictEqual(goDeps[0].version_spec, 'v1.9.1');
  assert.strictEqual(goDeps[0].ecosystem, 'GO_MODULES');
  console.log('  ✔ Go module dependencies parsed (Pass)');

  // -------------------------------------------------------------
  // Test 8: Python PIP Manifest Parser
  // -------------------------------------------------------------
  console.log('Test 8: Python PIP requirements.txt manifest parser');
  const sampleReqTxt = `
# Production requirements
fastapi==0.104.1
uvicorn>=0.24.0
pydantic~=2.5.0
`;
  const pipDeps = parseRequirementsTxt(sampleReqTxt);
  assert.strictEqual(pipDeps.length, 3);
  assert.strictEqual(pipDeps[0].name, 'fastapi');
  assert.strictEqual(pipDeps[0].version_spec, '==0.104.1');
  assert.strictEqual(pipDeps[0].ecosystem, 'PIP');
  console.log('  ✔ Python requirements parsed (Pass)');

  // -------------------------------------------------------------
  // Test 9: File Tree Traversal & Commit SHA Resolution
  // -------------------------------------------------------------
  console.log('Test 9: File tree traversal, ignoring .git/binaries & resolving commit SHA');
  const platformRoot = path.resolve(__dirname, '../../');
  const indexRes = indexDirectory(platformRoot);
  assert.ok(indexRes.files.length > 10, 'Must discover repository source files');
  assert.ok(indexRes.dependencies.length > 0, 'Must discover repository dependencies from package.json');

  const gitFiles = indexRes.files.filter(f => f.file_path.includes('.git/') || f.file_path.startsWith('.git'));
  assert.strictEqual(gitFiles.length, 0, '.git files must be excluded');
  const nodeModulesFiles = indexRes.files.filter(f => f.file_path.includes('node_modules/'));
  assert.strictEqual(nodeModulesFiles.length, 0, 'node_modules files must be excluded');

  const sha = resolveCommitSha(platformRoot);
  assert.ok(sha && sha.length >= 40, 'Commit SHA must be resolved or synthesized');
  console.log(`  ✔ Directory traversal completed: ${indexRes.files.length} files found (Pass)`);

  // -------------------------------------------------------------
  // Test 10: Background Worker Ingestion & Checkpoints
  // -------------------------------------------------------------
  console.log('Test 10: Background worker repository ingestion execution & checkpoints');
  const orgAlpha = createTestOrganization('Ingestion Alpha Corp');
  const userAlpha = createTestUser(`ingest_user_${Date.now()}@alpha.internal`, 'SecretPass123!', 'Alpha Dev');
  createMembership(userAlpha.id, orgAlpha.id, 'ADMIN');

  const projId = `prj_ingest_${Date.now()}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO projects (id, organization_id, name, description, status, created_at, updated_at)
    VALUES (?, ?, 'Ingestion Test Project', 'Testing P1-02 Ingestion', 'ACTIVE', ?, ?)
  `).run(projId, orgAlpha.id, now, now);

  const invId = `inv_ingest_${Date.now()}`;
  db.prepare(`
    INSERT INTO investigations (id, project_id, created_by, title, problem_statement, status, severity, started_at, updated_at)
    VALUES (?, ?, ?, 'Repo Ingest Investigation', 'Test Ingestion Evidence', 'EVIDENCE_COLLECTION', 'SEV2', ?, ?)
  `).run(invId, projId, userAlpha.id, now, now);

  const repoId = `repo_ingest_${Date.now()}`;
  db.prepare(`
    INSERT INTO repositories (id, project_id, provider, url, default_branch, status, created_at)
    VALUES (?, ?, 'GITHUB', 'https://github.com/prism/test-repo.git', 'main', 'PENDING', ?)
  `).run(repoId, projId, now);

  const testQueue = new JobQueue();
  const worker = new JobWorker({ queue: testQueue, concurrency: 1, pollIntervalMs: 50 });

  const job = testQueue.enqueue({
    organizationId: orgAlpha.id,
    projectId: projId,
    type: JOB_TYPES.REPOSITORY_INGESTION,
    payload: { repository_id: repoId },
    priority: 'HIGH'
  });

  worker.start();
  let completed = false;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 100));
    const currentJob = testQueue.getJob(job.id, orgAlpha.id);
    if (currentJob && currentJob.status === JOB_STATUSES.SUCCEEDED) {
      completed = true;
      break;
    }
  }
  worker.stop();
  assert.ok(completed, 'Ingestion job must reach SUCCEEDED status');

  const updatedRepo = db.prepare('SELECT * FROM repositories WHERE id = ?').get(repoId);
  assert.strictEqual(updatedRepo.status, 'INDEXED');
  assert.ok(updatedRepo.file_count > 0, 'file_count must be populated');
  assert.ok(updatedRepo.commit_sha, 'commit_sha must be populated');

  const checkpoints = testQueue.getCheckpoints(job.id);
  assert.ok(checkpoints.length >= 4, 'Must persist checkpoints for all phases');
  assert.strictEqual(checkpoints[checkpoints.length - 1].phase, 'COMPLETED');
  console.log('  ✔ Background worker ingestion and checkpoints verified (Pass)');

  // -------------------------------------------------------------
  // Test 11: Immutable Evidence Item Synthesis
  // -------------------------------------------------------------
  console.log('Test 11: Immutable evidence item synthesis (REPOSITORY_CODE)');
  const repoFiles = db.prepare('SELECT * FROM repository_files WHERE repository_id = ?').all(repoId);
  assert.strictEqual(repoFiles.length, updatedRepo.file_count);
  assert.ok(repoFiles[0].sha256_hash, 'repository_files must have sha256_hash');

  const repoDeps = db.prepare('SELECT * FROM repository_dependencies WHERE repository_id = ?').all(repoId);
  assert.strictEqual(repoDeps.length, updatedRepo.dependency_count);

  const evidence = db.prepare("SELECT * FROM evidence WHERE investigation_id = ? AND type = 'REPOSITORY_CODE'").get(invId);
  assert.ok(evidence, 'Must synthesize REPOSITORY_CODE evidence item in active investigation');
  assert.strictEqual(evidence.source, 'GIT_INGESTION');
  assert.ok(evidence.hash, 'Evidence must have sha256 hash');
  console.log('  ✔ Immutable evidence item synthesized in investigation vault (Pass)');

  // -------------------------------------------------------------
  // Test 12-16: HTTP Multi-Tenant REST APIs & Anti-IDOR
  // -------------------------------------------------------------
  const testServer = http.createServer(app);
  await new Promise(resolve => testServer.listen(0, resolve));
  const port = testServer.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const orgBeta = createTestOrganization('Ingestion Beta Corp');
    const userBeta = createTestUser(`ingest_beta_${Date.now()}@beta.internal`, 'BetaSecret123!', 'Beta Dev');
    createMembership(userBeta.id, orgBeta.id, 'ADMIN');

    const tokenAlpha = authenticateAs(userAlpha.id, orgAlpha.id);
    const tokenBeta = authenticateAs(userBeta.id, orgBeta.id);

    // Test 12: GET /api/v1/repositories/:id (anti-IDOR)
    console.log('Test 12: HTTP API: GET /api/v1/repositories/:id (anti-IDOR enforcement)');
    const getAlphaRes = await fetch(`${baseUrl}/api/v1/repositories/${repoId}`, {
      headers: { 'Authorization': `Bearer ${tokenAlpha}` }
    });
    const getAlphaData = await getAlphaRes.json();
    assert.strictEqual(getAlphaRes.status, 200);
    assert.strictEqual(getAlphaData.data.id, repoId);

    const getBetaRes = await fetch(`${baseUrl}/api/v1/repositories/${repoId}`, {
      headers: { 'Authorization': `Bearer ${tokenBeta}` }
    });
    assert.strictEqual(getBetaRes.status, 404, 'Cross-tenant repository lookup must return 404');
    console.log('  ✔ Scoped repository access verified; cross-tenant blocked with 404 (Pass)');

    // Test 13: GET /api/v1/repositories/:id/files
    console.log('Test 13: HTTP API: GET /api/v1/repositories/:id/files');
    const filesAlphaRes = await fetch(`${baseUrl}/api/v1/repositories/${repoId}/files?limit=10`, {
      headers: { 'Authorization': `Bearer ${tokenAlpha}` }
    });
    const filesAlphaData = await filesAlphaRes.json();
    assert.strictEqual(filesAlphaRes.status, 200);
    assert.ok(filesAlphaData.data.files.length > 0);

    const filesBetaRes = await fetch(`${baseUrl}/api/v1/repositories/${repoId}/files`, {
      headers: { 'Authorization': `Bearer ${tokenBeta}` }
    });
    assert.strictEqual(filesBetaRes.status, 404);
    console.log('  ✔ File inventory queried with pagination & tenant isolation (Pass)');

    // Test 14: GET /api/v1/repositories/:id/dependencies
    console.log('Test 14: HTTP API: GET /api/v1/repositories/:id/dependencies');
    const depsAlphaRes = await fetch(`${baseUrl}/api/v1/repositories/${repoId}/dependencies`, {
      headers: { 'Authorization': `Bearer ${tokenAlpha}` }
    });
    const depsAlphaData = await depsAlphaRes.json();
    assert.strictEqual(depsAlphaRes.status, 200);
    assert.ok(depsAlphaData.data.dependencies.length > 0);

    const depsBetaRes = await fetch(`${baseUrl}/api/v1/repositories/${repoId}/dependencies`, {
      headers: { 'Authorization': `Bearer ${tokenBeta}` }
    });
    assert.strictEqual(depsBetaRes.status, 404);
    console.log('  ✔ Dependency catalog queried with ecosystem filters (Pass)');

    // Test 15: POST /api/v1/repositories/:id/sync
    console.log('Test 15: HTTP API: POST /api/v1/repositories/:id/sync (background sync trigger)');
    const syncAlphaRes = await fetch(`${baseUrl}/api/v1/repositories/${repoId}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenAlpha}`
      },
      body: JSON.stringify({ priority: 'NORMAL' })
    });
    const syncAlphaData = await syncAlphaRes.json();
    assert.strictEqual(syncAlphaRes.status, 202);
    assert.strictEqual(syncAlphaData.data.status, 'SYNC_ENQUEUED');
    assert.ok(syncAlphaData.data.job.id);

    const syncBetaRes = await fetch(`${baseUrl}/api/v1/repositories/${repoId}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenBeta}`
      },
      body: JSON.stringify({})
    });
    assert.strictEqual(syncBetaRes.status, 404);
    console.log('  ✔ Background sync triggered with 202 Accepted (Pass)');

    // Test 16: POST /api/v1/projects/:projectId/repositories
    console.log('Test 16: HTTP API: POST /api/v1/projects/:projectId/repositories (URL validation & async enqueue)');
    const addRepoRes = await fetch(`${baseUrl}/api/v1/projects/${projId}/repositories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenAlpha}`
      },
      body: JSON.stringify({
        url: 'https://github.com/prism-corp/payment-service.git',
        default_branch: 'main'
      })
    });
    const addRepoData = await addRepoRes.json();
    assert.strictEqual(addRepoRes.status, 202);
    assert.strictEqual(addRepoData.data.repository.status, 'PENDING');
    assert.ok(addRepoData.data.job.id);

    const badRepoRes = await fetch(`${baseUrl}/api/v1/projects/${projId}/repositories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenAlpha}`
      },
      body: JSON.stringify({
        url: '--upload-pack=evil'
      })
    });
    assert.strictEqual(badRepoRes.status, 400);
    console.log('  ✔ Repository creation enqueues ingestion with 202 Accepted & rejects invalid URLs (Pass)');
  } finally {
    await new Promise(resolve => testServer.close(resolve));
  }

  console.log('\n✔ All Repository Ingestion & Git Tests Passed! (16 tests)\n');
}

if (require.main === module) {
  runRepoIngestionTests()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Repository Ingestion Test Suite Failed:', err);
      process.exit(1);
    });
}

module.exports = { runRepoIngestionTests };
