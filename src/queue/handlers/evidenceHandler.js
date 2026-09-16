// PRISM Evidence Collection & Processing Asynchronous Job Handler
const { getDatabase } = require('../../db/database');
const { computeEvidenceHash, calculateReliabilityScore } = require('../../engine/evidenceEngine');
const { JobError, ERROR_CODES } = require('../jobErrors');

async function handleEvidenceJob(job, { queue, checkCancellation }) {
  const db = getDatabase();
  const evidenceId = (job.payload && job.payload.evidence_id);

  if (!evidenceId) {
    throw new JobError(ERROR_CODES.VALIDATION_ERROR, 'Job payload is missing evidence_id', { isRetryable: false });
  }

  const evi = db.prepare(`
    SELECT e.* 
    FROM evidence e
    JOIN investigations i ON e.investigation_id = i.id
    JOIN projects p ON i.project_id = p.id
    WHERE e.id = ? AND p.organization_id = ?
  `).get(evidenceId, job.organization_id);

  if (!evi) {
    throw new JobError(ERROR_CODES.VALIDATION_ERROR, `Evidence ${evidenceId} not found in organization ${job.organization_id}`, { isRetryable: false });
  }

  if (checkCancellation()) throw new JobError(ERROR_CODES.CANCELLED, 'Evidence collection cancelled');

  const computedHash = computeEvidenceHash(evi.raw_payload || evi.context_data || evi.title);
  const reliability = calculateReliabilityScore(evi);

  db.prepare('UPDATE evidence SET sha256_hash = ?, reliability = ? WHERE id = ?').run(computedHash, reliability, evi.id);
  queue.checkpoint(job.id, 'PROCESSED', 100, { sha256_hash: computedHash, reliability });

  return {
    evidenceId: evi.id,
    sha256_hash: computedHash,
    reliability
  };
}

module.exports = {
  handleEvidenceJob
};
