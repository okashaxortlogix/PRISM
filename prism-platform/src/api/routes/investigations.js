// PRISM Investigations API Route
// Enforces server-side tenant isolation, ownership chains, and RBAC
const express = require('express');
const router = express.Router();
const crypto = require('node:crypto');
const { getDatabase } = require('../../db/database');
const { validateTransition, STATES } = require('../../engine/stateMachine');
const { authenticate, requireRole } = require('../../security/authMiddleware');
const { getScopedProject, getScopedInvestigation } = require('../../security/tenantGuard');
const { recordSecurityAudit } = require('../../security/auditService');

// All investigation endpoints require authentication
router.use(authenticate);

// GET /api/v1/investigations - scoped strictly to authenticated tenant organization
router.get('/', (req, res) => {
  try {
    const db = getDatabase();
    const { projectId, status, severity } = req.query;

    let query = `
      SELECT i.* 
      FROM investigations i
      JOIN projects p ON i.project_id = p.id
      WHERE p.organization_id = ?
    `;
    const params = [req.organization.id];

    if (projectId) {
      query += ' AND i.project_id = ?';
      params.push(projectId);
    }
    if (status) {
      query += ' AND i.status = ?';
      params.push(status);
    }
    if (severity) {
      query += ' AND i.severity = ?';
      params.push(severity);
    }

    query += ' ORDER BY i.started_at DESC';
    const investigations = db.prepare(query).all(...params);

    res.json({ success: true, data: investigations });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// GET /api/v1/investigations/:id (Full Aggregate View - tenant isolated)
router.get('/:id', (req, res) => {
  try {
    const inv = getScopedInvestigation(req.params.id, req.organization.id);
    if (!inv) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Investigation not found.' } });
    }

    const db = getDatabase();
    const evidence = db.prepare('SELECT * FROM evidence WHERE investigation_id = ? ORDER BY collected_at ASC').all(inv.id);
    const hypotheses = db.prepare('SELECT * FROM hypotheses WHERE investigation_id = ? ORDER BY confidence DESC').all(inv.id);
    const experiments = db.prepare(`
      SELECT e.*, h.statement as hypothesis_statement 
      FROM experiments e
      JOIN hypotheses h ON e.hypothesis_id = h.id
      WHERE h.investigation_id = ?
      ORDER BY e.created_at ASC
    `).all(inv.id);
    const verifications = db.prepare(`
      SELECT v.*, e.hypothesis_id, h.statement as hypothesis_statement
      FROM verifications v
      JOIN experiments e ON v.experiment_id = e.id
      JOIN hypotheses h ON e.hypothesis_id = h.id
      WHERE h.investigation_id = ?
      ORDER BY v.performed_at ASC
    `).all(inv.id);
    const rootCauses = db.prepare('SELECT * FROM root_causes WHERE investigation_id = ?').all(inv.id);
    const impact = db.prepare('SELECT * FROM impact_assessments WHERE investigation_id = ?').get(inv.id);
    const recommendations = db.prepare('SELECT * FROM recommendations WHERE investigation_id = ? ORDER BY priority ASC').all(inv.id);

    res.json({
      success: true,
      data: {
        ...inv,
        evidence,
        hypotheses,
        experiments,
        verifications,
        rootCauses,
        impact,
        recommendations
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// POST /api/v1/investigations - requires MEMBER, ADMIN, or OWNER
router.post('/', requireRole(['MEMBER', 'ADMIN', 'OWNER']), (req, res) => {
  try {
    const { title, problem_statement, severity = 'SEV2', project_id, scope = {} } = req.body;
    if (!title || !problem_statement) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Title and problem_statement are required.' } });
    }

    const db = getDatabase();

    // Determine target project: if not supplied, select first active project for this organization
    let targetProjectId = project_id;
    if (!targetProjectId) {
      const defaultProject = db.prepare('SELECT id FROM projects WHERE organization_id = ? ORDER BY created_at ASC LIMIT 1').get(req.organization.id);
      if (!defaultProject) {
        return res.status(400).json({ success: false, error: { code: 'NO_PROJECT', message: 'No project found in this organization. Create a project first.' } });
      }
      targetProjectId = defaultProject.id;
    } else {
      // Validate that client-supplied project_id strictly belongs to authenticated organization
      const project = getScopedProject(targetProjectId, req.organization.id);
      if (!project) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Project does not exist or does not belong to your organization.' } });
      }
    }

    const id = `inv_${crypto.randomUUID().substring(0, 8)}`;
    const now = new Date().toISOString();
    const createdBy = req.user.id;

    db.prepare(`
      INSERT INTO investigations (id, project_id, created_by, title, problem_statement, status, severity, scope, started_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)
    `).run(id, targetProjectId, createdBy, title.trim(), problem_statement.trim(), severity, JSON.stringify(scope), now, now);

    recordSecurityAudit({
      organizationId: req.organization.id,
      actorId: createdBy,
      eventType: 'INVESTIGATION_CREATED',
      targetType: 'INVESTIGATION',
      targetId: id,
      metadata: { title: title.trim(), severity, projectId: targetProjectId }
    });

    const created = db.prepare('SELECT * FROM investigations WHERE id = ?').get(id);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// POST /api/v1/investigations/:id/transition - requires MEMBER, ADMIN, or OWNER (VIEWER cannot mutate state)
router.post('/:id/transition', requireRole(['MEMBER', 'ADMIN', 'OWNER']), (req, res) => {
  try {
    const { targetState } = req.body;
    const inv = getScopedInvestigation(req.params.id, req.organization.id);
    if (!inv) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Investigation not found.' } });
    }

    const db = getDatabase();
    // Build context for guard rules
    const evidenceCount = db.prepare('SELECT count(*) as count FROM evidence WHERE investigation_id = ?').get(inv.id).count;
    const hypothesisCount = db.prepare('SELECT count(*) as count FROM hypotheses WHERE investigation_id = ?').get(inv.id).count;
    const verificationCount = db.prepare(`
      SELECT count(*) as count FROM verifications v
      JOIN experiments e ON v.experiment_id = e.id
      JOIN hypotheses h ON e.hypothesis_id = h.id
      WHERE h.investigation_id = ? AND v.outcome = 'VERIFIED'
    `).get(inv.id).count;
    const hasRootCause = !!db.prepare('SELECT id FROM root_causes WHERE investigation_id = ?').get(inv.id);
    const hasRecommendation = !!db.prepare('SELECT id FROM recommendations WHERE investigation_id = ?').get(inv.id);

    const validation = validateTransition(inv.status, targetState, {
      evidenceCount,
      hypothesisCount,
      verificationCount,
      hasRootCause,
      hasRecommendation
    });

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_TRANSITION', message: validation.reason }
      });
    }

    const now = new Date().toISOString();
    const completedAt = targetState === STATES.COMPLETED ? now : inv.completed_at;

    db.prepare(`
      UPDATE investigations 
      SET status = ?, updated_at = ?, completed_at = ?
      WHERE id = ?
    `).run(targetState, now, completedAt, inv.id);

    recordSecurityAudit({
      organizationId: req.organization.id,
      actorId: req.user.id,
      eventType: 'STATE_TRANSITION',
      targetType: 'INVESTIGATION',
      targetId: inv.id,
      metadata: { from: inv.status, to: targetState }
    });

    const updated = db.prepare('SELECT * FROM investigations WHERE id = ?').get(inv.id);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// DELETE /api/v1/investigations/:id - requires ADMIN or OWNER
router.delete('/:id', requireRole(['ADMIN', 'OWNER']), (req, res) => {
  try {
    const inv = getScopedInvestigation(req.params.id, req.organization.id);
    if (!inv) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Investigation not found.' } });
    }

    const db = getDatabase();
    // Clean up dependent resources
    db.prepare('DELETE FROM recommendations WHERE investigation_id = ?').run(inv.id);
    db.prepare('DELETE FROM impact_assessments WHERE investigation_id = ?').run(inv.id);
    db.prepare('DELETE FROM root_causes WHERE investigation_id = ?').run(inv.id);
    db.prepare(`
      DELETE FROM verifications WHERE experiment_id IN (
        SELECT exp.id FROM experiments exp
        JOIN hypotheses h ON exp.hypothesis_id = h.id
        WHERE h.investigation_id = ?
      )
    `).run(inv.id);
    db.prepare(`
      DELETE FROM experiments WHERE hypothesis_id IN (
        SELECT id FROM hypotheses WHERE investigation_id = ?
      )
    `).run(inv.id);
    db.prepare('DELETE FROM hypotheses WHERE investigation_id = ?').run(inv.id);
    db.prepare('DELETE FROM evidence WHERE investigation_id = ?').run(inv.id);
    db.prepare('DELETE FROM investigations WHERE id = ?').run(inv.id);

    recordSecurityAudit({
      organizationId: req.organization.id,
      actorId: req.user.id,
      eventType: 'INVESTIGATION_DELETED',
      targetType: 'INVESTIGATION',
      targetId: inv.id,
      metadata: { title: inv.title }
    });

    res.json({ success: true, data: { id: inv.id, deleted: true } });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

module.exports = router;
