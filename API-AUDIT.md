# PRISM — API Endpoint Audit & Contract Review

**Audit Date**: September 16, 2026  
**Target Codebase**: `prism-platform/src/api/routes/`  
**Specification Reference**: `08-BACKEND/API-CONTRACTS.md`

---

## 1. API Contract Evaluation

`08-BACKEND/API-CONTRACTS.md` specifies:
1. Version public APIs (`/api/v1/...`).
2. Validate every request server-side.
3. Return stable error structures (`{ success, error: { code, message } }`).
4. Enforce authorization at the API/domain boundary.
5. Use idempotency keys for retryable mutations.
6. Never trust client-provided tenant/project ownership.
7. Long-running operations return job references rather than blocking requests.

---

## 2. Endpoint-by-Endpoint Forensic Audit

| Endpoint | Method | Auth Check | Authz Check | Input Validation | Concurrency Control | Audit Logged | Status | Notes / Defects |
|---|---|---|---|---|---|---|---|---|
| `/api/health` | GET | None | None | None | N/A | No | **IMPLEMENTED** | Returns `{ status: "HEALTHY", version: "1.0.0" }`. |
| `/metrics` | GET | None | None | None | N/A | No | **IMPLEMENTED** | Prometheus text exposition format. |
| `/api/v1/projects` | GET | Hardcoded | None | None | N/A | No | **INSECURE** | Returns all projects regardless of tenant organization. |
| `/api/v1/projects` | POST | Hardcoded | None | Basic name check | None | No | **PARTIALLY_IMPLEMENTED** | Inserts project row; no slug uniqueness check. |
| `/api/v1/projects/:id/repositories` | POST | Hardcoded | None | Basic URL check | None | No | **PARTIALLY_IMPLEMENTED** | Stores URL string; no repository validation. |
| `/api/v1/investigations` | GET | Hardcoded | None | Query params | N/A | No | **INSECURE** | Leaks cross-tenant investigations if queried without filter. |
| `/api/v1/investigations/:id` | GET | Hardcoded | None | URL param | N/A | No | **PARTIALLY_IMPLEMENTED** | Aggregates all child tables in sequential synchronous SQL queries. |
| `/api/v1/investigations` | POST | Hardcoded | None | Title & problem | None | Yes | **PARTIALLY_IMPLEMENTED** | Creates investigation; hardcodes `created_by` to `usr_alex`. |
| `/api/v1/investigations/:id/transition` | POST | Hardcoded | None | Target state enum | None | Yes | **IMPLEMENTED (Basic)** | Enforces state machine rules, but lacks optimistic concurrency locking. |
| `/api/v1/investigations/:id/evidence` | GET | Hardcoded | None | URL param | N/A | No | **IMPLEMENTED** | Returns evidence items sorted by collected_at. |
| `/api/v1/investigations/:id/evidence` | POST | Hardcoded | None | Title, source, content | None | Yes | **IMPLEMENTED** | Sanitizes PII, computes SHA-256 hash, inserts row. |
| `/api/v1/evidence/:id/verify-integrity` | GET | Hardcoded | None | URL param | N/A | No | **IMPLEMENTED** | Recalculates hash and compares against DB stored hash. |
| `/api/v1/investigations/:id/evidence/gaps`| GET | Hardcoded | None | URL param | N/A | No | **IMPLEMENTED** | Checks presence of LOG, REPOSITORY_CODE, TEST_RESULT. |
| `/api/v1/investigations/:id/hypotheses` | GET | Hardcoded | None | URL param | N/A | No | **IMPLEMENTED** | Returns hypotheses ordered by confidence. |
| `/api/v1/investigations/:id/hypotheses` | POST | Hardcoded | None | Statement & rationale | None | No | **IMPLEMENTED (Basic)** | Calculates confidence score using heuristic formula. |
| `/api/v1/hypotheses/:id/evaluate` | POST | Hardcoded | None | URL param | None | No | **IMPLEMENTED** | Recalculates confidence score. |
| `/api/v1/hypotheses/:id/experiments` | GET | Hardcoded | None | URL param | N/A | No | **IMPLEMENTED** | Returns experiments for a hypothesis. |
| `/api/v1/hypotheses/:id/experiments` | POST | Hardcoded | None | Plan string | None | No | **IMPLEMENTED (Basic)** | Inserts experiment plan. |
| `/api/v1/experiments/:id/run` | POST | Hardcoded | None | URL param | None | No | **SIMULATED** | Synchronously generates fake log strings. Does NOT run real sandbox. |
| `/api/v1/experiments/:id/verifications` | POST | Hardcoded | None | Claim, method, actual | None | No | **PARTIALLY_IMPLEMENTED** | Validates outcome string; blocks "not enough data" as VERIFIED. |
| `/api/v1/investigations/:id/root-cause` | POST | Hardcoded | None | Statement & ver_ref | None | Yes | **PARTIALLY_IMPLEMENTED** | Requires verification with outcome=VERIFIED. |
| `/api/v1/investigations/:id/impact` | POST | Hardcoded | None | Impact descriptions | None | No | **PARTIALLY_IMPLEMENTED** | Computes blast radius level based on component count. |
| `/api/v1/investigations/:id/recommendations` | GET | Hardcoded | None | URL param | N/A | No | **IMPLEMENTED** | Returns recommendations ordered by priority. |
| `/api/v1/investigations/:id/recommendations` | POST | Hardcoded | None | Action, rationale, risk | None | Yes | **IMPLEMENTED** | Inserts recommendation row. |
| `/api/v1/investigations/:id/report` | GET | Hardcoded | None | Format query param | N/A | No | **IMPLEMENTED** | Exports Markdown, JSON, or HTML. |
| `/api/v1/memories` | GET | Hardcoded | None | Keyword query string | N/A | No | **PARTIALLY_IMPLEMENTED** | Linear keyword match with exponential decay score. |
| `/api/v1/memories` | POST | Hardcoded | None | Title, root_cause, fix | None | No | **PARTIALLY_IMPLEMENTED** | Stores reusable incident memory. |
| `/api/v1/audit` | GET | Hardcoded | None | Query limit | N/A | No | **IMPLEMENTED** | Returns audit events. |
| `/api/v1/integrations/github/webhook` | POST | None | None | None | None | No | **INSECURE** | Zero HMAC signature check. Spoofable. |
| `/api/v1/integrations/datadog/webhook` | POST | None | None | None | None | No | **INSECURE** | Zero signature check. Spoofable. |
| `/api/v1/integrations/pagerduty/webhook` | POST | None | None | None | None | No | **INSECURE** | Zero signature check. Spoofable. |

---

## 3. Key Violations of `API-CONTRACTS.md`

1. **Violation of Rule 7 (Asynchronous Architecture)**:
   - Specification: *"Long-running operations return job/investigation references rather than blocking requests."*
   - Reality: `/experiments/:id/run` and evidence gap analysis run synchronously on the main thread.
2. **Violation of Rule 5 (Idempotency Keys)**:
   - Specification: *"Use idempotency keys for retryable mutations where appropriate."*
   - Reality: Zero endpoints accept or validate an `Idempotency-Key` header. Retrying a POST request produces duplicate evidence, hypotheses, and recommendations.
3. **Violation of Rule 6 (Tenant Trust)**:
   - Specification: *"Never trust client-provided tenant/project ownership."*
   - Reality: Client can supply arbitrary `project_id` and `organization_id` in request payloads without validation.
