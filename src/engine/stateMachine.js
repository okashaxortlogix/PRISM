// PRISM Investigation State Machine
// Governs investigation lifecycle according to PRISM State Machine Architecture

const STATES = {
  DRAFT: 'DRAFT',
  SCOPING: 'SCOPING',
  INGESTING: 'INGESTING',
  EVIDENCE_COLLECTION: 'EVIDENCE_COLLECTION',
  HYPOTHESIS_GENERATION: 'HYPOTHESIS_GENERATION',
  HYPOTHESIS_TESTING: 'HYPOTHESIS_TESTING',
  VERIFICATION: 'VERIFICATION',
  ROOT_CAUSE_REVIEW: 'ROOT_CAUSE_REVIEW',
  IMPACT_ASSESSMENT: 'IMPACT_ASSESSMENT',
  RECOMMENDATION: 'RECOMMENDATION',
  COMPLETED: 'COMPLETED',
  // Side states
  BLOCKED: 'BLOCKED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  NEEDS_MORE_EVIDENCE: 'NEEDS_MORE_EVIDENCE'
};

const ORDERED_LIFECYCLE = [
  STATES.DRAFT,
  STATES.SCOPING,
  STATES.INGESTING,
  STATES.EVIDENCE_COLLECTION,
  STATES.HYPOTHESIS_GENERATION,
  STATES.HYPOTHESIS_TESTING,
  STATES.VERIFICATION,
  STATES.ROOT_CAUSE_REVIEW,
  STATES.IMPACT_ASSESSMENT,
  STATES.RECOMMENDATION,
  STATES.COMPLETED
];

// Valid forward and recovery transitions
const TRANSITIONS = {
  [STATES.DRAFT]: [STATES.SCOPING, STATES.CANCELLED],
  [STATES.SCOPING]: [STATES.INGESTING, STATES.BLOCKED, STATES.CANCELLED],
  [STATES.INGESTING]: [STATES.EVIDENCE_COLLECTION, STATES.FAILED, STATES.BLOCKED, STATES.CANCELLED],
  [STATES.EVIDENCE_COLLECTION]: [STATES.HYPOTHESIS_GENERATION, STATES.BLOCKED, STATES.CANCELLED],
  [STATES.HYPOTHESIS_GENERATION]: [STATES.HYPOTHESIS_TESTING, STATES.NEEDS_MORE_EVIDENCE, STATES.BLOCKED, STATES.CANCELLED],
  [STATES.HYPOTHESIS_TESTING]: [STATES.VERIFICATION, STATES.NEEDS_MORE_EVIDENCE, STATES.BLOCKED, STATES.CANCELLED],
  [STATES.VERIFICATION]: [STATES.ROOT_CAUSE_REVIEW, STATES.NEEDS_MORE_EVIDENCE, STATES.BLOCKED, STATES.CANCELLED],
  [STATES.ROOT_CAUSE_REVIEW]: [STATES.IMPACT_ASSESSMENT, STATES.NEEDS_MORE_EVIDENCE, STATES.BLOCKED, STATES.CANCELLED],
  [STATES.IMPACT_ASSESSMENT]: [STATES.RECOMMENDATION, STATES.BLOCKED, STATES.CANCELLED],
  [STATES.RECOMMENDATION]: [STATES.COMPLETED, STATES.BLOCKED, STATES.CANCELLED],
  [STATES.COMPLETED]: [], // Terminal state
  // Transitions out of side states
  [STATES.BLOCKED]: [
    STATES.SCOPING, STATES.INGESTING, STATES.EVIDENCE_COLLECTION,
    STATES.HYPOTHESIS_GENERATION, STATES.HYPOTHESIS_TESTING,
    STATES.VERIFICATION, STATES.ROOT_CAUSE_REVIEW, STATES.IMPACT_ASSESSMENT,
    STATES.RECOMMENDATION, STATES.CANCELLED
  ],
  [STATES.NEEDS_MORE_EVIDENCE]: [STATES.EVIDENCE_COLLECTION, STATES.CANCELLED],
  [STATES.FAILED]: [STATES.INGESTING, STATES.DRAFT, STATES.CANCELLED],
  [STATES.CANCELLED]: [] // Terminal state
};

/**
 * Validates whether a state transition is legal and satisfies invariants
 */
function validateTransition(currentState, targetState, context = {}) {
  if (!STATES[targetState]) {
    return { valid: false, reason: `Unknown target state: ${targetState}` };
  }

  const allowed = TRANSITIONS[currentState] || [];
  if (!allowed.includes(targetState)) {
    return {
      valid: false,
      reason: `Illegal state transition from ${currentState} to ${targetState}. Allowed: [${allowed.join(', ')}]`
    };
  }

  // Domain guard rules
  if (targetState === STATES.HYPOTHESIS_GENERATION) {
    if (context.evidenceCount !== undefined && context.evidenceCount < 1) {
      return {
        valid: false,
        reason: 'Cannot generate hypotheses without at least one evidence item recorded.'
      };
    }
  }

  if (targetState === STATES.VERIFICATION) {
    if (context.hypothesisCount !== undefined && context.hypothesisCount < 1) {
      return {
        valid: false,
        reason: 'Cannot advance to verification without at least one testable hypothesis.'
      };
    }
  }

  if (targetState === STATES.ROOT_CAUSE_REVIEW) {
    if (context.verificationCount !== undefined && context.verificationCount < 1) {
      return {
        valid: false,
        reason: 'Cannot review root cause without at least one completed verification.'
      };
    }
  }

  if (targetState === STATES.COMPLETED) {
    if (!context.hasRootCause) {
      return {
        valid: false,
        reason: 'Cannot complete investigation without an established root cause statement.'
      };
    }
    if (!context.hasRecommendation) {
      return {
        valid: false,
        reason: 'Cannot complete investigation without at least one actionable recommendation.'
      };
    }
  }

  return { valid: true };
}

module.exports = {
  STATES,
  ORDERED_LIFECYCLE,
  TRANSITIONS,
  validateTransition
};
