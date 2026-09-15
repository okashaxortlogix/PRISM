// PRISM Incident Memory API Route
// Enforces server-side tenant isolation, RBAC, and relational memory_tags (P0-04)
const express = require('express');
const router = express.Router();
const crypto = require('node:crypto');
const { getDatabase } = require('../../db/database');
const { searchMemories } = require('../../engine/memoryEngine');
const { authenticate, requireRole } = require('../../security/authMiddleware');
const { getScopedProject, getScopedInvestigation, getScopedMemory } = require('../../security/tenantGuard');
const { recordSecurityAudit } = require('../../security/auditService');

// All memories endpoints require authentication
router.use(authenticate);

/**
 * Attaches relational tags to memory objects
 */
function attachMemoryTags(db, memories) {
  if (!memories || memories.length === 0) return memories;

  const memIds = memories.map(m => m.id);
  const placeholders = memIds.map(() => '?').join(',');

  const tagRows = db.prepare(`
    SELECT memory_id, tag 
    FROM memory_tags 
    WHERE memory_id IN (${placeholders})
    ORDER BY tag ASC
  `).all(...memIds);

  const tagMap = new Map();
  for (const row of tagRows) {
    if (!tagMap.has(row.memory_id)) tagMap.set(row.memory_id, []);
    tagMap.get(row.memory_id).push(row.tag);
  }

  for (const mem of memories) {
    mem.tags = tagMap.get(mem.id) || [];
  }

  return memories;
}

// GET /api/v1/memories?q=...&tag=...&projectId=... - scoped to active tenant organization
router.get('/', (req, res) => {
  try {
    const db = getDatabase();
    const { q, projectId, tag } = req.query;

    let query = 'SELECT * FROM memories WHERE organization_id = ?';
    const params = [req.organization.id];

    if (projectId) {
      query += ' AND project_id = ?';
      params.push(projectId);
    }

    if (tag) {
      query += ' AND id IN (SELECT memory_id FROM memory_tags WHERE tag = ?)';
      params.push(tag.toLowerCase().trim());
    }

    query += ' ORDER BY created_at DESC';
    const rawMemories = db.prepare(query).all(...params);

    attachMemoryTags(db, rawMemories);

    const memories = searchMemories(rawMemories, q);
    res.json({ success: true, data: memories });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// GET /api/v1/memories/:id - scoped to active tenant organization
router.get('/:id', (req, res) => {
  try {
    const memory = getScopedMemory(req.params.id, req.organization.id);
    if (!memory) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Memory record not found.' } });
    }

    const db = getDatabase();
    attachMemoryTags(db, [memory]);

    res.json({ success: true, data: memory });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// POST /api/v1/memories - requires MEMBER, ADMIN, or OWNER
router.post('/', requireRole(['MEMBER', 'ADMIN', 'OWNER']), (req, res) => {
  try {
    const { 
      project_id, 
      investigation_id = null, 
      title, 
      summary, 
      root_cause, 
      resolution, 
      tags = [] 
    } = req.body;

    if (!title || !summary || !root_cause || !resolution) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Title, summary, root_cause, and resolution are required.' }
      });
    }

    const db = getDatabase();

    // Verify project belongs to tenant if specified, otherwise pick first project in organization
    let targetProjectId = project_id;
    if (targetProjectId) {
      const proj = getScopedProject(targetProjectId, req.organization.id);
      if (!proj) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Project does not belong to your organization.' } });
      }
    } else {
      const defaultProj = db.prepare('SELECT id FROM projects WHERE organization_id = ? LIMIT 1').get(req.organization.id);
      targetProjectId = defaultProj ? defaultProj.id : null;
    }

    // Verify investigation belongs to tenant if specified
    if (investigation_id) {
      const inv = getScopedInvestigation(investigation_id, req.organization.id);
      if (!inv) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Investigation does not belong to your organization.' } });
      }
    }

    const id = `mem_${crypto.randomUUID().substring(0, 8)}`;
    const now = new Date().toISOString();
    const orgId = req.organization.id;

    // Insert memory and normalized tags in transaction
    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare(`
        INSERT INTO memories (
          id, organization_id, project_id, investigation_id, title, summary,
          root_cause, resolution, tags, freshness_score, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1.0, ?, ?)
      `).run(
        id,
        orgId,
        targetProjectId,
        investigation_id,
        title.trim(),
        summary.trim(),
        root_cause.trim(),
        resolution.trim(),
        JSON.stringify(tags),
        now,
        now
      );

      // Insert relational memory tags (P0-04)
      if (Array.isArray(tags)) {
        for (const t of tags) {
          if (typeof t === 'string' && t.trim()) {
            const tagId = `mt_${crypto.randomUUID().substring(0, 8)}`;
            db.prepare(`
              INSERT INTO memory_tags (id, memory_id, tag, created_at)
              VALUES (?, ?, ?, ?)
            `).run(tagId, id, t.trim().toLowerCase(), now);
          }
        }
      }

      db.exec('COMMIT;');
    } catch (txErr) {
      db.exec('ROLLBACK;');
      throw txErr;
    }

    recordSecurityAudit({
      organizationId: orgId,
      actorId: req.user.id,
      eventType: 'MEMORY_CREATED',
      targetType: 'MEMORY',
      targetId: id,
      metadata: { title: title.trim() }
    });

    const created = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    attachMemoryTags(db, [created]);

    res.status(201).json({ success: true, data: created });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// DELETE /api/v1/memories/:id - requires ADMIN or OWNER
router.delete('/:id', requireRole(['ADMIN', 'OWNER']), (req, res) => {
  try {
    const memory = getScopedMemory(req.params.id, req.organization.id);
    if (!memory) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Memory record not found.' } });
    }

    const db = getDatabase();
    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare('DELETE FROM memory_tags WHERE memory_id = ?').run(memory.id);
      db.prepare('DELETE FROM memories WHERE id = ? AND organization_id = ?').run(memory.id, req.organization.id);
      db.exec('COMMIT;');
    } catch (txErr) {
      db.exec('ROLLBACK;');
      throw txErr;
    }

    recordSecurityAudit({
      organizationId: req.organization.id,
      actorId: req.user.id,
      eventType: 'MEMORY_DELETED',
      targetType: 'MEMORY',
      targetId: memory.id,
      metadata: { title: memory.title }
    });

    res.json({ success: true, data: { id: memory.id, deleted: true } });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

module.exports = router;
