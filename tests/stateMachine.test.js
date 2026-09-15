// PRISM State Machine Test Suite
const assert = require('node:assert');
const { STATES, validateTransition } = require('../src/engine/stateMachine');

function testStateMachine() {
  console.log('Running PRISM State Machine Tests...');

  // 1. Legal transition DRAFT -> SCOPING
  const t1 = validateTransition(STATES.DRAFT, STATES.SCOPING);
  assert.strictEqual(t1.valid, true, 'DRAFT -> SCOPING should be valid');

  // 2. Illegal transition DRAFT -> ROOT_CAUSE_REVIEW
  const t2 = validateTransition(STATES.DRAFT, STATES.ROOT_CAUSE_REVIEW);
  assert.strictEqual(t2.valid, false, 'DRAFT -> ROOT_CAUSE_REVIEW must be rejected');

  // 3. Guard: EVIDENCE_COLLECTION -> HYPOTHESIS_GENERATION requires evidence
  const t3 = validateTransition(STATES.EVIDENCE_COLLECTION, STATES.HYPOTHESIS_GENERATION, { evidenceCount: 0 });
  assert.strictEqual(t3.valid, false, 'Cannot generate hypotheses without evidence');

  const t4 = validateTransition(STATES.EVIDENCE_COLLECTION, STATES.HYPOTHESIS_GENERATION, { evidenceCount: 3 });
  assert.strictEqual(t4.valid, true, 'Can generate hypotheses when evidence is present');

  // 4. Guard: RECOMMENDATION -> COMPLETED requires root cause and recommendation
  const t5 = validateTransition(STATES.RECOMMENDATION, STATES.COMPLETED, { hasRootCause: false, hasRecommendation: true });
  assert.strictEqual(t5.valid, false, 'Cannot complete without root cause');

  const t6 = validateTransition(STATES.RECOMMENDATION, STATES.COMPLETED, { hasRootCause: true, hasRecommendation: true });
  assert.strictEqual(t6.valid, true, 'Can complete when root cause and recommendation exist');

  // 5. Side states
  const t7 = validateTransition(STATES.HYPOTHESIS_TESTING, STATES.NEEDS_MORE_EVIDENCE);
  assert.strictEqual(t7.valid, true, 'Can transition to NEEDS_MORE_EVIDENCE');

  const t8 = validateTransition(STATES.NEEDS_MORE_EVIDENCE, STATES.EVIDENCE_COLLECTION);
  assert.strictEqual(t8.valid, true, 'Can recover from NEEDS_MORE_EVIDENCE to EVIDENCE_COLLECTION');

  console.log('✔ All State Machine Tests Passed!');
}

if (require.main === module) {
  testStateMachine();
}

module.exports = { testStateMachine };
