// PRISM Server-Side Tenant Isolation Guard
// Strictly guarantees that all nested entity queries enforce organization boundary checks
const { getDatabase } = require('../db/database');

/**
 * Asserts project belongs to tenant organization
 */
function getScopedProject(projectId, orgId) {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM projects
    WHERE id = ? AND organization_id = ?
  `).get(projectId, orgId);
}

/**
 * Asserts investigation belongs to tenant organization via parent project
 */
function getScopedInvestigation(investigationId, orgId) {
  const db = getDatabase();
  return db.prepare(`
    SELECT i.*, p.organization_id
    FROM investigations i
    JOIN projects p ON i.project_id = p.id
    WHERE i.id = ? AND p.organization_id = ?
  `).get(investigationId, orgId);
}

/**
 * Asserts evidence belongs to tenant organization via investigation -> project -> org
 */
function getScopedEvidence(evidenceId, orgId) {
  const db = getDatabase();
  return db.prepare(`
    SELECT e.*, p.organization_id
    FROM evidence e
    JOIN investigations i ON e.investigation_id = i.id
    JOIN projects p ON i.project_id = p.id
    WHERE e.id = ? AND p.organization_id = ?
  `).get(evidenceId, orgId);
}

/**
 * Asserts hypothesis belongs to tenant organization
 */
function getScopedHypothesis(hypothesisId, orgId) {
  const db = getDatabase();
  return db.prepare(`
    SELECT h.*, p.organization_id
    FROM hypotheses h
    JOIN investigations i ON h.investigation_id = i.id
    JOIN projects p ON i.project_id = p.id
    WHERE h.id = ? AND p.organization_id = ?
  `).get(hypothesisId, orgId);
}

/**
 * Asserts experiment belongs to tenant organization
 */
function getScopedExperiment(experimentId, orgId) {
  const db = getDatabase();
  return db.prepare(`
    SELECT exp.*, p.organization_id, h.statement as hypothesis_statement
    FROM experiments exp
    JOIN hypotheses h ON exp.hypothesis_id = h.id
    JOIN investigations i ON h.investigation_id = i.id
    JOIN projects p ON i.project_id = p.id
    WHERE exp.id = ? AND p.organization_id = ?
  `).get(experimentId, orgId);
}

/**
 * Asserts incident memory belongs to tenant organization
 */
function getScopedMemory(memoryId, orgId) {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM memories
    WHERE id = ? AND organization_id = ?
  `).get(memoryId, orgId);
}

/**
 * Asserts verification belongs to tenant organization
 */
function getScopedVerification(verificationId, orgId) {
  const db = getDatabase();
  return db.prepare(`
    SELECT v.*, p.organization_id
    FROM verifications v
    JOIN experiments exp ON v.experiment_id = exp.id
    JOIN hypotheses h ON exp.hypothesis_id = h.id
    JOIN investigations i ON h.investigation_id = i.id
    JOIN projects p ON i.project_id = p.id
    WHERE v.id = ? AND p.organization_id = ?
  `).get(verificationId, orgId);
}

/**
 * Asserts root cause belongs to tenant organization
 */
function getScopedRootCause(rootCauseId, orgId) {
  const db = getDatabase();
  return db.prepare(`
    SELECT rc.*, p.organization_id
    FROM root_causes rc
    JOIN investigations i ON rc.investigation_id = i.id
    JOIN projects p ON i.project_id = p.id
    WHERE rc.id = ? AND p.organization_id = ?
  `).get(rootCauseId, orgId);
}

/**
 * Asserts recommendation belongs to tenant organization
 */
function getScopedRecommendation(recommendationId, orgId) {
  const db = getDatabase();
  return db.prepare(`
    SELECT r.*, p.organization_id
    FROM recommendations r
    JOIN investigations i ON r.investigation_id = i.id
    JOIN projects p ON i.project_id = p.id
    WHERE r.id = ? AND p.organization_id = ?
  `).get(recommendationId, orgId);
}

module.exports = {
  getScopedProject,
  getScopedInvestigation,
  getScopedEvidence,
  getScopedHypothesis,
  getScopedExperiment,
  getScopedMemory,
  getScopedVerification,
  getScopedRootCause,
  getScopedRecommendation
};

