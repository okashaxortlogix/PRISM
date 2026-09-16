// PRISM Experiments API Route
// Enforces server-side tenant isolation and RBAC
const express = require('express');
const router = express.Router();
const crypto = require('node:crypto');
const { getDatabase } = require('../../db/database');
const { authenticate, requireRole } = require('../../security/authMiddleware');
const { getScopedHypothesis, getScopedExperiment } = require('../../security/tenantGuard');
const { recordSecurityAudit } = require('../../security/auditService');

// All experiment endpoints require authentication
router.use(authenticate);

// GET /api/v1/hypotheses/:hypothesisId/experiments
router.get('/hypotheses/:hypothesisId/experiments', (req, res) => {
  try {
    const hyp = getScopedHypothesis(req.params.hypothesisId, req.organization.id);
    if (!hyp) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Hypothesis not found.' } });
    }

    const db = getDatabase();
    const experiments = db.prepare('SELECT * FROM experiments WHERE hypothesis_id = ? ORDER BY created_at ASC').all(hyp.id);
    res.json({ success: true, data: experiments });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// POST /api/v1/hypotheses/:hypothesisId/experiments - requires MEMBER, ADMIN, or OWNER
router.post('/hypotheses/:hypothesisId/experiments', requireRole(['MEMBER', 'ADMIN', 'OWNER']), (req, res) => {
  try {
    const { plan, permissions = ['READ_ONLY'] } = req.body;
    if (!plan) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Experiment plan is required.' } });
    }

    const hyp = getScopedHypothesis(req.params.hypothesisId, req.organization.id);
    if (!hyp) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Hypothesis not found.' } });
    }

    const db = getDatabase();
    const id = `exp_${crypto.randomUUID().substring(0, 8)}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO experiments (id, hypothesis_id, plan, permissions, status, created_at)
      VALUES (?, ?, ?, ?, 'PENDING', ?)
    `).run(id, hyp.id, plan, JSON.stringify(permissions), now);

    recordSecurityAudit({
      organizationId: req.organization.id,
      actorId: req.user.id,
      eventType: 'EXPERIMENT_CREATED',
      targetType: 'EXPERIMENT',
      targetId: id,
      metadata: { hypothesisId: hyp.id, planSnippet: plan.substring(0, 60) }
    });

    const created = db.prepare('SELECT * FROM experiments WHERE id = ?').get(id);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// POST /api/v1/experiments/:id/run (Simulate safe sandbox execution) - requires MEMBER, ADMIN, or OWNER
router.post('/experiments/:id/run', requireRole(['MEMBER', 'ADMIN', 'OWNER']), (req, res) => {
  try {
    const exp = getScopedExperiment(req.params.id, req.organization.id);
    if (!exp) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Experiment not found.' } });
    }

    const now = new Date().toISOString();
    const resultRef = `sandbox-run-${Math.floor(1000 + Math.random() * 9000)}`;
    const logs = [
      `[${now}] Sandbox initialized in isolated test namespace for tenant ${req.organization.id}.`,
      `[${now}] Enforcing permission constraints: ${exp.permissions}`,
      `[${now}] Executing experiment plan: "${exp.plan.substring(0, 80)}..."`,
      `[${now}] Captured telemetry signals & output logs.`,
      `[${now}] Sandbox execution finished cleanly. Execution ID: ${resultRef}`
    ];

    const db = getDatabase();
    db.prepare(`
      UPDATE experiments
      SET status = 'COMPLETED', started_at = ?, completed_at = ?, result_ref = ?, logs = ?
      WHERE id = ?
    `).run(now, now, resultRef, JSON.stringify(logs), exp.id);

    recordSecurityAudit({
      organizationId: req.organization.id,
      actorId: req.user.id,
      eventType: 'EXPERIMENT_RUN',
      targetType: 'EXPERIMENT',
      targetId: exp.id,
      metadata: { resultRef }
    });

    const updated = db.prepare('SELECT * FROM experiments WHERE id = ?').get(exp.id);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// DELETE /api/v1/experiments/:id - requires MEMBER, ADMIN, or OWNER
router.delete('/experiments/:id', requireRole(['MEMBER', 'ADMIN', 'OWNER']), (req, res) => {
  try {
    const exp = getScopedExperiment(req.params.id, req.organization.id);
    if (!exp) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Experiment not found.' } });
    }

    const db = getDatabase();
    db.prepare('DELETE FROM verifications WHERE experiment_id = ?').run(exp.id);
    db.prepare('DELETE FROM experiments WHERE id = ?').run(exp.id);

    recordSecurityAudit({
      organizationId: req.organization.id,
      actorId: req.user.id,
      eventType: 'EXPERIMENT_DELETED',
      targetType: 'EXPERIMENT',
      targetId: exp.id,
      metadata: { plan: exp.plan }
    });

    res.json({ success: true, data: { id: exp.id, deleted: true } });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

module.exports = router;
