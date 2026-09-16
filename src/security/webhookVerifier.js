// PRISM Inbound Webhook Cryptographic Verification & Replay Protection Service
// Strictly enforces provider-correct signature verification, tenant binding, and idempotency
const crypto = require('node:crypto');
const { getDatabase } = require('../db/database');
const { recordSecurityAudit } = require('./auditService');

/**
 * Constant-time comparison between a provided hex string and an expected hex string
 */
function timingSafeCompareHex(providedHex, expectedHex) {
  if (typeof providedHex !== 'string' || typeof expectedHex !== 'string') {
    return false;
  }

  // Remove potential prefix whitespace or lowercase
  const cleanProvided = providedHex.trim().toLowerCase();
  const cleanExpected = expectedHex.trim().toLowerCase();

  const bufProvided = Buffer.from(cleanProvided, 'hex');
  const bufExpected = Buffer.from(cleanExpected, 'hex');

  if (bufProvided.length === 0 || bufProvided.length !== bufExpected.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufProvided, bufExpected);
}

/**
 * Constant-time comparison between two UTF-8 token strings
 */
function timingSafeCompareTokens(tokenA, tokenB) {
  if (typeof tokenA !== 'string' || typeof tokenB !== 'string') {
    return false;
  }

  // SHA-256 hash both to ensure fixed-length buffer for timing-safe comparison
  const hashA = crypto.createHash('sha256').update(tokenA).digest();
  const hashB = crypto.createHash('sha256').update(tokenB).digest();

  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Verifies GitHub Webhook signature (X-Hub-Signature-256)
 * Format: sha256=<hex_digest> computed over raw request body using HMAC-SHA256
 */
function verifyGitHubSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || typeof signatureHeader !== 'string') {
    return { valid: false, code: 'MISSING_SIGNATURE', message: 'Missing X-Hub-Signature-256 header' };
  }

  if (!signatureHeader.startsWith('sha256=')) {
    return { valid: false, code: 'MALFORMED_SIGNATURE', message: 'Malformed X-Hub-Signature-256 header: must start with sha256=' };
  }

  if (!secret) {
    return { valid: false, code: 'MISSING_CONFIGURED_SECRET', message: 'No webhook secret configured for integration' };
  }

  const rawBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || '', 'utf-8');
  const expectedHash = crypto.createHmac('sha256', secret).update(rawBuffer).digest('hex');
  const providedHash = signatureHeader.substring(7);

  const valid = timingSafeCompareHex(providedHash, expectedHash);
  if (!valid) {
    return { valid: false, code: 'INVALID_SIGNATURE', message: 'Invalid cryptographic signature' };
  }

  return { valid: true };
}

/**
 * Verifies PagerDuty Webhook v3 signature (X-PagerDuty-Signature)
 * Format: v1=<hex_digest> computed over raw request body using HMAC-SHA256
 * PagerDuty can send multiple comma-separated signatures during secret rotation
 */
function verifyPagerDutySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || typeof signatureHeader !== 'string') {
    return { valid: false, code: 'MISSING_SIGNATURE', message: 'Missing X-PagerDuty-Signature header' };
  }

  if (!secret) {
    return { valid: false, code: 'MISSING_CONFIGURED_SECRET', message: 'No webhook secret configured for integration' };
  }

  const rawBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || '', 'utf-8');
  const expectedHash = crypto.createHmac('sha256', secret).update(rawBuffer).digest('hex');

  // Split comma-separated signatures (e.g. v1=hash1,v1=hash2)
  const signatures = signatureHeader.split(',').map(s => s.trim());
  let matched = false;

  for (const sig of signatures) {
    if (sig.startsWith('v1=')) {
      const providedHash = sig.substring(3);
      if (timingSafeCompareHex(providedHash, expectedHash)) {
        matched = true;
        break;
      }
    }
  }

  if (!matched) {
    return { valid: false, code: 'INVALID_SIGNATURE', message: 'Invalid PagerDuty webhook signature' };
  }

  return { valid: true };
}

/**
 * Verifies Datadog Webhook authentication
 * Datadog supports:
 * 1. Configured secret token in header (X-Datadog-Webhook-Token or DD-Webhook-Token)
 * 2. Optional HMAC-SHA256 signature if configured (X-Datadog-Signature)
 */
function verifyDatadogAuth(req, secret, rawBody) {
  if (!secret) {
    return { valid: false, code: 'MISSING_CONFIGURED_SECRET', message: 'No webhook secret configured for integration' };
  }

  // 1. Check if HMAC signature is provided
  const sigHeader = req.headers['x-datadog-signature'];
  if (sigHeader) {
    const rawBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || '', 'utf-8');
    const expectedHash = crypto.createHmac('sha256', secret).update(rawBuffer).digest('hex');
    const cleanSig = sigHeader.startsWith('sha256=') ? sigHeader.substring(7) : sigHeader;
    if (timingSafeCompareHex(cleanSig, expectedHash)) {
      return { valid: true, method: 'HMAC_SHA256' };
    }
    return { valid: false, code: 'INVALID_SIGNATURE', message: 'Invalid Datadog HMAC signature' };
  }

  // 2. Check token headers (X-Datadog-Webhook-Token or DD-Webhook-Token)
  const tokenHeader = req.headers['x-datadog-webhook-token'] || req.headers['dd-webhook-token'];
  if (!tokenHeader) {
    return { valid: false, code: 'MISSING_TOKEN', message: 'Missing Datadog authentication token header (X-Datadog-Webhook-Token or DD-Webhook-Token)' };
  }

  if (timingSafeCompareTokens(tokenHeader, secret)) {
    return { valid: true, method: 'SHARED_TOKEN' };
  }

  return { valid: false, code: 'INVALID_TOKEN', message: 'Invalid Datadog webhook authentication token' };
}

