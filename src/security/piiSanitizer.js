// PRISM Privacy & Compliance Sanitizer
// Strictly adheres to 16-COMPLIANCE-PRIVACY/PRIVACY-SPEC.md
// Redacts secrets, PII, API tokens, and credentials before persistence

const REDACTION_PATTERNS = [
  // Bearer and API tokens
  { regex: /Bearer\s+[A-Za-z0-9\-\._~\+\/]+=*/gi, replacement: 'Bearer [REDACTED_TOKEN]' },
  { regex: /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]+['"]/gi, replacement: '$1: "[REDACTED_SECRET]"' },
  // AWS Access Key ID
  { regex: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[REDACTED_AWS_KEY]' },
  // JWT Tokens (header.payload.signature)
  { regex: /\beyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, replacement: '[REDACTED_JWT]' },
  // Credit Card Numbers (13-19 digits)
  { regex: /\b(?:\d[ -]*?){13,16}\b/g, replacement: '[REDACTED_CREDIT_CARD]' },
  // Email addresses in logs
  { regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b/g, replacement: '[REDACTED_EMAIL]' }
];

/**
 * Sanitizes input text, stripping credentials and sensitive PII
 */
function sanitizeEvidenceContent(rawContent) {
  if (!rawContent) return '';
  let text = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);

  for (const { regex, replacement } of REDACTION_PATTERNS) {
    text = text.replace(regex, replacement);
  }

  return text;
}

module.exports = {
  sanitizeEvidenceContent,
  REDACTION_PATTERNS
};
