// PRISM Hypothesis Evaluation Asynchronous Job Handler
const { getDatabase } = require('../../db/database');
const { evaluateHypothesisConfidence } = require('../../engine/intelligenceEngine');
const { JobError, ERROR_CODES } = require('../jobErrors');

async function handleHypothesisJob(job, { queue, checkCancellation }) {
  const db = getDatabase();
  const hypothesisId = (job.payload && job.payload.hypothesis_id);

  if (!hypothesisId) {
    throw new JobError(ERROR_CODES.VALIDATION_ERROR, 'Job payload is missing hypothesis_id', { isRetryable: false });
  }

  const hyp = db.prepare(`
    SELECT h.* 
    FROM hypotheses h
    JOIN investigations i ON h.investigation_id = i.id
    JOIN projects p ON i.project_id = p.id
    WHERE h.id = ? AND p.organization_id = ?
  `).get(hypothesisId, job.organization_id);

  if (!hyp) {
    throw new JobError(ERROR_CODES.VALIDATION_ERROR, `Hypothesis ${hypothesisId} not found in organization ${job.organization_id}`, { isRetryable: false });
  }

  if (checkCancellation()) throw new JobError(ERROR_CODES.CANCELLED, 'Hypothesis evaluation cancelled');

  const evidenceList = db.prepare('SELECT * FROM evidence WHERE investigation_id = ?').all(hyp.investigation_id);
  const supportingRows = db.prepare("SELECT evidence_id FROM hypothesis_evidence WHERE hypothesis_id = ? AND relationship_type = 'SUPPORTS'").all(hyp.id);
  const conflictingRows = db.prepare("SELECT evidence_id FROM hypothesis_evidence WHERE hypothesis_id = ? AND relationship_type = 'CONTRADICTS'").all(hyp.id);

  const evalResult = evaluateHypothesisConfidence({
    ...hyp,
    supporting_evidence_ids: supportingRows.map(r => r.evidence_id),
    conflicting_evidence_ids: conflictingRows.map(r => r.evidence_id)
  }, evidenceList);

  db.prepare('UPDATE hypotheses SET confidence = ?, status = ? WHERE id = ?').run(evalResult.confidence, evalResult.status, hyp.id);
  queue.checkpoint(job.id, 'EVALUATED', 100, { confidence: evalResult.confidence, status: evalResult.status });

  return {
    hypothesisId: hyp.id,
    confidence: evalResult.confidence,
    status: evalResult.status,
    supportingCount: supportingRows.length,
    conflictingCount: conflictingRows.length
  };
}

module.exports = {
  handleHypothesisJob
};
