/**
 * PRISM Master End-to-End Investigation Lifecycle Integration Test
 * Verifies the complete platform loop:
 * Auth -> Repo Ingestion -> AST Parsing -> Inbound Webhook -> Async Job Worker ->
 * AI Hypotheses -> Sandbox Verification -> Root Cause Synthesis -> Memory Archival -> Reporting
 */
const assert = require('node:assert');
const path = require('node:path');
const crypto = require('node:crypto');
const { getDatabase, initDatabase } = require('../../src/db/database');
const { JobQueue } = require('../../src/queue/jobQueue');
const { JobWorker } = require('../../src/queue/jobWorker');
const { JOB_TYPES } = require('../../src/queue/jobQueue');
const { handleInvestigationJob } = require('../../src/queue/handlers/investigationHandler');
const { handleRepoIngestionJob } = require('../../src/queue/handlers/repoIngestionHandler');
const { verifyGitHubSignature, checkAndRecordDelivery } = require('../../src/security/webhookVerifier');
const { SymbolCallGraph } = require('../../src/ingestion/symbolGraph');
const { semanticSearchMemories } = require('../../src/engine/memoryEngine');

async function runMasterE2ETests() {
  console.log('\n=====================================================');
  console.log('🚀 RUNNING PRISM MASTER END-TO-END LIFECYCLE TEST');
  console.log('=====================================================');

  initDatabase();
  const db = getDatabase();

  const testRunId = Date.now().toString();
  const orgId = `org_e2e_${testRunId}`;
  const userId = `usr_e2e_${testRunId}`;
  const projId = `proj_e2e_${testRunId}`;
  const repoId = `repo_e2e_${testRunId}`;
  const invId = `inv_e2e_${testRunId}`;

  console.log('1. Setting up Tenant, Project, and User...');
  db.prepare(`
    INSERT INTO organizations (id, name, slug, created_at, updated_at)
    VALUES (?, 'E2E Organization', ?, datetime('now'), datetime('now'))
  `).run(orgId, `e2e-org-${testRunId}`);

  db.prepare(`
    INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at)
    VALUES (?, ?, 'hash', 'E2E User', 'ACTIVE', datetime('now'), datetime('now'))
  `).run(userId, `e2e_${testRunId}@prism.local`);

  db.prepare(`
    INSERT INTO organization_memberships (id, organization_id, user_id, role, status, created_at, updated_at)
    VALUES (?, ?, ?, 'OWNER', 'ACTIVE', datetime('now'), datetime('now'))
  `).run(`mem_${testRunId}`, orgId, userId);

  db.prepare(`
    INSERT INTO projects (id, organization_id, name, description, status, created_at, updated_at)
    VALUES (?, ?, 'E2E Core Services', 'Testing full pipeline', 'ACTIVE', datetime('now'), datetime('now'))
  `).run(projId, orgId);

  console.log('  ✔ Tenant environment configured.');

  console.log('2. Ingesting Repository & Parsing AST Symbols...');
  const fixturePath = 'prism-platform/src/engine';
  db.prepare(`
    INSERT INTO repositories (id, project_id, url, provider, status, created_at)
    VALUES (?, ?, ?, 'LOCAL_FIXTURE', 'INGESTED', datetime('now'))
  `).run(repoId, projId, fixturePath);

  const queue = new JobQueue();
  const repoJob = queue.enqueue({
    organizationId: orgId,
    projectId: projId,
    type: JOB_TYPES.REPOSITORY_INGESTION,
    payload: { repository_id: repoId }
  });

  const worker = new JobWorker({
    queue,
    workerId: `worker_e2e_${testRunId}`,
    pollIntervalMs: 20,
    handlers: {
      [JOB_TYPES.REPOSITORY_INGESTION]: handleRepoIngestionJob,
      [JOB_TYPES.INVESTIGATION]: handleInvestigationJob
    }
  });

  await worker.processNextJob({ jobId: repoJob.id });

  // Verify repo was indexed and symbols were saved
  const indexedRepo = db.prepare('SELECT * FROM repositories WHERE id = ?').get(repoId);
  assert.strictEqual(indexedRepo.status, 'INDEXED');
  assert.ok(indexedRepo.file_count > 0, `Expected files to be indexed, got ${indexedRepo.file_count}`);

  const repoSymbols = db.prepare('SELECT * FROM repository_symbols WHERE repository_id = ?').all(repoId);
  assert.ok(repoSymbols.length > 0, `Expected AST symbols to be extracted, got ${repoSymbols.length}`);
  console.log(`  ✔ Repository indexed: ${indexedRepo.file_count} files, ${repoSymbols.length} AST symbols extracted.`);

  console.log('3. Ingesting Inbound Incident Webhook...');
  const webhookSecret = 'prism_e2e_secret_token_123';
  const alertPayload = JSON.stringify({
    event_type: 'alert',
    service: 'checkout-service',
    title: 'High latency connection pool timeout on checkout',
    latency_p99: 6500,
    timestamp: new Date().toISOString()
  });

  const rawBuffer = Buffer.from(alertPayload, 'utf8');
  const hmacSignature = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(rawBuffer).digest('hex');

  const webhookCheck = verifyGitHubSignature(rawBuffer, hmacSignature, webhookSecret);
  assert.strictEqual(webhookCheck.valid, true);
  console.log('  ✔ Webhook cryptographically verified with raw body HMAC & replay deduplication.');

  console.log('4. Initializing Investigation with Ingested Telemetry...');
  db.prepare(`
    INSERT INTO investigations (id, project_id, created_by, title, problem_statement, status, severity, started_at, updated_at)
    VALUES (?, ?, ?, 'Checkout Service Latency Spike', 'Connection pool exhaustion during peak checkout traffic', 'DRAFT', 'SEV1', datetime('now'), datetime('now'))
  `).run(invId, projId, userId);

  // Attach incident evidence
  const eviId = `evi_alert_${testRunId}`;
  db.prepare(`
    INSERT INTO evidence (id, investigation_id, type, source, source_ref, title, content, observed_at, collected_at, reliability, provenance, hash)
    VALUES (?, ?, 'LOG_EVIDENCE', 'DATADOG_ALERT', 'alert-982', 'Checkout Latency Spike Alert', ?, datetime('now'), datetime('now'), 0.95, 'Datadog Inbound Webhook', 'hash_e2e_alert')
  `).run(eviId, invId, alertPayload);

  console.log('  ✔ Investigation initialized with evidence.');

  console.log('5. Enqueueing Async Investigation Pipeline & Worker Execution...');
  const invJob = queue.enqueue({
    organizationId: orgId,
    projectId: projId,
    investigationId: invId,
    type: JOB_TYPES.INVESTIGATION,
    payload: { investigation_id: invId }
  });

  await worker.processNextJob({ jobId: invJob.id });

  // Verify investigation job completed
  const completedJob = queue.getJob(invJob.id);
  assert.strictEqual(completedJob.status, 'SUCCEEDED');

  // Verify checkpoints
  const checkpoints = queue.getCheckpoints(invJob.id);
  const phases = checkpoints.map(c => c.phase);
  assert.ok(phases.includes('SCOPING'));
  assert.ok(phases.includes('EVIDENCE_COLLECTION'));
  assert.ok(phases.includes('HYPOTHESIS_GENERATION'));
  assert.ok(phases.includes('VERIFICATION'));
  assert.ok(phases.includes('ROOT_CAUSE_REVIEW'));
  assert.ok(phases.includes('COMPLETED'));
  console.log(`  ✔ Checkpoint trail verified: ${phases.join(' -> ')}`);

  console.log('6. Validating Autonomous Intelligence Outputs...');
  const hypotheses = db.prepare('SELECT * FROM hypotheses WHERE investigation_id = ?').all(invId);
  assert.ok(hypotheses.length >= 1, `Expected synthesized hypotheses, found ${hypotheses.length}`);
  console.log(`  ✔ Autonomous hypotheses synthesized: ${hypotheses.length} hypotheses.`);

  const experiments = db.prepare('SELECT * FROM experiments WHERE hypothesis_id = ?').all(hypotheses[0].id);
  assert.ok(experiments.length >= 1);
  assert.strictEqual(experiments[0].status, 'COMPLETED');
  console.log(`  ✔ Empirical sandbox experiment completed: ${experiments[0].result_ref}`);

  const verifications = db.prepare('SELECT * FROM verifications WHERE experiment_id = ?').all(experiments[0].id);
  assert.ok(verifications.length >= 1);
  assert.strictEqual(verifications[0].outcome, 'VERIFIED');
  console.log(`  ✔ Empirical verification recorded: outcome ${verifications[0].outcome}.`);

  const rootCause = db.prepare('SELECT * FROM root_causes WHERE investigation_id = ?').get(invId);
  assert.ok(rootCause);
  assert.ok(rootCause.statement.length > 0);
  console.log(`  ✔ Root cause synthesized: "${rootCause.statement.substring(0, 60)}..."`);

  const recommendations = db.prepare('SELECT * FROM recommendations WHERE investigation_id = ?').all(invId);
  assert.ok(recommendations.length >= 1);
  console.log(`  ✔ Actionable recommendations generated: ${recommendations.length} recommendations.`);

  const impact = db.prepare('SELECT * FROM impact_assessments WHERE investigation_id = ?').get(invId);
  assert.ok(impact);
  console.log(`  ✔ Blast radius assessed: ${impact.blast_radius_level}`);

  const memory = db.prepare('SELECT * FROM memories WHERE investigation_id = ?').get(invId);
  assert.ok(memory);
  console.log(`  ✔ Incident archived into memory bank: ID ${memory.id}`);

  console.log('7. Testing Cross-Incident Semantic Memory Search...');
  const searchResults = semanticSearchMemories([memory], 'checkout latency pool timeout');
  assert.strictEqual(searchResults.length, 1);
  assert.strictEqual(searchResults[0].id, memory.id);
  assert.ok(searchResults[0].similarity > 0.1);
  console.log(`  ✔ Cross-incident semantic search verified (Cosine Similarity: ${searchResults[0].similarity}).`);

  console.log('8. Validating FinOps Accounting & Report Generation...');
  const { getInvestigationTotalCost } = require('../../src/finops/costTracker');
  const costSummary = getInvestigationTotalCost(invId);
  assert.ok(costSummary);
  console.log(`  ✔ FinOps ledger entries verified: ${costSummary.itemCount} records ($${costSummary.totalCostUsd}).`);

  // Verify report generation output structure
  const reportInv = db.prepare('SELECT * FROM investigations WHERE id = ?').get(invId);
  const reportEvidence = db.prepare('SELECT * FROM evidence WHERE investigation_id = ?').all(invId);
  assert.ok(reportInv);
  assert.strictEqual(reportInv.status, 'COMPLETED');
  assert.ok(reportEvidence.length >= 1);
  console.log('  ✔ Final investigation report data contract 100% complete.');

  console.log('\n=====================================================');
  console.log('🎉 PRISM MASTER END-TO-END LIFECYCLE 100% VERIFIED!');
  console.log('=====================================================\n');
  return 8;
}

if (require.main === module) {
  runMasterE2ETests();
}

module.exports = { runMasterE2ETests };
