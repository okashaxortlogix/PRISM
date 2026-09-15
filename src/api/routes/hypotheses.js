// PRISM Hypotheses API Route
// Enforces server-side tenant isolation, RBAC, and relational hypothesis_evidence joins (P0-04)
const express = require('express');
const router = express.Router();
const crypto = require('node:crypto');
const { getDatabase } = require('../../db/database');
const { evaluateHypothesisConfidence } = require('../../engine/intelligenceEngine');
const { authenticate, requireRole } = require('../../security/authMiddleware');
const { getScopedInvestigation, getScopedHypothesis } = require('../../security/tenantGuard');
const { recordSecurityAudit } = require('../../security/auditService');

// All hypothesis endpoints require authentication
router.use(authenticate);

/**
 * Attaches relational evidence associations to hypothesis objects
 */
function attachHypothesisEvidence(db, hypotheses) {
  if (!hypotheses || hypotheses.length === 0) return hypotheses;

  const hypIds = hypotheses.map(h => h.id);
  const placeholders = hypIds.map(() => '?').join(',');

  const joins = db.prepare(`
    SELECT he.hypothesis_id, he.evidence_id, he.relationship_type, e.title, e.type, e.reliability
    FROM hypothesis_evidence he
    JOIN evidence e ON he.evidence_id = e.id
    WHERE he.hypothesis_id IN (${placeholders})
  `).all(...hypIds);

  const supportsMap = new Map();
  const conflictsMap = new Map();
  const linksMap = new Map();

  for (const row of joins) {
    if (!linksMap.has(row.hypothesis_id)) linksMap.set(row.hypothesis_id, []);
    linksMap.get(row.hypothesis_id).push({
      evidence_id: row.evidence_id,
      relationship_type: row.relationship_type,
      title: row.title,
      type: row.type,
      reliability: row.reliability
    });

    if (row.relationship_type === 'SUPPORTS') {
      if (!supportsMap.has(row.hypothesis_id)) supportsMap.set(row.hypothesis_id, []);
      supportsMap.get(row.hypothesis_id).push(row.evidence_id);
    } else if (row.relationship_type === 'CONTRADICTS') {
      if (!conflictsMap.has(row.hypothesis_id)) conflictsMap.set(row.hypothesis_id, []);
      conflictsMap.get(row.hypothesis_id).push(row.evidence_id);
    }
  }

  for (const hyp of hypotheses) {
    hyp.supporting_evidence_ids = supportsMap.get(hyp.id) || [];
    hyp.conflicting_evidence_ids = conflictsMap.get(hyp.id) || [];
    hyp.evidence_associations = linksMap.get(hyp.id) || [];
  }

  return hypotheses;
}

