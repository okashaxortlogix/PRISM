// PRISM Evidence Engine Test Suite
const assert = require('node:assert');
const { 
  EVIDENCE_TYPES, 
  computeEvidenceHash, 
  verifyEvidenceIntegrity, 
  normalizeEvidence 
} = require('../src/engine/evidenceEngine');

function testEvidenceEngine() {
  console.log('Running PRISM Evidence Engine Tests...');

  // 1. Hash computation determinism
  const hash1 = computeEvidenceHash(EVIDENCE_TYPES.LOG_EVIDENCE, 'pod-123', 'syslog', 'Error connection timed out');
  const hash2 = computeEvidenceHash(EVIDENCE_TYPES.LOG_EVIDENCE, 'pod-123', 'syslog', 'Error connection timed out');
  assert.strictEqual(hash1, hash2, 'Hash must be strictly deterministic');

  // 2. Normalization
  const normalized = normalizeEvidence({
    investigation_id: 'inv_test',
    type: EVIDENCE_TYPES.REPOSITORY_CODE,
    source: 'github.com/acme/repo',
    source_ref: 'commit/abcdef',
    title: 'Code commit',
    content: 'const x = 1;'
  });
  assert.strictEqual(normalized.type, EVIDENCE_TYPES.REPOSITORY_CODE);
  assert.strictEqual(normalized.reliability, 0.98);
  assert.ok(normalized.hash, 'Must generate SHA-256 hash');

  // 3. Tamper detection
  const intactCheck = verifyEvidenceIntegrity(normalized);
  assert.strictEqual(intactCheck.valid, true, 'Untampered evidence must verify successfully');

  const tamperedItem = { ...normalized, content: 'const x = 999; // tampered!' };
  const tamperedCheck = verifyEvidenceIntegrity(tamperedItem);
  assert.strictEqual(tamperedCheck.valid, false, 'Tampered evidence must fail integrity check');

  console.log('✔ All Evidence Engine Tests Passed!');
}

if (require.main === module) {
  testEvidenceEngine();
}

module.exports = { testEvidenceEngine };
