// PRISM Audit Events API Route
// Enforces server-side tenant isolation and RBAC (ADMIN / OWNER only)
const express = require('express');
const router = express.Router();
const { getDatabase } = require('../../db/database');
const { authenticate, requireRole } = require('../../security/authMiddleware');

// Audit logs require authentication and ADMIN or OWNER role
router.use(authenticate);
router.use(requireRole(['ADMIN', 'OWNER']));

// GET /api/v1/audit - scoped strictly to authenticated tenant organization
router.get('/', (req, res) => {
  try {
    const db = getDatabase();
    const { targetId, eventType, limit = 50 } = req.query;

    let query = 'SELECT * FROM audit_events WHERE organization_id = ?';
    const params = [req.organization.id];

    if (targetId) {
      query += ' AND target_id = ?';
      params.push(targetId);
    }
    if (eventType) {
      query += ' AND event_type = ?';
      params.push(eventType);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    const boundedLimit = Math.min(Math.max(1, Number(limit) || 50), 200);
    params.push(boundedLimit);

    const events = db.prepare(query).all(...params);

    // Parse JSON metadata safely
    const parsedEvents = events.map(e => {
      let meta = {};
      try {
        meta = e.metadata ? JSON.parse(e.metadata) : {};
      } catch {
        meta = { raw: e.metadata };
      }
      return {
        id: e.id,
        organizationId: e.organization_id,
        actorId: e.actor_id,
        eventType: e.event_type,
        targetType: e.target_type,
        targetId: e.target_id,
        metadata: meta,
        createdAt: e.created_at
      };
    });

    res.json({ success: true, data: parsedEvents });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

module.exports = router;
