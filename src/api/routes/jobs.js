// PRISM Jobs REST API Route
// Aligned with P1-01 Specification: Server-side tenant isolation, RBAC, and operational status inspection

const express = require('express');
const router = express.Router();
const { jobQueue, JOB_TYPES, JOB_PRIORITIES } = require('../../queue/jobQueue');
const { authenticate, requireRole } = require('../../security/authMiddleware');
const { getScopedInvestigation, getScopedProject } = require('../../security/tenantGuard');
const { recordSecurityAudit } = require('../../security/auditService');

// All job endpoints require authentication
router.use(authenticate);

// GET /api/v1/jobs - list organization jobs
router.get('/', (req, res) => {
  try {
    const { status, type, investigationId, limit, offset } = req.query;

    const jobs = jobQueue.listJobs({
      organizationId: req.organization.id,
      status,
      type,
      investigationId,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0
    });

    res.json({
      success: true,
      data: jobs
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

// GET /api/v1/jobs/:id - inspect job status & checkpoints (tenant isolated)
router.get('/:id', (req, res) => {
  try {
    const job = jobQueue.getJob(req.params.id, req.organization.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Job not found.' }
      });
    }

    res.json({
      success: true,
      data: job
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

// POST /api/v1/jobs - directly enqueue a job (requires MEMBER, ADMIN, or OWNER)
router.post('/', requireRole(['MEMBER', 'ADMIN', 'OWNER']), (req, res) => {
  try {
    const {
      type,
      payload = {},
      priority = JOB_PRIORITIES.NORMAL,
      project_id,
      investigation_id,
      idempotency_key,
      max_attempts,
      scheduled_at
    } = req.body;

    if (!type) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Job type is required.' }
      });
    }

    // Verify tenant ownership of referenced project/investigation if provided
    let verifiedProjectId = project_id || null;
    let verifiedInvestigationId = investigation_id || null;

    if (verifiedProjectId) {
      const proj = getScopedProject(verifiedProjectId, req.organization.id);
      if (!proj) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Project does not belong to your organization.' }
        });
      }
    }

    if (verifiedInvestigationId) {
      const inv = getScopedInvestigation(verifiedInvestigationId, req.organization.id);
      if (!inv) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Investigation not found.' }
        });
      }
      if (!verifiedProjectId) {
        verifiedProjectId = inv.project_id;
      }
    }

    const job = jobQueue.enqueue({
      organizationId: req.organization.id,
      projectId: verifiedProjectId,
      investigationId: verifiedInvestigationId,
      type,
      payload,
      priority,
      maxAttempts: max_attempts,
      scheduledAt: scheduled_at,
      idempotencyKey: idempotency_key
    });

    recordSecurityAudit({
      organizationId: req.organization.id,
      actorId: req.user.id,
      eventType: 'JOB_ENQUEUED',
      targetType: 'JOB',
      targetId: job.id,
      metadata: { type: job.type, priority: job.priority, investigationId: verifiedInvestigationId }
    });

    res.status(202).json({
      success: true,
      data: job
    });
  } catch (err) {
    res.status(err.code === 'VALIDATION_ERROR' ? 400 : 500).json({
      success: false,
      error: { code: err.code || 'INTERNAL_ERROR', message: err.message }
    });
  }
});

// POST /api/v1/jobs/:id/cancel - cooperatively cancel a job
router.post('/:id/cancel', requireRole(['MEMBER', 'ADMIN', 'OWNER']), (req, res) => {
  try {
    const { reason = 'User requested cancellation' } = req.body;
    const existing = jobQueue.getJob(req.params.id, req.organization.id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Job not found.' }
      });
    }

    const cancelled = jobQueue.cancel(req.params.id, reason, req.organization.id);

    recordSecurityAudit({
      organizationId: req.organization.id,
      actorId: req.user.id,
      eventType: 'JOB_CANCELLED',
      targetType: 'JOB',
      targetId: req.params.id,
      metadata: { reason }
    });

    const updated = jobQueue.getJob(req.params.id, req.organization.id);
    res.json({
      success: true,
      data: updated
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

module.exports = router;
