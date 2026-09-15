// PRISM Verification Engine Test Suite
const assert = require('node:assert');
const { OUTCOMES, recordVerification, evaluateAssertion } = require('../src/engine/verificationEngine');

function testVerificationEngine() {
  console.log('Running PRISM Verification Engine Tests...');

  // 1. Valid verification record
  const v1 = recordVerification({
    experiment_id: 'exp_01',
    claim: 'Connection pool exhausted under 500 RPS',
    method: 'Apache Bench 500 RPS',
    expected_result: '503 Service Unavailable with PoolExhaustedError',
    actual_result: 'Received 503 PoolExhaustedError on 412 requests',
    outcome: OUTCOMES.VERIFIED,
    performed_by: 'usr_sre'
  });
  assert.strictEqual(v1.outcome, OUTCOMES.VERIFIED);

  // 2. Reject inconclusive masquerading as verified
  assert.throws(() => {
    recordVerification({
      experiment_id: 'exp_02',
      claim: 'Cache miss rate spike',
      method: 'StatsD gauge sample',
      expected_result: 'Miss rate > 50%',
      actual_result: 'Not enough data collected during sample window',
      outcome: OUTCOMES.VERIFIED, // Violation!
      performed_by: 'usr_sre'
    });
  }, /Contradiction detected/, 'Must reject claiming VERIFIED when result indicates inconclusive data');

  // 3. Assertion evaluation
  const assertionPass = evaluateAssertion('PoolExhaustedError', 'Fatal error: PoolExhaustedError at line 42');
  assert.strictEqual(assertionPass.outcome, OUTCOMES.VERIFIED);

  const assertionFail = evaluateAssertion('NullPointerException', 'All tests completed successfully without errors.');
  assert.strictEqual(assertionFail.outcome, OUTCOMES.REJECTED);

  console.log('✔ All Verification Engine Tests Passed!');
}

if (require.main === module) {
  testVerificationEngine();
}

module.exports = { testVerificationEngine };