/**
 * Resolves integration and strictly enforces tenant boundary matching
 */
function resolveWebhookIntegration({ provider, integrationId, investigationId, projectId, organizationId }) {
  const db = getDatabase();
  const normProvider = (provider || '').toUpperCase();

  // 1. If explicit integrationId is provided
  if (integrationId) {
    const integration = db.prepare(`
      SELECT * FROM integrations 
      WHERE id = ? AND UPPER(provider) = ? AND status = 'ACTIVE'
    `).get(integrationId, normProvider);

    if (!integration) {
      return { error: 'INTEGRATION_NOT_FOUND', message: `Active ${normProvider} integration not found for ID: ${integrationId}` };
    }

    // Verify investigation belongs to this integration's organization
    if (investigationId) {
      const inv = db.prepare(`
        SELECT i.id, p.organization_id 
        FROM investigations i
        JOIN projects p ON i.project_id = p.id
        WHERE i.id = ?
      `).get(investigationId);

      if (!inv) {
        return { error: 'INVESTIGATION_NOT_FOUND', message: 'Target investigation not found.' };
      }

      if (inv.organization_id !== integration.organization_id) {
        return {
          error: 'CROSS_TENANT_VIOLATION',
          message: 'Target investigation belongs to a different organization than the webhook integration.'
        };
      }
    }

    // Verify project belongs to this integration's organization
    if (projectId) {
      const proj = db.prepare('SELECT id, organization_id FROM projects WHERE id = ?').get(projectId);
      if (!proj) {
        return { error: 'PROJECT_NOT_FOUND', message: 'Target project not found.' };
      }

      if (proj.organization_id !== integration.organization_id) {
        return {
          error: 'CROSS_TENANT_VIOLATION',
          message: 'Target project belongs to a different organization than the webhook integration.'
        };
      }
    }

    return { integration, organizationId: integration.organization_id };
  }

  // 2. Resolve via investigationId
  if (investigationId) {
    const inv = db.prepare(`
      SELECT i.id, p.organization_id 
      FROM investigations i
      JOIN projects p ON i.project_id = p.id
      WHERE i.id = ?
    `).get(investigationId);

    if (!inv) {
      return { error: 'INVESTIGATION_NOT_FOUND', message: 'Target investigation not found.' };
    }

    const integration = db.prepare(`
      SELECT * FROM integrations 
      WHERE organization_id = ? AND UPPER(provider) = ? AND status = 'ACTIVE'
      ORDER BY created_at ASC LIMIT 1
    `).get(inv.organization_id, normProvider);

    if (!integration) {
      return {
        error: 'INTEGRATION_NOT_CONFIGURED',
        message: `No active ${normProvider} integration configured for organization: ${inv.organization_id}`
      };
    }

    return { integration, organizationId: inv.organization_id, investigation: inv };
  }

  // 3. Resolve via projectId
  if (projectId) {
    const proj = db.prepare('SELECT id, organization_id FROM projects WHERE id = ?').get(projectId);
    if (!proj) {
      return { error: 'PROJECT_NOT_FOUND', message: 'Target project not found.' };
    }

    const integration = db.prepare(`
      SELECT * FROM integrations 
      WHERE organization_id = ? AND UPPER(provider) = ? AND status = 'ACTIVE'
      ORDER BY created_at ASC LIMIT 1
    `).get(proj.organization_id, normProvider);

    if (!integration) {
      return {
        error: 'INTEGRATION_NOT_CONFIGURED',
        message: `No active ${normProvider} integration configured for organization: ${proj.organization_id}`
      };
    }

    return { integration, organizationId: proj.organization_id, project: proj };
  }

  // 4. Resolve via organizationId
  if (organizationId) {
    const integration = db.prepare(`
      SELECT * FROM integrations 
      WHERE organization_id = ? AND UPPER(provider) = ? AND status = 'ACTIVE'
      ORDER BY created_at ASC LIMIT 1
    `).get(organizationId, normProvider);

    if (!integration) {
      return {
        error: 'INTEGRATION_NOT_CONFIGURED',
        message: `No active ${normProvider} integration configured for organization: ${organizationId}`
      };
    }

    return { integration, organizationId };
  }

  return { error: 'TENANT_UNRESOLVED', message: 'Must specify investigationId, projectId, integrationId, or organizationId.' };
}

/**
 * Checks if delivery/event was already processed, and records it if new (Idempotency & Replay Protection)
 */
function checkAndRecordDelivery(integrationId, deliveryId, provider) {
  if (!deliveryId || typeof deliveryId !== 'string') {
    return { isDuplicate: false };
  }

  const db = getDatabase();
  const existing = db.prepare(`
    SELECT id FROM processed_webhooks 
    WHERE integration_id = ? AND delivery_id = ?
  `).get(integrationId, deliveryId.trim());

  if (existing) {
    return { isDuplicate: true };
  }

  const id = `pwh_${crypto.randomUUID().substring(0, 10)}`;
  const now = new Date().toISOString();

  try {
    db.prepare(`
      INSERT INTO processed_webhooks (id, integration_id, delivery_id, provider, processed_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, integrationId, deliveryId.trim(), provider, now);
    return { isDuplicate: false };
  } catch (err) {
    // If concurrent insert occurred with UNIQUE constraint
    if (err.message && err.message.includes('UNIQUE')) {
      return { isDuplicate: true };
    }
    throw err;
  }
}

module.exports = {
  verifyGitHubSignature,
  verifyPagerDutySignature,
  verifyDatadogAuth,
  resolveWebhookIntegration,
  checkAndRecordDelivery,
  timingSafeCompareHex,
  timingSafeCompareTokens
};
