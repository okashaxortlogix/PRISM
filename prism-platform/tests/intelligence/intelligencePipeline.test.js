/**
 * PRISM AI Intelligence, Sandbox Verification & Decision Engine Test Suite
 * Covers P1-04 (AI Gateway), P1-05 (Sandbox), P1-06 (Decision/Blast Radius), P2-01 (Vector Memory)
 */
const assert = require('node:assert');
const { getDatabase, initDatabase } = require('../../src/db/database');
const { AIGateway } = require('../../src/ai/gateway');
const { synthesizeHypotheses, detectContradictions, evaluateHypothesisConfidence } = require('../../src/engine/intelligenceEngine');
const { ExecutionSandbox } = require('../../src/sandbox/executionSandbox');
const { runSandboxExperiment, recordVerification } = require('../../src/engine/verificationEngine');
const { synthesizeRootCause, assessCodeBlastRadius, assessBlastRadius } = require('../../src/engine/decisionEngine');
const { generateEmbedding, cosineSimilarity } = require('../../src/ai/embeddings');
const { semanticSearchMemories } = require('../../src/engine/memoryEngine');

async function runIntelligencePipelineTests() {
  console.log('\n=====================================================');
  console.log('🧠 RUNNING PRISM AI, SANDBOX & DECISION ENGINE TESTS');
  console.log('=====================================================');

  let passedCount = 0;

  async function runTest(name, fn) {
    try {
      await fn();
      console.log(`  ✔ ${name}`);
      passedCount++;
    } catch (err) {
      console.error(`  ✖ FAIL: ${name}`);
      console.error(err);
      throw err;
    }
  }

  initDatabase();
  const db = getDatabase();

  await runTest('Test 1: AIGateway structured output generation adheres to schema', async () => {
    const gateway = new AIGateway();
    const result = await gateway.generateStructuredOutput({
      systemPrompt: 'System',
      userPrompt: 'Investigate memory leak in cache layer with evi_123',
      schema: {
        type: 'object',
        properties: {
          hypotheses: { type: 'array' }
        }
      }
    });

    assert.ok(result);
    assert.ok(Array.isArray(result.hypotheses));
    assert.ok(result.hypotheses.length >= 2);
    const stmt = result.hypotheses[0].statement.toLowerCase();
    assert.ok(stmt.includes('memory leak') || stmt.includes('allocation') || stmt.includes('heap'));
    assert.ok(result.hypotheses[0].supporting_evidence_ids.includes('evi_123'));
  });

  await runTest('Test 2: synthesizeHypotheses creates evidence-grounded hypotheses with citations', async () => {
    const mockEvidence = [
      { id: 'evi_log_44', type: 'LOG_EVIDENCE', title: 'Connection pool timeout', content: 'Connection acquisition timed out after 5000ms' }
    ];

    const hypotheses = await synthesizeHypotheses('Slow database query responses during peak traffic', mockEvidence, []);
    assert.ok(Array.isArray(hypotheses));
    assert.ok(hypotheses.length >= 1);
    assert.ok(hypotheses[0].statement);
    assert.ok(hypotheses[0].falsification_condition);
  });

  await runTest('Test 3: detectContradictions identifies refuting evidence', () => {
    const hyp = {
      statement: 'Timeout caused by database contention',
      falsification_condition: 'Telemetry shows response latency under 200ms and stable'
    };

    const contradictEvi = {
      type: 'LOG_EVIDENCE',
      content: 'Database query executed cleanly with latency: 2ms'
    };

    const match = detectContradictions(hyp, contradictEvi);
    assert.strictEqual(match.contradicts, true);

    const neutralEvi = {
      type: 'METRIC_TRACE',
      content: 'CPU usage at 45%'
    };
    assert.strictEqual(detectContradictions(hyp, neutralEvi).contradicts, false);
  });

  await runTest('Test 4: ExecutionSandbox executes isolated node code and captures stdout', async () => {
    const sandbox = new ExecutionSandbox({ timeoutMs: 3000 });
    const result = await sandbox.runNodeVerification('console.log("PRISM_SANDBOX_OK"); process.exit(0);');
    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stdout, 'PRISM_SANDBOX_OK');
    assert.strictEqual(result.timedOut, false);
  });

  await runTest('Test 5: ExecutionSandbox enforces timeout limits on runaway code', async () => {
    const sandbox = new ExecutionSandbox({ timeoutMs: 500 });
    const result = await sandbox.runNodeVerification('while (true) {}');
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.timedOut, true);
  });

  await runTest('Test 6: runSandboxExperiment verifies hypothesis condition', async () => {
    const hyp = { id: 'hyp_test_1', statement: 'Syntax error in module import' };
    const exp = { id: 'exp_test_1', plan: 'Verify module syntax' };

    const outcome = await runSandboxExperiment(exp, hyp);
    assert.strictEqual(outcome.hypothesisId, 'hyp_test_1');
    assert.strictEqual(outcome.passed, true);
    assert.strictEqual(outcome.outcome, 'CONFIRMED');
  });

  await runTest('Test 7: synthesizeRootCause creates root cause record and actionable recommendations', () => {
    const invId = `inv_rc_${Date.now()}`;
    const hypId = `hyp_rc_${Date.now()}`;
    const eviId = `evi_rc_${Date.now()}`;

    // Setup test records
    db.prepare(`
      INSERT INTO organizations (id, name, slug, created_at, updated_at)
      VALUES ('org_rc', 'RC Org', 'rc-org', datetime('now'), datetime('now'))
      ON CONFLICT DO NOTHING
    `).run();

    db.prepare(`
      INSERT INTO projects (id, organization_id, name, description, status, created_at, updated_at)
      VALUES ('proj_rc', 'org_rc', 'RC Proj', 'desc', 'ACTIVE', datetime('now'), datetime('now'))
      ON CONFLICT DO NOTHING
    `).run();

    db.prepare(`
      INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at)
      VALUES ('user_rc', 'rc@prism.test', 'hash', 'RC User', 'ACTIVE', datetime('now'), datetime('now'))
      ON CONFLICT DO NOTHING
    `).run();

    db.prepare(`
      INSERT INTO investigations (id, project_id, created_by, title, problem_statement, status, severity, started_at, updated_at)
      VALUES (?, 'proj_rc', 'user_rc', 'Crash on startup', 'Crash problem', 'ANALYZING', 'SEV2', datetime('now'), datetime('now'))
    `).run(invId);

    db.prepare(`
      INSERT INTO evidence (id, investigation_id, type, source, source_ref, title, content, observed_at, collected_at, reliability, provenance, hash)
      VALUES (?, ?, 'LOG_EVIDENCE', 'APM', 'ref', 'Crash log', 'Fatal unhandled exception', datetime('now'), datetime('now'), 1.0, 'Test Prov', 'hash123')
    `).run(eviId, invId);

    db.prepare(`
      INSERT INTO hypotheses (id, investigation_id, statement, rationale, confidence, status, created_at, updated_at)
      VALUES (?, ?, 'Null pointer dereference in auth middleware', 'Log shows undefined session', 0.92, 'PLAUSIBLE', datetime('now'), datetime('now'))
    `).run(hypId, invId);

    const heId = `he_rc_${Date.now()}`;
    db.prepare(`
      INSERT INTO hypothesis_evidence (id, hypothesis_id, evidence_id, relationship_type, created_at)
      VALUES (?, ?, ?, 'SUPPORTS', datetime('now'))
    `).run(heId, hypId, eviId);

    const { rootCause, recommendations } = synthesizeRootCause(invId, db);
    assert.ok(rootCause);
    assert.ok(rootCause.statement.includes('Null pointer dereference'));
    assert.strictEqual(rootCause.supportingEvidenceIds.includes(eviId), true);
    assert.ok(recommendations.length >= 2);
    assert.ok(recommendations.some(r => r.priority === 'P0'));

    // Check database records
    const dbRc = db.prepare('SELECT * FROM root_causes WHERE investigation_id = ?').get(invId);
    assert.ok(dbRc);
    const dbRecs = db.prepare('SELECT * FROM recommendations WHERE investigation_id = ?').all(invId);
    assert.strictEqual(dbRecs.length, recommendations.length);
  });

  await runTest('Test 8: Vector embeddings & cosine similarity match related concepts', () => {
    const vecA = generateEmbedding('Fatal memory leak and heap out of memory crash');
    const vecB = generateEmbedding('Unbounded heap growth and OOM failure');
    const vecC = generateEmbedding('CSS layout button padding alignment');

    assert.strictEqual(vecA.length, 64);
    assert.strictEqual(vecB.length, 64);

    const simAB = cosineSimilarity(vecA, vecB);
    const simAC = cosineSimilarity(vecA, vecC);

    assert.ok(simAB > 0.4, `Expected similarity between memory incidents to be high, got ${simAB}`);
    assert.ok(simAB > simAC, `Expected memory-memory similarity (${simAB}) to exceed memory-css similarity (${simAC})`);
  });

  await runTest('Test 9: semanticSearchMemories ranks historical incidents by vector similarity', () => {
    const historicalMemories = [
      {
        id: 'mem_1',
        title: 'High latency on postgres query',
        summary: 'Slow table scan causing database connection pool timeouts',
        root_cause: 'Missing composite index on tenant_id and created_at',
        resolution: 'Created B-tree composite index',
        created_at: new Date().toISOString()
      },
      {
        id: 'mem_2',
        title: 'Dark mode toggle CSS glitch',
        summary: 'Button icon overlapped with navbar text on safari',
        root_cause: 'Missing flex wrap css rule',
        resolution: 'Applied flex-wrap and margin',
        created_at: new Date().toISOString()
      }
    ];

    const results = semanticSearchMemories(historicalMemories, 'database connection latency timeout');
    assert.ok(results.length >= 1);
    assert.strictEqual(results[0].id, 'mem_1');
    assert.ok(results[0].similarity > 0.1);
  });

  console.log(`\n✔ ALL AI, SANDBOX & DECISION TESTS PASSED (${passedCount}/${passedCount})\n`);
  return passedCount;
}

if (require.main === module) {
  runIntelligencePipelineTests();
}

module.exports = { runIntelligencePipelineTests };
