# PRISM — Privacy & Data Protection Gap Report

**Audit Date**: September 16, 2026  
**Target File**: `prism-platform/src/security/piiSanitizer.js`, `prism-platform/src/engine/evidenceEngine.js`  
**Specification Baseline**: `16-COMPLIANCE-PRIVACY/PRIVACY-SPEC.md`

---

## 1. Privacy Architecture Review

`16-COMPLIANCE-PRIVACY/PRIVACY-SPEC.md` outlines foundational privacy requirements:
1. Collect only necessary engineering data.
2. Isolate customer and tenant data strictly.
3. Define retention and deletion schedules.
4. Redact secrets and personal data before persistence.
5. Prevent customer proprietary code from entering third-party model training datasets.

---

## 2. Forensic Findings & Privacy Gaps

### GAP-PRIV-01: Incomplete PII & Secret Redaction
- **Location**: `src/security/piiSanitizer.js`
- **Current State**: Uses 6 basic regex patterns covering standard bearer tokens, `api_key` labels, AWS access keys, JWTs, standard credit cards, and basic emails.
- **Vulnerabilities**:
  - Does NOT redact SSH private keys (`-----BEGIN OPENSSH PRIVATE KEY-----`).
  - Does NOT redact GCP service account JSON credentials.
  - Does NOT redact phone numbers, physical addresses, or IP addresses.
  - Evidence `title`, `source_ref`, and `metadata` are NOT passed through `sanitizeEvidenceContent()`—only raw `content` is sanitized (`src/engine/evidenceEngine.js:72`).

### GAP-PRIV-02: Absence of Data Retention & Deletion Schedules
- **Location**: `src/db/schema.sql`
- **Current State**: All database records are stored indefinitely.
- **Specification Expectation**: Automated TTL policies for raw logs and telemetry evidence (e.g. 30-day purge for raw logs, permanent retention only for verified root causes and high-level recommendations).
- **Impact**: Accumulating customer log files indefinitely violates GDPR data minimization and creates excessive discovery liability.

### GAP-PRIV-03: Right to Be Forgotten & Project Deletion Gaps
- **Current State**: There is no API route or service to delete an organization or project and cascade soft/hard deletes across all associated memories, evidence items, and audit records.
- **Impact**: Failure to comply with GDPR Articles 17 (Right to Erasure) and 20 (Data Portability).

### GAP-PRIV-04: Cross-Project Memory Contamination Risk
- **Location**: `src/api/routes/memories.js:15`
- **Current State**: When querying historical memories, if `projectId` is omitted, the API returns memories across the entire database without checking organization tenancy:
  ```javascript
  let query = 'SELECT * FROM memories WHERE 1=1';
  ```
- **Impact**: One project or customer can read incident summaries, root causes, and architectural details from another project.

### GAP-PRIV-05: LLM Data Processing Safeguards Not Configured
- **Current State**: No LLM integration exists yet, but when implemented, there are no Zero Data Retention (ZDR) agreements or prompt boundary sanitizers configured to guarantee that uploaded code diffs are not retained or used for model retraining by external providers.
