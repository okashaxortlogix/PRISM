// PRISM Recommendations API Route
// Enforces server-side tenant isolation and RBAC
const express = require('express');
const router = express.Router();
const crypto = require('node:crypto');
const { getDatabase } = require('../../db/database');
const { authenticate, requireRole } = require('../../security/authMiddleware');
const { getScopedInvestigation, getScopedRecommendation } = require('../../security/tenantGuard');
const { recordSecurityAudit } = require('../../security/auditService');

// All recommendations endpoints require authentication
router.use(authenticate);

// GET /api/v1/investigations/:investigationId/recommendations
router.get('/investigations/:investigationId/recommendations', (req, res) => {
  try {
    const inv = getScopedInvestigation(req.params.investigationId, req.organization.id);
    if (!inv) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Investigation not found.' } });
    }

    const db = getDatabase();
    const recommendations = db.prepare('SELECT * FROM recommendations WHERE investigation_id = ? ORDER BY priority ASC').all(inv.id);
    res.json({ success: true, data: recommendations });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// POST /api/v1/investigations/:investigationId/recommendations - requires MEMBER, ADMIN, or OWNER
router.post('/investigations/:investigationId/recommendations', requireRole(['MEMBER', 'ADMIN', 'OWNER']), (req, res) => {
  try {
    const { action, rationale, tradeoffs, risk, priority = 'P1', evidence_ref = null } = req.body;
    if (!action || !rationale || !tradeoffs || !risk) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Recommendations must specify action, rationale, tradeoffs, and risk.' }
      });
    }

    const inv = getScopedInvestigation(req.params.investigationId, req.organization.id);
    if (!inv) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Investigation not found.' } });
    }

    const db = getDatabase();
    const id = `rec_${crypto.randomUUID().substring(0, 8)}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO recommendations (
        id, investigation_id, action, rationale, tradeoffs, risk, priority, evidence_ref, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, inv.id, action.trim(), rationale.trim(), tradeoffs.trim(), risk.trim(), priority, evidence_ref, now);

    recordSecurityAudit({
      organizationId: req.organization.id,
      actorId: req.user.id,
      eventType: 'RECOMMENDATION_CREATED',
      targetType: 'RECOMMENDATION',
      targetId: id,
      metadata: { action: action.trim(), priority, investigationId: inv.id }
    });

    const created = db.prepare('SELECT * FROM recommendations WHERE id = ?').get(id);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// DELETE /api/v1/recommendations/:id - requires MEMBER, ADMIN, or OWNER
router.delete('/recommendations/:id', requireRole(['MEMBER', 'ADMIN', 'OWNER']), (req, res) => {
  try {
    const rec = getScopedRecommendation(req.params.id, req.organization.id);
    if (!rec) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Recommendation not found.' } });
    }

    const db = getDatabase();
    db.prepare('DELETE FROM recommendations WHERE id = ?').run(rec.id);

    recordSecurityAudit({
      organizationId: req.organization.id,
      actorId: req.user.id,
      eventType: 'RECOMMENDATION_DELETED',
      targetType: 'RECOMMENDATION',
      targetId: rec.id,
      metadata: { action: rec.action }
    });

    res.json({ success: true, data: { id: rec.id, deleted: true } });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

module.exports = router;
