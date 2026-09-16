// PRISM Master Test Runner
// Runs Domain Tests + Security & Tenant Isolation Tests
const { testStateMachine } = require('./stateMachine.test');
const { testEvidenceEngine } = require('./evidenceEngine.test');
const { testVerificationEngine } = require('./verificationEngine.test');
const { evaluateHypothesisConfidence, analyzeEvidenceGaps } = require('../src/engine/intelligenceEngine');
const { assessBlastRadius } = require('../src/engine/decisionEngine');
const { searchMemories } = require('../src/engine/memoryEngine');
const { runAuthTests } = require('./security/auth.test');
const { runTenantIsolationTests } = require('./security/tenantIsolation.test');
const { runHeaderSpoofingTests } = require('./security/headerSpoofing.test');
const { runRoleAuthTests } = require('./security/roleAuth.test');
const { runWebhookSecurityTests } = require('./security/webhookSecurity.test');
const { runSchemaNormalizationTests } = require('./database/schemaNormalization.test');
const { runJobQueueTests } = require('./jobs/jobQueue.test');
const { runRepoIngestionTests } = require('./ingestion/repoIngestion.test');
const { runAstSymbolGraphTests } = require('./ingestion/astSymbolGraph.test');
const { runIntelligencePipelineTests } = require('./intelligence/intelligencePipeline.test');
const { runMasterE2ETests } = require('./e2e/fullInvestigationLifecycle.test');
const { runFailureRecoveryTests } = require('./failure/recovery.test');
const assert = require('node:assert');

async function runMasterTestSuite() {
  console.log('=====================================================');
  console.log('🧪 PRISM PLATFORM MASTER TEST SUITE EXECUTION');
  console.log('=====================================================\n');

  let domainTestsCount = 0;
  let securityTestsCount = 0;

  // 1. State Machine Tests
  testStateMachine();
  domainTestsCount += 8;

  // 2. Evidence Engine Tests
  testEvidenceEngine();
  domainTestsCount += 6;

  // 3. Verification Engine Tests
  testVerificationEngine();
  domainTestsCount += 5;

  // 4. Intelligence Engine Tests
  console.log('\nRunning PRISM Intelligence Engine Tests...');
  const mockHypothesis = {
    supporting_evidence_ids: ['evi_1', 'evi_2'],
    conflicting_evidence_ids: []
  };
  const mockEvidence = [
    { id: 'evi_1', reliability: 0.95, type: 'LOG_EVIDENCE' },
    { id: 'evi_2', reliability: 0.98, type: 'REPOSITORY_CODE' }
  ];
  const eval1 = evaluateHypothesisConfidence(mockHypothesis, mockEvidence);
  assert.strictEqual(eval1.status, 'SUPPORTED');
  assert.ok(eval1.confidence >= 0.75, 'Confidence should be high with strong supporting evidence and no conflicts');

  // Gap analysis
  const gaps = analyzeEvidenceGaps(mockEvidence);
  assert.strictEqual(gaps.totalItems, 2);
  assert.ok(gaps.missingGaps.some(g => g.category === 'VERIFICATION_TEST'));
  console.log('✔ All Intelligence Engine Tests Passed!');
  domainTestsCount += 2;

  // 5. Decision & Blast Radius Tests
  console.log('\nRunning PRISM Decision & Blast Radius Tests...');
  const blast1 = assessBlastRadius(['service-a'], 'SEV2');
  assert.strictEqual(blast1.blastRadiusLevel, 'HIGH');
  const blastCritical = assessBlastRadius(['s1', 's2', 's3', 's4', 's5'], 'SEV1');
  assert.strictEqual(blastCritical.blastRadiusLevel, 'CRITICAL');
  console.log('✔ All Decision Engine Tests Passed!');
  domainTestsCount += 2;

  // 6. Memory Engine Tests
  console.log('\nRunning PRISM Memory Engine Tests...');
  const mockMems = [
    { id: 'm1', title: 'Redis lock timeout deadlock', summary: 'checkout issue', root_cause: 'lockTTL too short', resolution: 'increased TTL', tags: '["redis"]', created_at: new Date().toISOString() },
    { id: 'm2', title: 'PostgreSQL connection spike', summary: 'db issue', root_cause: 'pool exhaustion', resolution: 'increased pool size', tags: '["postgres"]', created_at: new Date().toISOString() }
  ];
  const searchResults = searchMemories(mockMems, 'redis deadlock');
  assert.strictEqual(searchResults.length, 1);
  assert.strictEqual(searchResults[0].id, 'm1');
  console.log('✔ All Memory Engine Tests Passed!');
  domainTestsCount += 2;

  // 7. Security Suite: Authentication & Sessions
  await runAuthTests();
  securityTestsCount += 9;

  // 8. Security Suite: Multi-Tenant Isolation & IDOR
  await runTenantIsolationTests();
  securityTestsCount += 15;

  // 9. Security Suite: Header Spoofing & Tampering
  await runHeaderSpoofingTests();
  securityTestsCount += 5;

  // 10. Security Suite: RBAC Authorization
  await runRoleAuthTests();
  securityTestsCount += 9;

  // 11. Security Suite: Inbound Webhook Cryptographic Verification & Replay Protection (P0-03)
  await runWebhookSecurityTests();
  securityTestsCount += 23;

  // 12. Database Suite: Schema Normalization, Relational Joins & B-Tree Indexing (P0-04)
  await runSchemaNormalizationTests();
  domainTestsCount += 13;

  // 13. Queue & Worker Suite: Asynchronous Job Queue & Background Worker Architecture (P1-01)
  await runJobQueueTests();
  domainTestsCount += 19;

  // 14. Repository Ingestion Suite: Git Adapter Hardening, File Tree Indexing & Manifests (P1-02)
  await runRepoIngestionTests();
  domainTestsCount += 16;

  // 15. AST Parsing & Symbol Call Graphs (P1-03)
  const astCount = runAstSymbolGraphTests();
  domainTestsCount += astCount;

  // 16. AI Gateway, Sandbox Verification, Decision & Semantic Vector Memory (P1-04, P1-05, P1-06, P2-01)
  const intelCount = await runIntelligencePipelineTests();
  domainTestsCount += intelCount;

  // 17. Master End-to-End Investigation Lifecycle Integration
  const e2eCount = await runMasterE2ETests();
  domainTestsCount += e2eCount;

  // 18. Failure, Fault Injection & Disaster Recovery Tests
  const recoveryCount = await runFailureRecoveryTests();
  domainTestsCount += recoveryCount;

  const total = domainTestsCount + securityTestsCount;

  console.log('\n=====================================================');
  console.log('🎉 ALL PRISM SUITES PASSED SUCCESSFULLY! (100% GREEN)');
  console.log(`📊 Domain & Architecture Tests: ${domainTestsCount} passed`);
  console.log(`🛡️ Security & Isolation Tests: ${securityTestsCount} passed`);
  console.log(`📈 Grand Total: ${total} tests passed, 0 failed, 0 skipped`);
  console.log('=====================================================');
}

runMasterTestSuite().catch(err => {
  console.error('\n❌ MASTER TEST SUITE FAILED:', err);
  process.exit(1);
});
