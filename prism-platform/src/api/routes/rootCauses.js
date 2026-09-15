// PRISM Root Causes & Impact Assessment API Route
// Enforces server-side tenant isolation, RBAC, and relational root_cause_evidence joins (P0-04)
const express = require('express');
const router = express.Router();
const crypto = require('node:crypto');
const { getDatabase } = require('../../db/database');
const { assessBlastRadius } = require('../../engine/decisionEngine');
const { authenticate, requireRole } = require('../../security/authMiddleware');
const { getScopedInvestigation, getScopedVerification } = require('../../security/tenantGuard');
const { recordSecurityAudit } = require('../../security/auditService');

// All root causes endpoints require authentication
router.use(authenticate);

/**
 * Attaches relational supporting evidence to root cause object
 */
function attachRootCauseEvidence(db, rc) {
  if (!rc) return rc;

  const joins = db.prepare(`
    SELECT rce.evidence_id, e.title, e.type, e.reliability
    FROM root_cause_evidence rce
    JOIN evidence e ON rce.evidence_id = e.id
    WHERE rce.root_cause_id = ?
  `).all(rc.id);

  rc.supporting_evidence = joins.map(j => j.evidence_id);
  rc.evidence_details = joins;
  return rc;
}

// GET /api/v1/investigations/:investigationId/root-cause
router.get('/investigations/:investigationId/root-cause', (req, res) => {
  try {
    const inv = getScopedInvestigation(req.params.investigationId, req.organization.id);
    if (!inv) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Investigation not found.' } });
    }

    const db = getDatabase();
    const rc = db.prepare('SELECT * FROM root_causes WHERE investigation_id = ? ORDER BY created_at DESC LIMIT 1').get(inv.id);
    if (rc) {
      attachRootCauseEvidence(db, rc);
    }

    res.json({ success: true, data: rc || null });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// POST /api/v1/investigations/:investigationId/root-cause - requires MEMBER, ADMIN, or OWNER
router.post('/investigations/:investigationId/root-cause', requireRole(['MEMBER', 'ADMIN', 'OWNER']), (req, res) => {
  try {
    const { statement, confidence = 0.95, supporting_evidence = [], verification_ref } = req.body;
    if (!statement || !verification_ref) {
      return res.status(400).json({ 
        success: false, 
        error: { code: 'VALIDATION_ERROR', message: 'Root cause requires a definitive statement and verification_ref.' } 
      });
    }

    const inv = getScopedInvestigation(req.params.investigationId, req.organization.id);
    if (!inv) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Investigation not found.' } });
    }

    // Verify that verification_ref exists, is VERIFIED, and belongs strictly to the authenticated tenant
    const ver = getScopedVerification(verification_ref, req.organization.id);
    if (!ver || ver.outcome !== 'VERIFIED') {
      return res.status(400).json({
        success: false,
        error: { 
          code: 'UNVERIFIED_ROOT_CAUSE', 
          message: 'Root cause cannot be established without linking to a verified experiment within your organization.' 
        }
      });
    }

    const db = getDatabase();

    // Verify supporting evidence belong to investigation
    const invEvidence = db.prepare('SELECT id FROM evidence WHERE investigation_id = ?').all(inv.id);
    const validEviIds = new Set(invEvidence.map(e => e.id));

    if (Array.isArray(supporting_evidence)) {
      for (const eid of supporting_evidence) {
        if (!validEviIds.has(eid)) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_EVIDENCE_REFERENCE', message: `Evidence ID ${eid} does not belong to investigation ${inv.id}` }
          });
        }
      }
    }

    const id = `rc_${crypto.randomUUID().substring(0, 8)}`;
    const now = new Date().toISOString();

    // Insert root cause and normalized join table in transaction
    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare(`
        INSERT INTO root_causes (id, investigation_id, statement, confidence, supporting_evidence, verification_ref, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        inv.id,
        statement.trim(),
        confidence,
        JSON.stringify(supporting_evidence),
        verification_ref,
        now
      );

      // Insert relational root_cause_evidence joins (P0-04)
      if (Array.isArray(supporting_evidence)) {
        for (const eid of supporting_evidence) {
          const rceId = `rce_${crypto.randomUUID().substring(0, 8)}`;
          db.prepare(`
            INSERT INTO root_cause_evidence (id, root_cause_id, evidence_id, created_at)
            VALUES (?, ?, ?, ?)
          `).run(rceId, id, eid, now);
        }
      }

      db.exec('COMMIT;');
    } catch (txErr) {
      db.exec('ROLLBACK;');
      throw txErr;
    }

    recordSecurityAudit({
      organizationId: req.organization.id,
      actorId: req.user.id,
      eventType: 'ROOT_CAUSE_ESTABLISHED',
      targetType: 'ROOT_CAUSE',
      targetId: id,
      metadata: { statement: statement.trim(), investigationId: inv.id }
    });

    const created = db.prepare('SELECT * FROM root_causes WHERE id = ?').get(id);
    attachRootCauseEvidence(db, created);

    res.status(201).json({ success: true, data: created });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// POST /api/v1/investigations/:investigationId/impact - requires MEMBER, ADMIN, or OWNER
router.post('/investigations/:investigationId/impact', requireRole(['MEMBER', 'ADMIN', 'OWNER']), (req, res) => {
  try {
    const { affected_components = [], user_impact, data_integrity_impact, financial_cost_estimate } = req.body;
    if (!user_impact || !data_integrity_impact) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'User impact and data integrity impact are required.' }
      });
    }

    const inv = getScopedInvestigation(req.params.investigationId, req.organization.id);
    if (!inv) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Investigation not found.' } });
    }

    const blastAssessment = assessBlastRadius(affected_components, inv.severity);
    const id = `imp_${crypto.randomUUID().substring(0, 8)}`;
    const now = new Date().toISOString();

    const db = getDatabase();
    // Delete existing impact assessment for this investigation
    db.prepare('DELETE FROM impact_assessments WHERE investigation_id = ?').run(inv.id);

    db.prepare(`
      INSERT INTO impact_assessments (
        id, investigation_id, affected_components, user_impact,
        data_integrity_impact, blast_radius_level, financial_cost_estimate, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      inv.id,
      JSON.stringify(affected_components),
      user_impact,
      data_integrity_impact,
      blastAssessment.level,
      financial_cost_estimate || blastAssessment.estimatedFinancialCost,
      now
    );

    recordSecurityAudit({
      organizationId: req.organization.id,
      actorId: req.user.id,
      eventType: 'IMPACT_ASSESSED',
      targetType: 'IMPACT_ASSESSMENT',
      targetId: id,
      metadata: { blastRadiusLevel: blastAssessment.level, investigationId: inv.id }
    });

    const created = db.prepare('SELECT * FROM impact_assessments WHERE id = ?').get(id);
    res.status(201).json({ success: true, data: { ...created, blastAssessment } });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

module.exports = router;
