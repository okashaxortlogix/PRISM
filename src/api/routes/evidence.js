// PRISM Evidence API Route
// Enforces server-side tenant isolation and RBAC
const express = require('express');
const router = express.Router();
const crypto = require('node:crypto');
const { getDatabase } = require('../../db/database');
const { normalizeEvidence, verifyEvidenceIntegrity } = require('../../engine/evidenceEngine');
const { analyzeEvidenceGaps } = require('../../engine/intelligenceEngine');
const { authenticate, requireRole } = require('../../security/authMiddleware');
const { getScopedInvestigation, getScopedEvidence } = require('../../security/tenantGuard');
const { recordSecurityAudit } = require('../../security/auditService');

// All evidence endpoints require authentication
router.use(authenticate);

// GET /api/v1/investigations/:investigationId/evidence
router.get('/investigations/:investigationId/evidence', (req, res) => {
  try {
    const inv = getScopedInvestigation(req.params.investigationId, req.organization.id);
    if (!inv) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Investigation not found.' } });
    }

    const db = getDatabase();
    const evidence = db.prepare('SELECT * FROM evidence WHERE investigation_id = ? ORDER BY collected_at ASC').all(inv.id);
    res.json({ success: true, data: evidence });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// GET /api/v1/investigations/:investigationId/evidence/gaps
router.get('/investigations/:investigationId/evidence/gaps', (req, res) => {
  try {
    const inv = getScopedInvestigation(req.params.investigationId, req.organization.id);
    if (!inv) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Investigation not found.' } });
    }

    const db = getDatabase();
    const evidence = db.prepare('SELECT * FROM evidence WHERE investigation_id = ?').all(inv.id);
    const gaps = analyzeEvidenceGaps(evidence);
    res.json({ success: true, data: gaps });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// POST /api/v1/investigations/:investigationId/evidence - requires MEMBER, ADMIN, or OWNER
router.post('/investigations/:investigationId/evidence', requireRole(['MEMBER', 'ADMIN', 'OWNER']), (req, res) => {
  try {
    const inv = getScopedInvestigation(req.params.investigationId, req.organization.id);
    if (!inv) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Investigation not found.' } });
    }

    const normalized = normalizeEvidence({
      ...req.body,
      investigation_id: inv.id
    });

    const db = getDatabase();
    db.prepare(`
      INSERT INTO evidence (
        id, investigation_id, type, source, source_ref, title, content, 
        metadata, observed_at, collected_at, reliability, provenance, hash
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      normalized.id,
      normalized.investigation_id,
      normalized.type,
      normalized.source,
      normalized.source_ref,
      normalized.title,
      normalized.content,
      normalized.metadata,
      normalized.observed_at,
      normalized.collected_at,
      normalized.reliability,
      normalized.provenance,
      normalized.hash
    );

    recordSecurityAudit({
      organizationId: req.organization.id,
      actorId: req.user.id,
      eventType: 'EVIDENCE_COLLECTED',
      targetType: 'EVIDENCE',
      targetId: normalized.id,
      metadata: { type: normalized.type, investigationId: inv.id, hash: normalized.hash }
    });

    res.status(201).json({ success: true, data: normalized });
  } catch (err) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: err.message } });
  }
});

// GET /api/v1/evidence/:id/verify-integrity
router.get('/evidence/:id/verify-integrity', (req, res) => {
  try {
    const item = getScopedEvidence(req.params.id, req.organization.id);
    if (!item) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Evidence not found.' } });
    }

    const integrity = verifyEvidenceIntegrity(item);
    res.json({ success: true, data: integrity });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// DELETE /api/v1/evidence/:id - requires MEMBER, ADMIN, or OWNER
router.delete('/evidence/:id', requireRole(['MEMBER', 'ADMIN', 'OWNER']), (req, res) => {
  try {
    const item = getScopedEvidence(req.params.id, req.organization.id);
    if (!item) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Evidence not found.' } });
    }

    const db = getDatabase();
    db.prepare('DELETE FROM evidence WHERE id = ?').run(item.id);

    recordSecurityAudit({
      organizationId: req.organization.id,
      actorId: req.user.id,
      eventType: 'EVIDENCE_DELETED',
      targetType: 'EVIDENCE',
      targetId: item.id,
      metadata: { title: item.title }
    });

    res.json({ success: true, data: { id: item.id, deleted: true } });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

module.exports = router;
