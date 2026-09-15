# PRISM — Defensive Security Gap Report

**Audit Date**: September 16, 2026  
**Scope**: Complete PRISM codebase (`prism-platform/`)  
**Specification Baseline**: `05-SECURITY/THREAT-MODEL.md`, `05-SECURITY/RED-TEAM-PLAN.md`

---

## 1. Vulnerability & Security Gap Classification

### [P0] Critical Vulnerabilities (Must Fix Immediately)

1. **[RESOLVED in P0-01] Hardcoded Identity & Spoofable Authentication Middleware**
   - **Resolution**: Replaced with real native scrypt password hashing, stateful SHA-256 session token management, sliding rate limiting, and centralized `authenticate` middleware. Custom header spoofing is strictly rejected and ignored.
   - **Verification**: Covered by 9 automated tests in `tests/security/auth.test.js` and 5 tests in `tests/security/headerSpoofing.test.js` (100% passing).

2. **[RESOLVED in P0-01] Complete Absence of Server-Side Multi-Tenant Authorization**
   - **Resolution**: Implemented centralized `src/security/tenantGuard.js` enforcing complete ownership hierarchies from root organization down to nested evidence, hypotheses, experiments, verifications, root causes, recommendations, and reports. All direct endpoints enforce `WHERE organization_id = req.organization.id`.
   - **Verification**: Covered by 15 automated cross-tenant read/write/delete isolation tests in `tests/security/tenantIsolation.test.js` (100% passing).

3. **[RESOLVED in P0-03] Unauthenticated & Unsigned Inbound Webhooks**
   - **Resolution**: Implemented provider-correct cryptographic verification: GitHub HMAC-SHA256 (`X-Hub-Signature-256`), PagerDuty HMAC-SHA256 (`X-PagerDuty-Signature` with secret rotation support), and Datadog authentication (`X-Datadog-Webhook-Token`, `DD-Webhook-Token`, or HMAC). Enforces raw body verification, constant-time comparison, tenant-isolated secrets, persistent replay protection (`processed_webhooks` table), sliding-window rate limiting, and prompt-injection evidence boundaries.
   - **Verification**: Covered by 23 automated tests in `tests/security/webhookSecurity.test.js` (100% passing). Cross-tenant write attacks and tampered payloads strictly rejected.

4. **Simulated Sandbox Posing as Execution Security**
   - **File**: `src/api/routes/experiments.js:47-65`
   - **Defect**: Experiments return mock log strings instead of executing in a hardened Linux container with seccomp, AppArmor, network namespaces, and cgroups.
   - **Impact**: If real code execution is added without an isolated sandbox runner, the application will be vulnerable to arbitrary remote code execution (RCE) on the host machine.

---

### [P1] High Priority Gaps

1. **Missing Rate Limiting & Denial of Service (DoS) Defense**
   - **Defect**: The Express application has no rate-limiting middleware (`express-rate-limit`).
   - **Impact**: Attackers can flood `/api/v1/investigations/:id/evidence` with gigabytes of data, exhausting SQLite disk space and CPU during SHA-256 hashing.

2. **CORS Set to Wildcard (`app.use(cors())`)**
   - **File**: `src/server.js:28`
   - **Defect**: Default CORS configuration allows requests from any origin (`*`).
   - **Impact**: Cross-origin requests from malicious websites can access the PRISM API if hosted on an intranet or local developer machine.

3. **No Content Security Policy (CSP)**
   - **Defect**: HTTP headers lack `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, and `Strict-Transport-Security`.
   - **Impact**: Increases attack surface for Cross-Site Scripting (XSS).

4. **Mutable Audit Log**
   - **File**: `src/db/schema.sql:133`
   - **Defect**: `audit_events` is a regular SQLite table without row integrity hashes, write-once protections, or append-only guarantees. An admin or attacker with DB access can silently delete audit trails (`DELETE FROM audit_events`).

---

### [P2] Medium Priority Gaps

1. **Regex-Based PII Redaction Gaps**
   - **File**: `src/security/piiSanitizer.js`
   - **Defect**: Redaction uses fixed regular expressions. Custom API token formats, private RSA keys, and obfuscated secrets can evade regex patterns.
   - **Impact**: Sensitive corporate credentials may enter evidence and be committed to long-term memory.

2. **Absence of SSRF Protection on Repository URLs**
   - **File**: `src/api/routes/projects.js:42`
   - **Defect**: Repository URL input is stored without validating domain allowlists or resolving private RFC-1918 internal IP addresses (`169.254.169.254`, `127.0.0.1`).
   - **Impact**: If automated git cloning is added, attackers could target internal cloud metadata endpoints.

---

### [P3] Low Priority Gaps

1. **In-Memory Volatile Observability**
   - Metrics in `metrics.js` reside in volatile memory. A process crash loses latency history and audit counters.
2. **Missing Granular RBAC Permissions**
   - `User.role` is stored as a string (`LEAD_INVESTIGATOR`), but endpoints do not check roles for sensitive actions (e.g. any role can transition states or mark root causes).
