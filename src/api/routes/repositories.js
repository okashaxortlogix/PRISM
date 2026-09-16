// PRISM Repositories API Route
// Aligned with P1-02: Server-side tenant isolation, file inventory, dependency catalog, and background sync

const express = require('express');
const router = express.Router();
const { getDatabase } = require('../../db/database');
const { authenticate, requireRole } = require('../../security/authMiddleware');
const { jobQueue, JOB_TYPES } = require('../../queue/jobQueue');
const { recordSecurityAudit } = require('../../security/auditService');

// All repository routes require authentication
router.use(authenticate);

/**
 * Helper to fetch a repository strictly scoped to the authenticated organization
 */
function getScopedRepository(repoId, organizationId) {
  const db = getDatabase();
  return db.prepare(`
    SELECT r.*, p.organization_id, p.name as project_name
    FROM repositories r
    JOIN projects p ON r.project_id = p.id
    WHERE r.id = ? AND p.organization_id = ?
  `).get(repoId, organizationId);
}

// GET /api/v1/repositories/:id - inspect repository metadata and ingestion status
router.get('/:id', (req, res) => {
  try {
    const repo = getScopedRepository(req.params.id, req.organization.id);
    if (!repo) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Repository not found.' }
      });
    }

    res.json({
      success: true,
      data: repo
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

// GET /api/v1/repositories/:id/files - paginated indexed file inventory
router.get('/:id/files', (req, res) => {
  try {
    const repo = getScopedRepository(req.params.id, req.organization.id);
    if (!repo) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Repository not found.' }
      });
    }

    const { language, is_manifest, limit = 100, offset = 0 } = req.query;
    const db = getDatabase();

    let query = 'SELECT * FROM repository_files WHERE repository_id = ?';
    const params = [repo.id];

    if (language) {
      query += ' AND language = ?';
      params.push(language);
    }
    if (is_manifest !== undefined) {
      query += ' AND is_manifest = ?';
      params.push(is_manifest === 'true' || is_manifest === '1' ? 1 : 0);
    }

    query += ' ORDER BY file_path ASC LIMIT ? OFFSET ?';
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const files = db.prepare(query).all(...params);
    const totalCount = db.prepare('SELECT count(*) as count FROM repository_files WHERE repository_id = ?').get(repo.id).count;

    res.json({
      success: true,
      data: {
        repositoryId: repo.id,
        totalFiles: totalCount,
        files
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

// GET /api/v1/repositories/:id/dependencies - discovered package dependencies
router.get('/:id/dependencies', (req, res) => {
  try {
    const repo = getScopedRepository(req.params.id, req.organization.id);
    if (!repo) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Repository not found.' }
      });
    }

    const { ecosystem, is_dev } = req.query;
    const db = getDatabase();

    let query = 'SELECT * FROM repository_dependencies WHERE repository_id = ?';
    const params = [repo.id];

    if (ecosystem) {
      query += ' AND ecosystem = ?';
      params.push(ecosystem);
    }
    if (is_dev !== undefined) {
      query += ' AND is_dev = ?';
      params.push(is_dev === 'true' || is_dev === '1' ? 1 : 0);
    }

    query += ' ORDER BY name ASC';
    const dependencies = db.prepare(query).all(...params);

    res.json({
      success: true,
      data: {
        repositoryId: repo.id,
        totalDependencies: dependencies.length,
        dependencies
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

// GET /api/v1/repositories/:id/symbols - discovered code symbols (functions, classes, methods)
router.get('/:id/symbols', (req, res) => {
  try {
    const repo = getScopedRepository(req.params.id, req.organization.id);
    if (!repo) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Repository not found.' }
      });
    }

    const { kind, file_path, name } = req.query;
    const db = getDatabase();

    let query = 'SELECT * FROM repository_symbols WHERE repository_id = ?';
    const params = [repo.id];

    if (kind) {
      query += ' AND kind = ?';
      params.push(kind.toUpperCase());
    }
    if (file_path) {
      query += ' AND file_path LIKE ?';
      params.push(`%${file_path}%`);
    }
    if (name) {
      query += ' AND name LIKE ?';
      params.push(`%${name}%`);
    }

    query += ' ORDER BY file_path ASC, start_line ASC';
    const rawSymbols = db.prepare(query).all(...params);
    const symbols = rawSymbols.map(s => ({
      ...s,
      parameters: JSON.parse(s.parameters || '[]')
    }));

    res.json({
      success: true,
      data: {
        repositoryId: repo.id,
        count: symbols.length,
        symbols
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

// GET /api/v1/repositories/:id/call-graph - caller-callee call graph & blast radius
router.get('/:id/call-graph', (req, res) => {
  try {
    const repo = getScopedRepository(req.params.id, req.organization.id);
    if (!repo) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Repository not found.' }
      });
    }

    const { SymbolCallGraph } = require('../../ingestion/symbolGraph');
    const graph = SymbolCallGraph.fromDatabase(getDatabase(), repo.id);

    const { symbol, depth } = req.query;
    if (symbol) {
      const blastRadius = graph.getBlastRadius(symbol, depth ? parseInt(depth, 10) : 3);
      return res.json({
        success: true,
        data: blastRadius
      });
    }

    const db = getDatabase();
    const calls = db.prepare(`
      SELECT c.id, c.caller_symbol_id, s.name as caller_name, s.file_path, c.callee_name, c.callee_symbol_id, c.call_site_line
      FROM symbol_call_graphs c
      JOIN repository_symbols s ON c.caller_symbol_id = s.id
      WHERE c.repository_id = ?
      ORDER BY s.file_path ASC, c.call_site_line ASC
    `).all(repo.id);

    res.json({
      success: true,
      data: {
        repositoryId: repo.id,
        totalCalls: calls.length,
        calls
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

// POST /api/v1/repositories/:id/sync - trigger background re-ingestion & indexing
router.post('/:id/sync', requireRole(['MEMBER', 'ADMIN', 'OWNER']), (req, res) => {
  try {
    const repo = getScopedRepository(req.params.id, req.organization.id);
    if (!repo) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Repository not found.' }
      });
    }

    const job = jobQueue.enqueue({
      organizationId: req.organization.id,
      projectId: repo.project_id,
      type: JOB_TYPES.REPOSITORY_INGESTION,
      payload: { repository_id: repo.id },
      priority: req.body.priority || 'NORMAL'
    });

    recordSecurityAudit({
      organizationId: req.organization.id,
      actorId: req.user.id,
      eventType: 'REPOSITORY_SYNC_ENQUEUED',
      targetType: 'REPOSITORY',
      targetId: repo.id,
      metadata: { jobId: job.id }
    });

    res.status(202).json({
      success: true,
      data: {
        repositoryId: repo.id,
        status: 'SYNC_ENQUEUED',
        job
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

module.exports = router;
