// PRISM Projects & Repositories API Route
// Enforces server-side tenant isolation and RBAC
const express = require('express');
const router = express.Router();
const crypto = require('node:crypto');
const { getDatabase } = require('../../db/database');
const { authenticate, requireRole } = require('../../security/authMiddleware');
const { getScopedProject } = require('../../security/tenantGuard');
const { recordSecurityAudit } = require('../../security/auditService');

// All project routes require authentication
router.use(authenticate);

// GET /api/v1/projects - scoped to active tenant organization
router.get('/', (req, res) => {
  try {
    const db = getDatabase();
    const projects = db.prepare(`
      SELECT * FROM projects
      WHERE organization_id = ?
      ORDER BY created_at DESC
    `).all(req.organization.id);

    const projectsWithRepos = projects.map(p => {
      const repos = db.prepare('SELECT * FROM repositories WHERE project_id = ?').all(p.id);
      return { ...p, repositories: repos };
    });

    res.json({ success: true, data: projectsWithRepos });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// GET /api/v1/projects/:id - scoped to active tenant organization
router.get('/:id', (req, res) => {
  try {
    const project = getScopedProject(req.params.id, req.organization.id);
    if (!project) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found.' } });
    }

    const db = getDatabase();
    const repos = db.prepare('SELECT * FROM repositories WHERE project_id = ?').all(project.id);
    res.json({ success: true, data: { ...project, repositories: repos } });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// POST /api/v1/projects - requires ADMIN or OWNER
router.post('/', requireRole(['ADMIN', 'OWNER']), (req, res) => {
  try {
    const { name, description = '' } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Project name is required' } });
    }

    const db = getDatabase();
    const id = `prj_${crypto.randomUUID().substring(0, 8)}`;
    const now = new Date().toISOString();
    // Tenant boundary: ALWAYS use authenticated req.organization.id, NEVER client-supplied organization_id
    const orgId = req.organization.id;

    db.prepare(`
      INSERT INTO projects (id, organization_id, name, description, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)
    `).run(id, orgId, name.trim(), description.trim(), now, now);

    recordSecurityAudit({
      organizationId: orgId,
      actorId: req.user.id,
      eventType: 'PROJECT_CREATED',
      targetType: 'PROJECT',
      targetId: id,
      metadata: { name: name.trim() }
    });

    const created = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// POST /api/v1/projects/:projectId/repositories - requires ADMIN or OWNER
router.post('/:projectId/repositories', requireRole(['ADMIN', 'OWNER']), (req, res) => {
  try {
    const { url, provider = 'GITHUB', default_branch = 'main', metadata = {} } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Repository url is required' } });
    }

    // Verify parent project belongs strictly to the tenant
    const project = getScopedProject(req.params.projectId, req.organization.id);
    if (!project) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
    }

    const db = getDatabase();
    const id = `repo_${crypto.randomUUID().substring(0, 8)}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO repositories (id, project_id, provider, url, default_branch, metadata, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'INGESTED', ?)
    `).run(id, project.id, provider, url, default_branch, JSON.stringify(metadata), now);

    const created = db.prepare('SELECT * FROM repositories WHERE id = ?').get(id);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// DELETE /api/v1/projects/:id - requires ADMIN or OWNER
router.delete('/:id', requireRole(['ADMIN', 'OWNER']), (req, res) => {
  try {
    const project = getScopedProject(req.params.id, req.organization.id);
    if (!project) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
    }

    const db = getDatabase();
    // Delete repositories and project
    db.prepare('DELETE FROM repositories WHERE project_id = ?').run(project.id);
    db.prepare('DELETE FROM projects WHERE id = ? AND organization_id = ?').run(project.id, req.organization.id);

    recordSecurityAudit({
      organizationId: req.organization.id,
      actorId: req.user.id,
      eventType: 'PROJECT_DELETED',
      targetType: 'PROJECT',
      targetId: project.id,
      metadata: { name: project.name }
    });

    res.json({ success: true, data: { id: project.id, deleted: true } });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

module.exports = router;