// GET /api/v1/investigations/:investigationId/hypotheses
router.get('/investigations/:investigationId/hypotheses', (req, res) => {
  try {
    const inv = getScopedInvestigation(req.params.investigationId, req.organization.id);
    if (!inv) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Investigation not found.' } });
    }

    const db = getDatabase();
    const hypotheses = db.prepare(`
      SELECT * FROM hypotheses 
      WHERE investigation_id = ? 
      ORDER BY confidence DESC
    `).all(inv.id);

    attachHypothesisEvidence(db, hypotheses);

    res.json({ success: true, data: hypotheses });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// POST /api/v1/investigations/:investigationId/hypotheses - requires MEMBER, ADMIN, or OWNER
router.post('/investigations/:investigationId/hypotheses', requireRole(['MEMBER', 'ADMIN', 'OWNER']), (req, res) => {
  try {
    const { statement, rationale, supporting_evidence_ids = [], conflicting_evidence_ids = [] } = req.body;
    if (!statement || !rationale) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Statement and rationale are required.' } });
    }

    const inv = getScopedInvestigation(req.params.investigationId, req.organization.id);
    if (!inv) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Investigation not found.' } });
    }

    const db = getDatabase();
    const allEvidence = db.prepare('SELECT * FROM evidence WHERE investigation_id = ?').all(inv.id);
    const validEvidenceIds = new Set(allEvidence.map(e => e.id));

    // Verify all cited evidence IDs exist within the target investigation (Tenant Isolation Boundary)
    const allCited = [...supporting_evidence_ids, ...conflicting_evidence_ids];
    for (const eid of allCited) {
      if (!validEvidenceIds.has(eid)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_EVIDENCE_REFERENCE',
            message: `Evidence ID ${eid} does not exist in investigation ${inv.id}`
          }
        });
      }
    }

    const id = `hyp_${crypto.randomUUID().substring(0, 8)}`;
    const now = new Date().toISOString();

    const evaluation = evaluateHypothesisConfidence({
      supporting_evidence_ids,
      conflicting_evidence_ids
    }, allEvidence);

    // Insert hypothesis and relational joins in transaction
    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare(`
        INSERT INTO hypotheses (
          id, investigation_id, statement, status, confidence, rationale,
          supporting_evidence_ids, conflicting_evidence_ids, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        inv.id,
        statement.trim(),
        evaluation.status,
        evaluation.confidence,
        rationale.trim(),
        JSON.stringify(supporting_evidence_ids),
        JSON.stringify(conflicting_evidence_ids),
        now,
        now
      );

      // Insert relational joins into hypothesis_evidence (P0-04)
      for (const eid of supporting_evidence_ids) {
        const heId = `he_${crypto.randomUUID().substring(0, 8)}`;
        db.prepare(`
          INSERT INTO hypothesis_evidence (id, hypothesis_id, evidence_id, relationship_type, created_at)
          VALUES (?, ?, ?, 'SUPPORTS', ?)
        `).run(heId, id, eid, now);
      }

      for (const eid of conflicting_evidence_ids) {
        const heId = `he_${crypto.randomUUID().substring(0, 8)}`;
        db.prepare(`
          INSERT INTO hypothesis_evidence (id, hypothesis_id, evidence_id, relationship_type, created_at)
          VALUES (?, ?, ?, 'CONTRADICTS', ?)
        `).run(heId, id, eid, now);
      }

      db.exec('COMMIT;');
    } catch (txErr) {
      db.exec('ROLLBACK;');
      throw txErr;
    }

    recordSecurityAudit({
      organizationId: req.organization.id,
      actorId: req.user.id,
      eventType: 'HYPOTHESIS_CREATED',
      targetType: 'HYPOTHESIS',
      targetId: id,
      metadata: { statement: statement.trim(), investigationId: inv.id }
    });

    const created = db.prepare('SELECT * FROM hypotheses WHERE id = ?').get(id);
    attachHypothesisEvidence(db, [created]);

    res.status(201).json({ success: true, data: created, evaluation });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// POST /api/v1/hypotheses/:id/evaluate - requires MEMBER, ADMIN, or OWNER
router.post('/hypotheses/:id/evaluate', requireRole(['MEMBER', 'ADMIN', 'OWNER']), (req, res) => {
  try {
    const hyp = getScopedHypothesis(req.params.id, req.organization.id);
    if (!hyp) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Hypothesis not found.' } });
    }

    const db = getDatabase();
    attachHypothesisEvidence(db, [hyp]);

    const allEvidence = db.prepare('SELECT * FROM evidence WHERE investigation_id = ?').all(hyp.investigation_id);
    const evaluation = evaluateHypothesisConfidence(hyp, allEvidence);

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE hypotheses 
      SET confidence = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(evaluation.confidence, evaluation.status, now, hyp.id);

    const updated = db.prepare('SELECT * FROM hypotheses WHERE id = ?').get(hyp.id);
    attachHypothesisEvidence(db, [updated]);

    res.json({ success: true, data: updated, evaluation });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// DELETE /api/v1/hypotheses/:id - requires MEMBER, ADMIN, or OWNER
router.delete('/hypotheses/:id', requireRole(['MEMBER', 'ADMIN', 'OWNER']), (req, res) => {
  try {
    const hyp = getScopedHypothesis(req.params.id, req.organization.id);
    if (!hyp) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Hypothesis not found.' } });
    }

    const db = getDatabase();
    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare('DELETE FROM hypothesis_evidence WHERE hypothesis_id = ?').run(hyp.id);
      db.prepare(`
        DELETE FROM verifications WHERE experiment_id IN (
          SELECT id FROM experiments WHERE hypothesis_id = ?
        )
      `).run(hyp.id);
      db.prepare('DELETE FROM experiments WHERE hypothesis_id = ?').run(hyp.id);
      db.prepare('DELETE FROM hypotheses WHERE id = ?').run(hyp.id);
      db.exec('COMMIT;');
    } catch (txErr) {
      db.exec('ROLLBACK;');
      throw txErr;
    }

    recordSecurityAudit({
      organizationId: req.organization.id,
      actorId: req.user.id,
      eventType: 'HYPOTHESIS_DELETED',
      targetType: 'HYPOTHESIS',
      targetId: hyp.id,
      metadata: { statement: hyp.statement }
    });

    res.json({ success: true, message: 'Hypothesis and associated relationships deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

module.exports = router;
