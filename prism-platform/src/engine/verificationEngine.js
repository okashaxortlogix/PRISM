// PRISM Verification Engine
// Implements controlled experiment execution, verification criteria, and outcome enforcement

const OUTCOMES = {
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
  INCONCLUSIVE: 'INCONCLUSIVE'
};

/**
 * Validates and normalizes verification data
 */
function recordVerification(data) {
  if (!data.claim || !data.method || !data.expected_result || !data.actual_result) {
    throw new Error('Verification must specify claim, method, expected_result, and actual_result.');
  }

  const outcome = data.outcome?.toUpperCase();
  if (!OUTCOMES[outcome]) {
    throw new Error(`Invalid outcome: ${data.outcome}. Must be one of: ${Object.keys(OUTCOMES).join(', ')}`);
  }

  // Enforce rule: INCONCLUSIVE must not be disguised as VERIFIED
  if (outcome === OUTCOMES.VERIFIED) {
    const textToCheck = `${data.actual_result} ${data.limitations || ''}`.toLowerCase();
    if (textToCheck.includes('not enough data') || textToCheck.includes('inconclusive') || textToCheck.includes('unclear')) {
      throw new Error('Contradiction detected: Outcome cannot be VERIFIED when results indicate missing or inconclusive data.');
    }
  }

  return {
    id: data.id || `ver_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    experiment_id: data.experiment_id,
    claim: data.claim,
    method: data.method,
    expected_result: data.expected_result,
    actual_result: data.actual_result,
    outcome,
    evidence_ref: data.evidence_ref || null,
    performed_by: data.performed_by || 'system_sandbox',
    performed_at: data.performed_at || new Date().toISOString(),
    limitations: data.limitations || 'None noted'
  };
}

/**
 * Evaluates an automated test assertion against expected outcomes
 */
function evaluateAssertion(expectedPattern, actualOutput) {
  if (!actualOutput) {
    return {
      outcome: OUTCOMES.INCONCLUSIVE,
      reason: 'No execution output returned from test sandbox.'
    };
  }

  const isRegex = expectedPattern.startsWith('/') && expectedPattern.endsWith('/');
  const matches = isRegex 
    ? new RegExp(expectedPattern.slice(1, -1)).test(actualOutput)
    : actualOutput.toLowerCase().includes(expectedPattern.toLowerCase());

  return {
    outcome: matches ? OUTCOMES.VERIFIED : OUTCOMES.REJECTED,
    matches,
    expectedPattern,
    actualSnippet: actualOutput.substring(0, 500)
  };
}

/**
 * Executes an empirical experiment in the isolated subprocess sandbox
 */
async function runSandboxExperiment(experiment, hypothesis) {
  const { ExecutionSandbox } = require('../sandbox/executionSandbox');
  const sandbox = new ExecutionSandbox();
  return sandbox.verifyHypothesis(hypothesis, experiment);
}

module.exports = {
  OUTCOMES,
  recordVerification,
  evaluateAssertion,
  runSandboxExperiment
};
