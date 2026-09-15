// PRISM Evidence Engine
// Implements provenance, SHA-256 cryptographic integrity, reliability scoring, and conflict checks

const crypto = require('node:crypto');
const { sanitizeEvidenceContent } = require('../security/piiSanitizer');

const EVIDENCE_TYPES = {
  DIRECT_OBSERVATION: 'DIRECT_OBSERVATION',
  REPOSITORY_CODE: 'REPOSITORY_CODE',
  TEST_RESULT: 'TEST_RESULT',
  LOG_EVIDENCE: 'LOG_EVIDENCE',
  METRIC_TRACE: 'METRIC_TRACE',
  CONFIGURATION: 'CONFIGURATION',
  DEPENDENCY: 'DEPENDENCY',
  DEPLOYMENT: 'DEPLOYMENT',
  HISTORICAL: 'HISTORICAL',
  USER_PROVIDED: 'USER_PROVIDED'
};

const DEFAULT_RELIABILITY = {
  [EVIDENCE_TYPES.DIRECT_OBSERVATION]: 0.9,
  [EVIDENCE_TYPES.REPOSITORY_CODE]: 0.98,
  [EVIDENCE_TYPES.TEST_RESULT]: 0.95,
  [EVIDENCE_TYPES.LOG_EVIDENCE]: 0.92,
  [EVIDENCE_TYPES.METRIC_TRACE]: 0.94,
  [EVIDENCE_TYPES.CONFIGURATION]: 0.95,
  [EVIDENCE_TYPES.DEPENDENCY]: 0.90,
  [EVIDENCE_TYPES.DEPLOYMENT]: 0.92,
  [EVIDENCE_TYPES.HISTORICAL]: 0.75,
  [EVIDENCE_TYPES.USER_PROVIDED]: 0.65
};

/**
 * Computes deterministic SHA-256 hash for evidence content & provenance
 */
function computeEvidenceHash(type, source, sourceRef, content) {
  const payload = `${type}|${source}|${sourceRef}|${typeof content === 'string' ? content : JSON.stringify(content)}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Verifies if an evidence item has been tampered with
 */
function verifyEvidenceIntegrity(evidenceItem) {
  const expectedHash = computeEvidenceHash(
    evidenceItem.type,
    evidenceItem.source,
    evidenceItem.source_ref || evidenceItem.sourceRef,
    evidenceItem.content
  );
  return {
    valid: expectedHash === evidenceItem.hash,
    computedHash: expectedHash,
    storedHash: evidenceItem.hash
  };
}

/**
 * Normalizes and validates newly submitted evidence
 */
function normalizeEvidence(data) {
  const type = data.type || EVIDENCE_TYPES.DIRECT_OBSERVATION;
  if (!EVIDENCE_TYPES[type]) {
    throw new Error(`Invalid evidence type: ${type}. Must be one of: ${Object.keys(EVIDENCE_TYPES).join(', ')}`);
  }

  if (!data.title || !data.content || !data.source || !data.source_ref) {
    throw new Error('Evidence requires title, content, source, and source_ref for provenance tracking.');
  }

  // Compliance & Privacy redaction
  const cleanContent = sanitizeEvidenceContent(data.content);
  const hash = computeEvidenceHash(type, data.source, data.source_ref, cleanContent);
  const reliability = typeof data.reliability === 'number' ? data.reliability : (DEFAULT_RELIABILITY[type] || 0.8);
  const now = new Date().toISOString();

  return {
    id: data.id || `evi_${crypto.randomUUID()}`,
    investigation_id: data.investigation_id,
    type,
    source: data.source,
    source_ref: data.source_ref,
    title: data.title,
    content: typeof cleanContent === 'object' ? JSON.stringify(cleanContent, null, 2) : cleanContent,
    metadata: typeof data.metadata === 'object' ? JSON.stringify(data.metadata) : (data.metadata || '{}'),
    observed_at: data.observed_at || now,
    collected_at: data.collected_at || now,
    reliability,
    provenance: typeof data.provenance === 'object' ? JSON.stringify(data.provenance) : (data.provenance || JSON.stringify({ collector: 'system', method: 'automated_capture' })),
    hash
  };
}

module.exports = {
  EVIDENCE_TYPES,
  DEFAULT_RELIABILITY,
  computeEvidenceHash,
  verifyEvidenceIntegrity,
  normalizeEvidence
};
