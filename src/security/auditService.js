// PRISM Security Audit Service
// Enforces tamper-aware security logging without sensitive credential leaks
const crypto = require('node:crypto');
const { getDatabase } = require('../db/database');

const SENSITIVE_KEYS = new Set(['password', 'password_hash', 'token', 'rawToken', 'secret', 'key']);

function sanitizeAuditMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return '{}';
  const clean = {};
  for (const [key, val] of Object.entries(metadata)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      clean[key] = '[REDACTED]';
    } else {
      clean[key] = val;
    }
  }
  return JSON.stringify(clean);
}

function recordSecurityAudit({
  organizationId,
  actorId,
  eventType,
  targetType,
  targetId,
  metadata = {}
}) {
  try {
    const db = getDatabase();
    const id = `aud_${crypto.randomUUID().substring(0, 8)}`;
    const now = new Date().toISOString();
    const cleanMeta = sanitizeAuditMetadata(metadata);

    db.prepare(`
      INSERT INTO audit_events (
        id, organization_id, actor_id, event_type, target_type, target_id, metadata, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      organizationId || 'system',
      actorId || 'system',
      eventType,
      targetType || 'SYSTEM',
      targetId || 'system',
      cleanMeta,
      now
    );

    return id;
  } catch (err) {
    console.error('[PRISM Security Audit Error]', err.message);
    return null;
  }
}

module.exports = {
  recordSecurityAudit
};
