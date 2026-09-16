// PRISM Automated Test Suite: P1-01 Asynchronous Job Queue & Background Worker Architecture
const assert = require('node:assert');
const path = require('node:path');
const { initDatabase, getDatabase } = require('../../src/db/database');
const { seedData } = require('../../src/db/seed');
const { JobQueue, jobQueue, JOB_STATUSES, JOB_PRIORITIES, JOB_TYPES } = require('../../src/queue/jobQueue');
const { JobWorker, WORKER_STATES } = require('../../src/queue/jobWorker');
const { JobError, ERROR_CODES, calculateBackoff } = require('../../src/queue/jobErrors');
const {
  createTestOrganization,
  createTestUser,
  createMembership,
  authenticateAs
} = require('../security/testHelpers');
const app = require('../../src/server');

async function runJobQueueTests() {
  console.log('\n=====================================================');
  console.log('⚡ RUNNING PRISM ASYNC JOB QUEUE & WORKER TESTS (P1-01)');
  console.log('=====================================================');

  // Initialize fresh database state
  initDatabase();
  seedData();
  const db = getDatabase();
  db.exec('DELETE FROM job_checkpoints; DELETE FROM jobs;');

  const testQueue = new JobQueue({
    defaultMaxAttempts: 3,
    baseRetryDelayMs: 100,
    maxRetryDelayMs: 1000
  });

  // -------------------------------------------------------------
  // Test 1: Enqueue validation & tenant scoping
  // -------------------------------------------------------------
  console.log('Test 1: Enqueue validation and tenant requirement');
  assert.throws(() => {
    testQueue.enqueue({ type: JOB_TYPES.INVESTIGATION });
  }, /organizationId is mandatory/, 'Must reject enqueue without organizationId');

  assert.throws(() => {
    testQueue.enqueue({ organizationId: 'org_acme', type: 'INVALID_TYPE' });
  }, /Invalid job type/, 'Must reject invalid job type');

  const validJob = testQueue.enqueue({
    organizationId: 'org_acme',
    type: JOB_TYPES.INVESTIGATION,
    priority: JOB_PRIORITIES.HIGH,
    payload: { action: 'test' }
  });
  assert.strictEqual(validJob.status, JOB_STATUSES.QUEUED);
  assert.strictEqual(validJob.priority, JOB_PRIORITIES.HIGH);
  assert.strictEqual(validJob.organization_id, 'org_acme');
  console.log('  ✔ Enqueue validation & tenant scoping enforced');

  // -------------------------------------------------------------
  // Test 2: Atomic concurrent claiming
  // -------------------------------------------------------------
  console.log('Test 2: Atomic concurrent claiming (two workers competing)');
  const claimTestJob = testQueue.enqueue({
    organizationId: 'org_acme',
    type: JOB_TYPES.REPORT_GENERATION,
    payload: { test: 'atomic_claim' }
  });

  // Worker 1 and Worker 2 both attempt to claim the job
  const claimedWorker1 = testQueue.claim('worker_alpha', { types: [JOB_TYPES.REPORT_GENERATION], batchSize: 1 });
  const claimedWorker2 = testQueue.claim('worker_beta', { types: [JOB_TYPES.REPORT_GENERATION], batchSize: 1 });

  const worker1HasIt = claimedWorker1.some(j => j.id === claimTestJob.id);
  const worker2HasIt = claimedWorker2.some(j => j.id === claimTestJob.id);

  assert.ok(worker1HasIt && !worker2HasIt, 'Worker 1 claims the job; Worker 2 cannot double-claim it');
  assert.strictEqual(claimedWorker2.length, 0, 'Worker 2 receives 0 claimed jobs');
  console.log('  ✔ Atomic claiming verified: zero double-claim on concurrent workers');

  // -------------------------------------------------------------
  // Test 3: Priority-based claiming
  // -------------------------------------------------------------
  console.log('Test 3: Priority ordering (HIGH before NORMAL before LOW)');
  const lowJob = testQueue.enqueue({
    organizationId: 'org_acme',
    type: JOB_TYPES.HYPOTHESIS_EVALUATION,
    priority: JOB_PRIORITIES.LOW,
    payload: { rank: 'low' }
  });
  const highJob = testQueue.enqueue({
    organizationId: 'org_acme',
    type: JOB_TYPES.HYPOTHESIS_EVALUATION,
    priority: JOB_PRIORITIES.HIGH,
    payload: { rank: 'high' }
  });
  const normalJob = testQueue.enqueue({
    organizationId: 'org_acme',
    type: JOB_TYPES.HYPOTHESIS_EVALUATION,
    priority: JOB_PRIORITIES.NORMAL,
    payload: { rank: 'normal' }
  });

  const firstClaim = testQueue.claim('worker_priority', { types: [JOB_TYPES.HYPOTHESIS_EVALUATION], batchSize: 1 });
  assert.strictEqual(firstClaim.length, 1);
  assert.strictEqual(firstClaim[0].id, highJob.id, 'HIGH priority job must be claimed first');

  const secondClaim = testQueue.claim('worker_priority', { types: [JOB_TYPES.HYPOTHESIS_EVALUATION], batchSize: 1 });
  assert.strictEqual(secondClaim[0].id, normalJob.id, 'NORMAL priority job must be claimed second');

  const thirdClaim = testQueue.claim('worker_priority', { types: [JOB_TYPES.HYPOTHESIS_EVALUATION], batchSize: 1 });
  assert.strictEqual(thirdClaim[0].id, lowJob.id, 'LOW priority job must be claimed third');
  console.log('  ✔ Priority scheduling verified (HIGH -> NORMAL -> LOW)');

  // -------------------------------------------------------------
  // Test 4: Bounded retries & exponential backoff
  // -------------------------------------------------------------
  console.log('Test 4: Bounded retries with exponential backoff on transient failure');
  const retryJob = testQueue.enqueue({
    organizationId: 'org_acme',
    type: JOB_TYPES.EVIDENCE_COLLECTION,
    maxAttempts: 3
  });

  const claimedForRetry = testQueue.claim('worker_retry', { types: [JOB_TYPES.EVIDENCE_COLLECTION], batchSize: 1 });
  const targetJob = claimedForRetry.find(j => j.id === retryJob.id);
  assert.ok(targetJob, 'Job must be claimed');

  // Simulate transient network timeout
  const fail1 = testQueue.fail(targetJob.id, new Error('ETIMEDOUT: Connection reset'));
  assert.strictEqual(fail1.retrying, true);
  assert.strictEqual(fail1.attempt, 1);
  assert.strictEqual(fail1.maxAttempts, 3);

  const jobAfterFail1 = testQueue.getJob(targetJob.id);
  assert.strictEqual(jobAfterFail1.status, JOB_STATUSES.RETRYING);
  assert.strictEqual(jobAfterFail1.error_code, ERROR_CODES.TIMEOUT);
  assert.ok(new Date(jobAfterFail1.scheduled_at).getTime() > Date.now(), 'Next schedule must be in future');
  console.log('  ✔ Transient failure correctly scheduled for bounded retry');

  // -------------------------------------------------------------
  // Test 5: Transition to DEAD_LETTER after max attempts
  // -------------------------------------------------------------
  console.log('Test 5: Transition to DEAD_LETTER when max attempts exceeded');
  // Force scheduled_at to now for next attempts
  db.prepare("UPDATE jobs SET scheduled_at = datetime('now', '-1 minute') WHERE id = ?").run(targetJob.id);

  // Attempt 2
  const claimedAttempt2 = testQueue.claim('worker_retry', { types: [JOB_TYPES.EVIDENCE_COLLECTION], batchSize: 1 });
  testQueue.fail(targetJob.id, new Error('ETIMEDOUT'));

  // Attempt 3 (Final attempt)
  db.prepare("UPDATE jobs SET scheduled_at = datetime('now', '-1 minute') WHERE id = ?").run(targetJob.id);
  const claimedAttempt3 = testQueue.claim('worker_retry', { types: [JOB_TYPES.EVIDENCE_COLLECTION], batchSize: 1 });
  const fail3 = testQueue.fail(targetJob.id, new Error('ETIMEDOUT'));

  assert.strictEqual(fail3.retrying, false);
  assert.strictEqual(fail3.status, JOB_STATUSES.DEAD_LETTER);

  const deadJob = testQueue.getJob(targetJob.id);
  assert.strictEqual(deadJob.status, JOB_STATUSES.DEAD_LETTER);
  assert.strictEqual(deadJob.attempt_count, 3);
  console.log('  ✔ Dead-letter transition verified upon reaching max attempts');

  // -------------------------------------------------------------
  // Test 6: Permanent errors fail immediately without retry
  // -------------------------------------------------------------
  console.log('Test 6: Permanent validation errors fail immediately');
  const permJob = testQueue.enqueue({
    organizationId: 'org_acme',
    type: JOB_TYPES.REPORT_GENERATION
  });
  testQueue.claim('worker_perm', { types: [JOB_TYPES.REPORT_GENERATION], batchSize: 1 });

  const permFail = testQueue.fail(permJob.id, new Error('VALIDATION_ERROR: Missing target report template'));
  assert.strictEqual(permFail.retrying, false);
  assert.strictEqual(permFail.status, JOB_STATUSES.FAILED);

  const failedRecord = testQueue.getJob(permJob.id);
  assert.strictEqual(failedRecord.status, JOB_STATUSES.FAILED);
  assert.strictEqual(failedRecord.attempt_count, 1);
  console.log('  ✔ Non-retryable permanent error terminated immediately');

  // -------------------------------------------------------------
  // Test 7: Idempotency key deduplication
  // -------------------------------------------------------------
  console.log('Test 7: Idempotency key deduplication');
  const idemKey = `idem_${Date.now()}`;
  const firstEnqueue = testQueue.enqueue({
    organizationId: 'org_acme',
    type: JOB_TYPES.INVESTIGATION,
    idempotencyKey: idemKey,
    payload: { step: 1 }
  });

  const secondEnqueue = testQueue.enqueue({
    organizationId: 'org_acme',
    type: JOB_TYPES.INVESTIGATION,
    idempotencyKey: idemKey,
    payload: { step: 2 } // should be ignored
  });

  assert.strictEqual(firstEnqueue.id, secondEnqueue.id, 'Idempotent enqueue must return existing job ID');
  const totalWithKey = db.prepare('SELECT count(*) as count FROM jobs WHERE idempotency_key = ?').get(idemKey).count;
  assert.strictEqual(totalWithKey, 1, 'Database must contain exactly 1 job row for idempotency key');
  console.log('  ✔ Idempotency key deduplication confirmed');

  // -------------------------------------------------------------
  // Test 8: Lease heartbeat & stale job recovery
  // -------------------------------------------------------------
  console.log('Test 8: Lease heartbeat & stale job recovery after worker crash');
  const crashJob = testQueue.enqueue({
    organizationId: 'org_acme',
    type: JOB_TYPES.INVESTIGATION,
    maxAttempts: 3
  });

  const pastHeartbeat = new Date(Date.now() - 60000).toISOString();
  db.prepare("UPDATE jobs SET status = 'RUNNING', worker_id = 'worker_crashed', heartbeat_at = ?, attempt_count = 1 WHERE id = ?").run(pastHeartbeat, crashJob.id);

  const recoveredCount = testQueue.recoverStaleJobs(30000); // 30s threshold
  assert.ok(recoveredCount >= 1, 'Must recover at least the simulated crashed job');

  const recoveredJob = testQueue.getJob(crashJob.id);
  assert.strictEqual(recoveredJob.status, JOB_STATUSES.RETRYING);
  assert.strictEqual(recoveredJob.error_code, 'WORKER_HEARTBEAT_EXPIRED');
  console.log('  ✔ Stale job recovery verified for dead workers');

  // -------------------------------------------------------------
  // Test 9: Execution checkpoints & progress tracking
  // -------------------------------------------------------------
  console.log('Test 9: Execution checkpoints & resumability');
  const chkJob = testQueue.enqueue({
    organizationId: 'org_acme',
    type: JOB_TYPES.INVESTIGATION
  });

  testQueue.checkpoint(chkJob.id, 'SCOPING', 25, { scope: 'services' });
  testQueue.checkpoint(chkJob.id, 'EVIDENCE_COLLECTION', 50, { evidenceCount: 4 });

  const checkpoints = testQueue.getCheckpoints(chkJob.id);
  assert.strictEqual(checkpoints.length, 2);
  assert.strictEqual(checkpoints[0].phase, 'SCOPING');
  assert.strictEqual(checkpoints[0].progress_pct, 25);
  assert.strictEqual(checkpoints[1].phase, 'EVIDENCE_COLLECTION');
  assert.strictEqual(checkpoints[1].progress_pct, 50);
  console.log('  ✔ Incremental checkpoints recorded & retrieved in order');

  // -------------------------------------------------------------
  // Test 10: Cooperative cancellation
  // -------------------------------------------------------------
  console.log('Test 10: Cooperative job cancellation');
  const cancelJob = testQueue.enqueue({
    organizationId: 'org_acme',
    type: JOB_TYPES.INVESTIGATION
  });

  const cancelled = testQueue.cancel(cancelJob.id, 'User stopped test', 'org_acme');
  assert.strictEqual(cancelled, true);

  const cancelledRecord = testQueue.getJob(cancelJob.id);
  assert.strictEqual(cancelledRecord.status, JOB_STATUSES.CANCELLED);
  assert.strictEqual(cancelledRecord.error_code, ERROR_CODES.CANCELLED);

  // Claiming should never return cancelled job
  const claimAfterCancel = testQueue.claim('worker_check', { batchSize: 10 });
  assert.ok(!claimAfterCancel.some(j => j.id === cancelJob.id), 'Cancelled job must not be claimed');
  console.log('  ✔ Cooperative cancellation verified');

  // -------------------------------------------------------------
  // Test 11: Multi-tenant isolation for jobs
  // -------------------------------------------------------------
  console.log('Test 11: Multi-tenant job isolation');
  const globexJob = testQueue.enqueue({
    organizationId: 'org_globex',
    type: JOB_TYPES.INVESTIGATION
  });

  // Tenant Acme querying Globex job must receive null
  const acmeLookup = testQueue.getJob(globexJob.id, 'org_acme');
  assert.strictEqual(acmeLookup, null, 'Tenant A cannot inspect Tenant B job');

  // Tenant Acme cannot cancel Globex job
  const acmeCancel = testQueue.cancel(globexJob.id, 'Malicious cancel', 'org_acme');
  assert.strictEqual(acmeCancel, false, 'Tenant A cannot cancel Tenant B job');

  // Tenant Acme job list must not include Globex job
  const acmeList = testQueue.listJobs({ organizationId: 'org_acme' });
  assert.ok(!acmeList.some(j => j.id === globexJob.id), 'Tenant A list must exclude Tenant B jobs');
  console.log('  ✔ Server-side tenant isolation strictly enforced on jobs');

  // -------------------------------------------------------------
  // Test 12: End-to-End Investigation Async Workflow Execution
  // -------------------------------------------------------------
  console.log('Test 12: End-to-end investigation execution with JobWorker');
  const sampleInv = db.prepare('SELECT id FROM investigations WHERE project_id IN (SELECT id FROM projects WHERE organization_id = ?) LIMIT 1').get('org_acme');
  assert.ok(sampleInv, 'Investigation fixture must exist in org_acme');

  const e2eJob = testQueue.enqueue({
    organizationId: 'org_acme',
    investigationId: sampleInv.id,
    type: JOB_TYPES.INVESTIGATION
  });

  const worker = new JobWorker({
    queue: testQueue,
    concurrency: 1,
    pollIntervalMs: 50,
    heartbeatIntervalMs: 200
  });

  // Claim and execute directly
  const claimedJobs = testQueue.claim(worker.id, { types: [JOB_TYPES.INVESTIGATION], batchSize: 20 });
  const e2eClaimed = claimedJobs.find(j => j.id === e2eJob.id);
  assert.ok(e2eClaimed, 'Worker claimed investigation job');

  await worker._executeJob(e2eClaimed);

  const completedJob = testQueue.getJob(e2eJob.id);
  assert.strictEqual(completedJob.status, JOB_STATUSES.SUCCEEDED);
  assert.ok(completedJob.result, 'Result payload must be present');
  assert.strictEqual(completedJob.result.investigationId, sampleInv.id);

  const jobCheckpoints = testQueue.getCheckpoints(e2eJob.id);
  assert.ok(jobCheckpoints.length >= 4, 'Must have recorded checkpoints for all phases');
  assert.strictEqual(jobCheckpoints[jobCheckpoints.length - 1].phase, 'COMPLETED');
  console.log('  ✔ End-to-end investigation worker execution succeeded with full checkpoint trail');

  // -------------------------------------------------------------
  // Test 13: Worker Lifecycle & Graceful Shutdown
  // -------------------------------------------------------------
  console.log('Test 13: Worker lifecycle transitions & graceful shutdown');
  const lifecycleWorker = new JobWorker({ queue: testQueue, pollIntervalMs: 100 });
  assert.strictEqual(lifecycleWorker.state, WORKER_STATES.STOPPED);

  lifecycleWorker.start();
  assert.strictEqual(lifecycleWorker.state, WORKER_STATES.RUNNING);

  await lifecycleWorker.stop(500);
  assert.strictEqual(lifecycleWorker.state, WORKER_STATES.STOPPED);
  console.log('  ✔ Worker graceful shutdown verified');

  // -------------------------------------------------------------
  // Test 14: HTTP API: POST /api/v1/jobs (enqueue with 202 Accepted)
  // -------------------------------------------------------------
  console.log('Test 14: HTTP API: POST /api/v1/jobs returns 202 Accepted with tenant isolation');
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const orgAlpha = createTestOrganization('HTTP Alpha Corp');
    const orgBeta = createTestOrganization('HTTP Beta Industries');
    const userAlpha = createTestUser(`http_alpha_${Date.now()}@alpha.internal`, 'AlphaPass2026!', 'Alpha User');
    const userBeta = createTestUser(`http_beta_${Date.now()}@beta.internal`, 'BetaPass2026!', 'Beta User');
    createMembership(userAlpha.id, orgAlpha.id, 'MEMBER');
    createMembership(userBeta.id, orgBeta.id, 'MEMBER');
    const tokenAlpha = authenticateAs(userAlpha.id, orgAlpha.id);
    const tokenBeta = authenticateAs(userBeta.id, orgBeta.id);

    const projAlphaId = `prj_http_${Date.now()}`;
    db.prepare("INSERT INTO projects (id, organization_id, name, description, status, created_at, updated_at) VALUES (?, ?, 'HTTP Proj', 'Test', 'ACTIVE', datetime('now'), datetime('now'))").run(projAlphaId, orgAlpha.id);
    const invAlphaId = `inv_http_${Date.now()}`;
    db.prepare("INSERT INTO investigations (id, project_id, created_by, title, problem_statement, status, severity, started_at, updated_at) VALUES (?, ?, ?, 'HTTP Test Inv', 'Problem', 'DRAFT', 'SEV2', datetime('now'), datetime('now'))").run(invAlphaId, projAlphaId, userAlpha.id);

    const jobRes = await fetch(`${baseUrl}/api/v1/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenAlpha}`
      },
      body: JSON.stringify({
        type: JOB_TYPES.REPORT_GENERATION,
        payload: { target: 'summary' },
        priority: 'HIGH'
      })
    });
    const jobData = await jobRes.json();
    assert.strictEqual(jobRes.status, 202, 'POST /api/v1/jobs must return 202 Accepted');
    assert.strictEqual(jobData.success, true);
    assert.strictEqual(jobData.data.organization_id, orgAlpha.id);
    assert.strictEqual(jobData.data.status, 'QUEUED');
    console.log('  ✔ POST /api/v1/jobs returns 202 Accepted and safely bounds to authenticated tenant');

    // -------------------------------------------------------------
    // Test 15: HTTP API: GET /api/v1/jobs/:id (anti-IDOR)
    // -------------------------------------------------------------
    console.log('Test 15: HTTP API: GET /api/v1/jobs/:id (anti-IDOR enforcement)');
    const createdJobId = jobData.data.id;

    // Tenant Alpha queries own job -> 200 OK
    const getAlphaRes = await fetch(`${baseUrl}/api/v1/jobs/${createdJobId}`, {
      headers: { 'Authorization': `Bearer ${tokenAlpha}` }
    });
    const getAlphaData = await getAlphaRes.json();
    assert.strictEqual(getAlphaRes.status, 200);
    assert.strictEqual(getAlphaData.data.id, createdJobId);

    // Tenant Beta queries Alpha's job -> 404 NOT_FOUND
    const getBetaRes = await fetch(`${baseUrl}/api/v1/jobs/${createdJobId}`, {
      headers: { 'Authorization': `Bearer ${tokenBeta}` }
    });
    assert.strictEqual(getBetaRes.status, 404, 'Cross-tenant job lookup must return 404 NOT_FOUND');
    console.log('  ✔ GET /api/v1/jobs/:id strictly blocks cross-tenant access with 404');

    // -------------------------------------------------------------
    // Test 16: HTTP API: GET /api/v1/jobs list filtering
    // -------------------------------------------------------------
    console.log('Test 16: HTTP API: GET /api/v1/jobs list tenant filtering');
    const listAlphaRes = await fetch(`${baseUrl}/api/v1/jobs`, {
      headers: { 'Authorization': `Bearer ${tokenAlpha}` }
    });
    const listAlphaData = await listAlphaRes.json();
    assert.strictEqual(listAlphaRes.status, 200);
    assert.ok(listAlphaData.data.every(j => j.organization_id === orgAlpha.id));
    console.log('  ✔ GET /api/v1/jobs lists only authenticated tenant jobs');

    // -------------------------------------------------------------
    // Test 17: HTTP API: POST /api/v1/jobs/:id/cancel
    // -------------------------------------------------------------
    console.log('Test 17: HTTP API: POST /api/v1/jobs/:id/cancel');
    // Beta attempts to cancel Alpha's job -> 404
    const cancelBetaRes = await fetch(`${baseUrl}/api/v1/jobs/${createdJobId}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenBeta}`
      },
      body: JSON.stringify({ reason: 'Attack' })
    });
    assert.strictEqual(cancelBetaRes.status, 404);

    // Alpha cancels own job -> 200 OK
    const cancelAlphaRes = await fetch(`${baseUrl}/api/v1/jobs/${createdJobId}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenAlpha}`
      },
      body: JSON.stringify({ reason: 'Legitimate cancel' })
    });
    const cancelAlphaData = await cancelAlphaRes.json();
    assert.strictEqual(cancelAlphaRes.status, 200);
    assert.strictEqual(cancelAlphaData.data.status, 'CANCELLED');
    console.log('  ✔ POST /api/v1/jobs/:id/cancel securely cancels with tenant authorization');

    // -------------------------------------------------------------
    // Test 18: HTTP API: POST /api/v1/investigations/:id/execute
    // -------------------------------------------------------------
    console.log('Test 18: HTTP API: POST /api/v1/investigations/:id/execute');
    const execRes = await fetch(`${baseUrl}/api/v1/investigations/${invAlphaId}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenAlpha}`
      },
      body: JSON.stringify({ priority: 'HIGH' })
    });
    const execData = await execRes.json();
    assert.strictEqual(execRes.status, 202);
    assert.strictEqual(execData.success, true);
    assert.ok(execData.data.job.id);
    assert.strictEqual(execData.data.job.status, 'QUEUED');
    console.log('  ✔ POST /api/v1/investigations/:id/execute returns 202 Accepted with queued job');

    // -------------------------------------------------------------
    // Test 19: HTTP API: POST /api/v1/investigations?async=true
    // -------------------------------------------------------------
    console.log('Test 19: HTTP API: POST /api/v1/investigations?async=true');
    const asyncInvRes = await fetch(`${baseUrl}/api/v1/investigations?async=true`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenAlpha}`
      },
      body: JSON.stringify({
        title: 'Async API Test Incident',
        problem_statement: 'High memory saturation under load',
        project_id: projAlphaId,
        severity: 'SEV1'
      })
    });
    const asyncInvData = await asyncInvRes.json();
    assert.strictEqual(asyncInvRes.status, 202);
    assert.strictEqual(asyncInvData.success, true);
    assert.ok(asyncInvData.data.id);
    assert.ok(asyncInvData.job.id);
    assert.strictEqual(asyncInvData.job.status, 'QUEUED');
    console.log('  ✔ POST /api/v1/investigations?async=true returns 202 Accepted with investigation + job');
  } finally {
    server.close();
  }

  console.log('\n✔ ALL JOB QUEUE & WORKER ARCHITECTURE TESTS PASSED (100% GREEN - 19/19 CHECKS)');
  return true;
}

if (require.main === module) {
  runJobQueueTests().catch(err => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  });
}

module.exports = {
  runJobQueueTests
};
