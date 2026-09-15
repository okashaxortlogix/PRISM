// PRISM Decision & Impact Engine
// Synthesizes verified root causes, assesses blast radius/impact, and produces actionable recommendations

/**
 * Calculates blast radius severity and affected service dependencies
 */
function assessBlastRadius(affectedComponents, severity = 'SEV2') {
  const componentCount = affectedComponents.length;
  let level = 'LOW';

  if (severity === 'SEV1' || componentCount > 4) {
    level = 'CRITICAL';
  } else if (severity === 'SEV2' || componentCount >= 2) {
    level = 'HIGH';
  } else if (componentCount === 1) {
    level = 'MEDIUM';
  }

  return {
    blastRadiusLevel: level,
    totalComponentsAffected: componentCount,
    isolationRecommendation: level === 'CRITICAL' 
      ? 'Immediate circuit-breaker trip and traffic rerouting recommended.' 
      : 'Targeted service redeployment and state rollback safe.'
  };
}

/**
 * Formats a recommendation with trade-offs and risk scoring
 */
function buildRecommendation(action, rationale, tradeoffs, risk, priority = 'P1', evidenceRef = null) {
  return {
    action,
    rationale,
    tradeoffs,
    risk,
    priority,
    evidence_ref: evidenceRef,
    created_at: new Date().toISOString()
  };
}

module.exports = {
  assessBlastRadius,
  buildRecommendation
};
