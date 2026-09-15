// PRISM Verifications API Route
// Enforces server-side tenant isolation and RBAC
const express = require('express');
const router = express.Router();
const crypto = require('node:crypto');
const { getDatabase } = require('../../db/database');
const { recordVerification, OUTCOMES } = require('../../engine/verificationEngine');
const { authenticate, requireRole } = require('../../security/authMiddleware');
const { getScopedInvestigation, getScopedExperiment } = require('../../security/tenantGuard');
const { recordSecurityAudit } = require('../../security/auditService');

// All verification endpoints require authentication
router.use(authenticate);

// POST /api/v1/experiments/:experimentId/verifications - requires MEMBER, ADMIN, or OWNER
router.post('/experiments/:experimentId/verifications', requireRole(['MEMBER', 'ADMIN', 'OWNER']), (req, res) => {
  try {
    const exp = getScopedExperiment(req.params.experimentId, req.organization.id);
    if (!exp) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Experiment not found.' } });
    }

    const verifiedRecord = recordVerification({
      ...req.body,
      experiment_id: exp.id,
      performed_by: req.user.id
    });

    const db = getDatabase();
    db.prepare(`
      INSERT INTO verifications (
        id, experiment_id, claim, method, expected_result, actual_result,
        outcome, evidence_ref, performed_by, performed_at, limitations
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      verifiedRecord.id,
      verifiedRecord.experiment_id,
      verifiedRecord.claim,
      verifiedRecord.method,
      verifiedRecord.expected_result,
      verifiedRecord.actual_result,
      verifiedRecord.outcome,
      verifiedRecord.evidence_ref,
      verifiedRecord.performed_by,
      verifiedRecord.performed_at,
      verifiedRecord.limitations
    );

    // If verified, update hypothesis status
    if (verifiedRecord.outcome === OUTCOMES.VERIFIED) {
      db.prepare(`
        UPDATE hypotheses 
        SET status = 'VERIFIED', confidence = 0.98, updated_at = ?
        WHERE id = ?
      `).run(new Date().toISOString(), exp.hypothesis_id);
    } else if (verifiedRecord.outcome === OUTCOMES.REJECTED) {
      db.prepare(`
        UPDATE hypotheses 
        SET status = 'REJECTED', confidence = 0.05, updated_at = ?
        WHERE id = ?
      `).run(new Date().toISOString(), exp.hypothesis_id);
    }

    recordSecurityAudit({
      organizationId: req.organization.id,
      actorId: req.user.id,
      eventType: 'VERIFICATION_RECORDED',
      targetType: 'VERIFICATION',
      targetId: verifiedRecord.id,
      metadata: { outcome: verifiedRecord.outcome, experimentId: exp.id }
    });

    res.status(201).json({ success: true, data: verifiedRecord });
  } catch (err) {
    res.status(400).json({ success: false, error: { code: 'VERIFICATION_RULE_VIOLATION', message: err.message } });
  }
});

// GET /api/v1/investigations/:investigationId/verifications
router.get('/investigations/:investigationId/verifications', (req, res) => {
  try {
    const inv = getScopedInvestigation(req.params.investigationId, req.organization.id);
    if (!inv) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Investigation not found.' } });
    }

    const db = getDatabase();
    const verifications = db.prepare(`
      SELECT v.*, h.statement as hypothesis_statement, e.plan as experiment_plan
      FROM verifications v
      JOIN experiments e ON v.experiment_id = e.id
      JOIN hypotheses h ON e.hypothesis_id = h.id
      WHERE h.investigation_id = ?
      ORDER BY v.performed_at DESC
    `).all(inv.id);

    res.json({ success: true, data: verifications });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

module.exports = router;
