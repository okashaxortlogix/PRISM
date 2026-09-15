// PRISM Intelligence & Hypothesis Engine
// Handles hypothesis ranking, contradiction detection, and confidence scoring

/**
 * Calculates a calibrated confidence score for a hypothesis given its supporting and contradictory evidence
 */
function evaluateHypothesisConfidence(hypothesis, allEvidenceList) {
  const supportingIds = Array.isArray(hypothesis.supporting_evidence_ids) 
    ? hypothesis.supporting_evidence_ids 
    : JSON.parse(hypothesis.supporting_evidence_ids || '[]');
  
  const conflictingIds = Array.isArray(hypothesis.conflicting_evidence_ids)
    ? hypothesis.conflicting_evidence_ids
    : JSON.parse(hypothesis.conflicting_evidence_ids || '[]');

  const evidenceMap = new Map(allEvidenceList.map(e => [e.id, e]));

  if (supportingIds.length === 0) {
    return {
      confidence: 0.1,
      status: 'INSUFFICIENT_EVIDENCE',
      analysis: 'Hypothesis lacks any supporting evidence items.'
    };
  }

  // Weight by evidence reliability
  let totalSupportScore = 0;
  for (const id of supportingIds) {
    const evi = evidenceMap.get(id);
    if (evi) {
      totalSupportScore += (evi.reliability || 0.8);
    }
  }

  let totalConflictPenalty = 0;
  for (const id of conflictingIds) {
    const evi = evidenceMap.get(id);
    if (evi) {
      totalConflictPenalty += (evi.reliability || 0.8) * 1.5; // Contradictions are heavily penalized
    }
  }

  const rawScore = (totalSupportScore / (totalSupportScore + 0.6)) - (totalConflictPenalty * 0.4);
  const confidence = Math.max(0.05, Math.min(0.99, Number(rawScore.toFixed(2))));

  let status = 'PLAUSIBLE';
  if (conflictingIds.length > 0 && confidence < 0.4) {
    status = 'DISPUTED';
  } else if (confidence >= 0.75 && conflictingIds.length === 0) {
    status = 'HIGHLY_LIKELY';
  }

  return {
    confidence,
    status,
    supportingCount: supportingIds.length,
    conflictingCount: conflictingIds.length,
    hasContradictions: conflictingIds.length > 0
  };
}

/**
 * Identifies missing critical evidence categories for an engineering investigation
 */
function analyzeEvidenceGaps(evidenceList) {
  const presentTypes = new Set(evidenceList.map(e => e.type));
  const missing = [];

  if (!presentTypes.has('LOG_EVIDENCE') && !presentTypes.has('METRIC_TRACE')) {
    missing.push({
      category: 'RUNTIME_TELEMETRY',
      recommendation: 'Collect application logs or APM metric traces around the incident timestamp.'
    });
  }

  if (!presentTypes.has('REPOSITORY_CODE') && !presentTypes.has('CONFIGURATION')) {
    missing.push({
      category: 'CODE_OR_CONFIG',
      recommendation: 'Ingest relevant repository code commit diffs or configuration settings.'
    });
  }

  if (!presentTypes.has('TEST_RESULT')) {
    missing.push({
      category: 'VERIFICATION_TEST',
      recommendation: 'Execute a reproduction test or benchmark to verify the failure mode.'
    });
  }

  return {
    totalItems: evidenceList.length,
    coverageRating: Math.max(0.1, Math.min(1.0, (presentTypes.size / 5))),
    missingGaps: missing
  };
}

module.exports = {
  evaluateHypothesisConfidence,
  analyzeEvidenceGaps
};
