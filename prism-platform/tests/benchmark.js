// PRISM Performance & Evaluation Benchmark Suite
// Aligned with 20-BENCHMARKS-EVALUATION/BENCHMARK-SUITE.md

const { validateTransition, STATES } = require('../src/engine/stateMachine');
const { computeEvidenceHash } = require('../src/engine/evidenceEngine');
const { evaluateHypothesisConfidence } = require('../src/engine/intelligenceEngine');
const { searchMemories } = require('../src/engine/memoryEngine');

console.log('=====================================================');
console.log('⚡ PRISM BENCHMARK SUITE EXECUTION');
console.log('=====================================================\n');

// 1. State Machine Transition Guard Benchmark
const smStart = performance.now();
const smIterations = 20000;
for (let i = 0; i < smIterations; i++) {
  validateTransition(STATES.EVIDENCE_COLLECTION, STATES.HYPOTHESIS_GENERATION, { evidenceCount: 2 });
}
const smDuration = performance.now() - smStart;
const smOpsPerSec = Math.round((smIterations / smDuration) * 1000);
console.log(`✔ State Machine Validator: ${smOpsPerSec.toLocaleString()} ops/sec (${smDuration.toFixed(2)}ms for ${smIterations} ops)`);

// 2. Cryptographic Evidence Hashing Benchmark
const hashStart = performance.now();
const hashIterations = 10000;
const payload = 'Sample log line with stack trace and timestamps '.repeat(20);
for (let i = 0; i < hashIterations; i++) {
  computeEvidenceHash('LOG_EVIDENCE', 'pod-benchmark-01', 'logs/syslog', payload);
}
const hashDuration = performance.now() - hashStart;
const hashOpsPerSec = Math.round((hashIterations / hashDuration) * 1000);
console.log(`✔ Evidence SHA-256 Hasher: ${hashOpsPerSec.toLocaleString()} hashes/sec (${hashDuration.toFixed(2)}ms for ${hashIterations} ops)`);

// 3. Hypothesis Engine Calibration Benchmark
const hypStart = performance.now();
const hypIterations = 5000;
const mockHyp = { supporting_evidence_ids: ['e1', 'e2', 'e3'], conflicting_evidence_ids: ['e4'] };
const mockEvi = [
  { id: 'e1', reliability: 0.95 },
  { id: 'e2', reliability: 0.98 },
  { id: 'e3', reliability: 0.92 },
  { id: 'e4', reliability: 0.60 }
];
for (let i = 0; i < hypIterations; i++) {
  evaluateHypothesisConfidence(mockHyp, mockEvi);
}
const hypDuration = performance.now() - hypStart;
const hypOpsPerSec = Math.round((hypIterations / hypDuration) * 1000);
console.log(`✔ Hypothesis Evaluator: ${hypOpsPerSec.toLocaleString()} evaluations/sec (${hypDuration.toFixed(2)}ms for ${hypIterations} ops)`);

// 4. Incident Memory Retrieval Benchmark
const memStart = performance.now();
const memIterations = 3000;
const mockMemories = Array.from({ length: 50 }, (_, idx) => ({
  id: `mem_${idx}`,
  title: `Incident ${idx} with Redis lock and PostgreSQL pool exhaustion`,
  summary: `Summary of checkout incident ${idx}`,
  root_cause: `Deadlock at step ${idx}`,
  resolution: `Applied fix ${idx}`,
  tags: '["redis","lock","postgres"]',
  created_at: new Date(Date.now() - idx * 86400000).toISOString()
}));
for (let i = 0; i < memIterations; i++) {
  searchMemories(mockMemories, 'redis deadlock');
}
const memDuration = performance.now() - memStart;
const memOpsPerSec = Math.round((memIterations / memDuration) * 1000);
console.log(`✔ Memory Retrieval Engine: ${memOpsPerSec.toLocaleString()} searches/sec (${memDuration.toFixed(2)}ms for ${memIterations} ops)`);

console.log('\n=====================================================');
console.log('🚀 ALL BENCHMARKS COMPLETED WITH EXTREME EFFICIENCY');
console.log('=====================================================');
