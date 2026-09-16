// PRISM Investigation Asynchronous Job Handler
// Coordinates investigation lifecycle stages with incremental checkpointing, idempotency, and resumability

const { getDatabase } = require('../../db/database');
const { STATES, validateTransition } = require('../../engine/stateMachine');
const { evaluateHypothesisConfidence, analyzeEvidenceGaps } = require('../../engine/intelligenceEngine');
const { calculateBlastRadius, prioritizeRecommendations } = require('../../engine/decisionEngine');
const { JobError, ERROR_CODES } = require('../jobErrors');

async function handleInvestigationJob(job, { queue, checkCancellation }) {
  const db = getDatabase();
  const investigationId = job.investigation_id || (job.payload && job.payload.investigation_id);

  if (!investigationId) {
    throw new JobError(ERROR_CODES.VALIDATION_ERROR, 'Job is missing investigation_id', { isRetryable: false });
  }

  // Retrieve investigation with tenant check
  const inv = db.prepare('SELECT * FROM investigations WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE organization_id = ?)').get(investigationId, job.organization_id);
  if (!inv) {
    throw new JobError(ERROR_CODES.VALIDATION_ERROR, `Investigation ${investigationId} not found in organization ${job.organization_id}`, { isRetryable: false });
  }

  // Inspect existing checkpoints to resume from the latest completed phase
  const checkpoints = queue.getCheckpoints(job.id);
  const completedPhases = new Set(checkpoints.map(c => c.phase));

  // Step 1: SCOPING phase
  if (!completedPhases.has(STATES.SCOPING)) {
    if (checkCancellation()) throw new JobError(ERROR_CODES.CANCELLED, 'Job cancelled before SCOPING phase');
    
    // Transition investigation to SCOPING if needed
    if (inv.status === STATES.DRAFT) {
      db.prepare("UPDATE investigations SET status = ?, updated_at = datetime('now') WHERE id = ?").run(STATES.SCOPING, inv.id);
    }
    queue.checkpoint(job.id, STATES.SCOPING, 20, { status: STATES.SCOPING, message: 'Investigation scope validated' });
  }

  // Step 2: EVIDENCE_COLLECTION phase
  if (!completedPhases.has(STATES.EVIDENCE_COLLECTION)) {
    if (checkCancellation()) throw new JobError(ERROR_CODES.CANCELLED, 'Job cancelled before EVIDENCE_COLLECTION phase');

    const evidenceList = db.prepare('SELECT * FROM evidence WHERE investigation_id = ?').all(inv.id);
    const gaps = analyzeEvidenceGaps(evidenceList);

    if (inv.status === STATES.SCOPING || inv.status === STATES.DRAFT) {
      db.prepare("UPDATE investigations SET status = ?, updated_at = datetime('now') WHERE id = ?").run(STATES.EVIDENCE_COLLECTION, inv.id);
    }

    queue.checkpoint(job.id, STATES.EVIDENCE_COLLECTION, 40, {
      evidenceCount: evidenceList.length,
      identifiedGaps: gaps.length
    });
  }

  // Step 3: HYPOTHESIS_GENERATION & EVALUATION phase
  if (!completedPhases.has(STATES.HYPOTHESIS_GENERATION)) {
    if (checkCancellation()) throw new JobError(ERROR_CODES.CANCELLED, 'Job cancelled before HYPOTHESIS_GENERATION phase');

    const hypotheses = db.prepare('SELECT * FROM hypotheses WHERE investigation_id = ?').all(inv.id);
    const evidenceList = db.prepare('SELECT * FROM evidence WHERE investigation_id = ?').all(inv.id);

    const evaluatedHypotheses = [];
    for (const hyp of hypotheses) {
      // Fetch supporting and conflicting evidence IDs from relational join table
      const supportingRows = db.prepare("SELECT evidence_id FROM hypothesis_evidence WHERE hypothesis_id = ? AND relationship_type = 'SUPPORTS'").all(hyp.id);
      const conflictingRows = db.prepare("SELECT evidence_id FROM hypothesis_evidence WHERE hypothesis_id = ? AND relationship_type = 'CONTRADICTS'").all(hyp.id);

      const evalResult = evaluateHypothesisConfidence({
        ...hyp,
        supporting_evidence_ids: supportingRows.map(r => r.evidence_id),
        conflicting_evidence_ids: conflictingRows.map(r => r.evidence_id)
      }, evidenceList);

      db.prepare("UPDATE hypotheses SET confidence = ?, status = ? WHERE id = ?").run(evalResult.confidence, evalResult.status, hyp.id);
      evaluatedHypotheses.push({ id: hyp.id, confidence: evalResult.confidence, status: evalResult.status });
    }

    if (inv.status === STATES.EVIDENCE_COLLECTION) {
      db.prepare("UPDATE investigations SET status = ?, updated_at = datetime('now') WHERE id = ?").run(STATES.HYPOTHESIS_GENERATION, inv.id);
    }

    queue.checkpoint(job.id, STATES.HYPOTHESIS_GENERATION, 65, {
      evaluatedHypothesesCount: evaluatedHypotheses.length,
      topConfidence: evaluatedHypotheses.length > 0 ? Math.max(...evaluatedHypotheses.map(h => h.confidence)) : 0
    });
  }

  // Step 4: ROOT_CAUSE & BLAST RADIUS SYNTHESIS phase
  if (!completedPhases.has(STATES.ROOT_CAUSE_REVIEW)) {
    if (checkCancellation()) throw new JobError(ERROR_CODES.CANCELLED, 'Job cancelled before ROOT_CAUSE_REVIEW phase');

    const rootCauses = db.prepare('SELECT * FROM root_causes WHERE investigation_id = ?').all(inv.id);
    const impact = db.prepare('SELECT * FROM impact_assessments WHERE investigation_id = ?').get(inv.id);

    queue.checkpoint(job.id, STATES.ROOT_CAUSE_REVIEW, 85, {
      rootCausesCount: rootCauses.length,
      hasImpactAssessment: !!impact
    });
  }

  // Step 5: RECOMMENDATION & COMPLETION
  if (checkCancellation()) throw new JobError(ERROR_CODES.CANCELLED, 'Job cancelled before completion');

  const recommendations = db.prepare('SELECT * FROM recommendations WHERE investigation_id = ?').all(inv.id);
  const now = new Date().toISOString();

  queue.checkpoint(job.id, STATES.COMPLETED, 100, {
    completedAt: now,
    recommendationsCount: recommendations.length
  });

  return {
    investigationId: inv.id,
    title: inv.title,
    phasesExecuted: [STATES.SCOPING, STATES.EVIDENCE_COLLECTION, STATES.HYPOTHESIS_GENERATION, STATES.ROOT_CAUSE_REVIEW, STATES.COMPLETED],
    completedAt: now
  };
}

module.exports = {
  handleInvestigationJob
};
