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

// POST /api/v1/experiments/:id/run (Empirical safe sandbox execution) - requires MEMBER, ADMIN, or OWNER
router.post('/experiments/:id/run', requireRole(['MEMBER', 'ADMIN', 'OWNER']), async (req, res) => {
  try {
    const exp = getScopedExperiment(req.params.id, req.organization.id);
    if (!exp) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Experiment not found.' } });
    }

    const { ExecutionSandbox, SANDBOX_STATUSES } = require('../../sandbox/executionSandbox');
    const sandbox = new ExecutionSandbox({
      timeoutMs: req.body.timeoutMs || exp.timeout_ms || 5000,
      maxMemoryMb: req.body.maxMemoryMb || exp.max_memory_mb || 256
    });

    // P0 Security Defense (SEC-001): Reject arbitrary user-controlled code strings from the network
    if (req.body.script) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ARBITRARY_CODE_EXECUTION_BLOCKED',
          message: 'Arbitrary script submission is strictly prohibited. Experiments must execute verified declarative plans.'
        }
      });
    }

    const startTime = new Date().toISOString();
    const sandboxResult = await sandbox.executeDeclarativePlan(exp.plan, {
      db: getDatabase(),
      organizationId: req.organization.id,
      investigationId: exp.investigation_id
    });

    const now = new Date().toISOString();
    const resultRef = `sandbox-run-${Date.now()}`;
    const logs = [
      `[${startTime}] Sandbox initialized in isolated test namespace for tenant ${req.organization.id}.`,
      `[${startTime}] Enforcing permission constraints: ${exp.permissions}`,
      `[${startTime}] Executing experiment plan: "${exp.plan.substring(0, 80)}..."`,
      `[${now}] Sandbox status: ${sandboxResult.status} (exitCode: ${sandboxResult.exitCode})`,
      `[${now}] Sandbox stdout: ${sandboxResult.stdout || 'clean'}`,
      sandboxResult.stderr ? `[${now}] Sandbox stderr: ${sandboxResult.stderr}` : null,
      `[${now}] Execution completed in ${sandboxResult.durationMs}ms. Execution ID: ${resultRef}`
    ].filter(Boolean);

    const expStatus = sandboxResult.passed ? 'COMPLETED' : (sandboxResult.status === SANDBOX_STATUSES.TIMED_OUT ? 'TIMED_OUT' : 'FAILED');

    const db = getDatabase();
    db.prepare(`
      UPDATE experiments
      SET status = ?, started_at = ?, completed_at = ?, result_ref = ?, logs = ?
      WHERE id = ?
    `).run(expStatus, startTime, now, resultRef, JSON.stringify(logs), exp.id);

    // Persist real verification record
    const verOutcome = sandboxResult.passed ? 'VERIFIED' : (sandboxResult.status === SANDBOX_STATUSES.TIMED_OUT ? 'INCONCLUSIVE' : 'REJECTED');
    const verId = `ver_${crypto.randomUUID().replace(/-/g, '')}`;

    db.prepare(`
      INSERT INTO verifications (
        id, experiment_id, claim, method, expected_result, actual_result, outcome, performed_by, performed_at, limitations
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      verId,
      exp.id,
      `Verification for experiment ${exp.id}: ${exp.plan.substring(0, 100)}`,
      'SANDBOX_SUBPROCESS_ASSERTION',
      'Process exit code 0 with zero uncaught exceptions',
      `Process exited with code ${sandboxResult.exitCode}. Output: ${(sandboxResult.stdout || sandboxResult.stderr || 'clean').substring(0, 200)}`,
      verOutcome,
      req.user.id,
      now,
      sandboxResult.timedOut ? 'Execution timed out' : 'Subprocess execution bounds enforced'
    );

    recordSecurityAudit({
      organizationId: req.organization.id,
      actorId: req.user.id,
      eventType: 'EXPERIMENT_RUN',
      targetType: 'EXPERIMENT',
      targetId: exp.id,
      metadata: { resultRef, durationMs: sandboxResult.durationMs, passed: sandboxResult.passed, status: sandboxResult.status }
    });

    const updated = db.prepare('SELECT * FROM experiments WHERE id = ?').get(exp.id);
    const createdVer = db.prepare('SELECT * FROM verifications WHERE id = ?').get(verId);
    res.json({ success: true, data: { experiment: updated, verification: createdVer } });
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
