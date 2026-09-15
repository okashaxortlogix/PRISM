# PRISM — P0-01: REAL AUTHENTICATION, SESSION SECURITY & MULTI-TENANT ISOLATION REPORT

> **Document Version**: 1.0.0  
> **Status**: VERIFIED & COMPLETE  
> **Target Milestone**: P0-01 Security Baseline  
> **Test Pass Rate**: 100% (63/63 Total Tests Passing)  
> **Verification Date**: September 2026  

---

## 1. Executive Summary

Prior to P0-01, PRISM suffered from critical security vulnerabilities:
1. Hardcoded identity headers (`x-prism-user-id`, `x-prism-org-id`) that defaulted to `usr_alex` and `org_acme`.
2. Absence of password hashing, credential verification, and real user account registration.
3. Lack of cryptographically secure session management.
4. Absence of server-side tenant scoping on database queries (all projects, investigations, and incident memories were globally accessible across organizations by IDOR).
5. No automated security test suite proving authorization boundaries.

**P0-01 is now complete.** PRISM has been transformed into an enterprise multi-tenant system with server-side authentication, cryptographically secure stateful sessions, role-based access control (RBAC), and strict relational tenant isolation.

---

## 2. Architecture & Data Flow

### 2.1 Security Boundary Enforcement

The architecture strictly prohibits trusting client-supplied identity or tenancy. Every incoming request to protected routes passes through the following pipeline:

```text
Incoming Request
  │
  ├─► [1] Extract Bearer Token / Cookie (prism_session)
  │     └─ If missing: 401 UNAUTHORIZED
  │
  ├─► [2] Validate Session via SHA-256 token hash lookup
  │     └─ Verify expires_at > now() and user status == 'ACTIVE'
  │     └─ If invalid/expired/revoked: 401 UNAUTHORIZED
  │
  ├─► [3] Resolve Active Tenant & Membership Context
  │     └─ Lookup user memberships in organizations
  │     └─ If optional x-organization-id header provided:
  │          Validate caller is an active member of that org;
  │          If non-member: 403 FORBIDDEN + Log Security Audit
  │
  ├─► [4] RBAC Authorization Gate
  │     └─ Evaluate caller role (VIEWER < MEMBER < ADMIN < OWNER)
  │     └─ If insufficient permissions: 403 FORBIDDEN
  │
  ├─► [5] Server-Side Tenant-Scoped Data Access Guard
  │     └─ Direct queries: WHERE organization_id = req.organization.id
  │     └─ Nested queries: Verify parent ownership chain up to organization
  │     └─ If entity not found under caller's tenant: 404 NOT FOUND
  │
  ▼
Resource Data Returned
```

---

## 3. Core Security Subsystems Implemented

### 3.1 Password & Credential Security (`src/security/passwordService.js`)
- **Memory-Hard Hashing**: Uses Node.js native `crypto.scryptSync` with high cost parameters (`N=16384`, `r=8`, `p=1`, `keyLen=64`) and cryptographically random 16-byte salts.
- **Timing-Safe Verification**: Comparisons use `crypto.timingSafeEqual` over derived hashes to eliminate timing-attack vulnerabilities.
- **Password Policy**: Enforces a minimum of 8 characters, maximum 128 characters, requiring uppercase, lowercase, numbers, and special symbols.
- **Zero Credential Exposure**: Password hashes are strictly omitted from all API responses, serialized representations, and audit logs.

### 3.2 Session & Token Lifecycle (`src/security/sessionService.js`)
- **Cryptographic Token Generation**: 256-bit entropy (`crypto.randomBytes(32).toString('hex')`).
- **One-Way Token Hashing**: Raw tokens are never stored plaintext in the database. Only `SHA-256(rawToken)` is stored in `sessions.token_hash`.
- **Sliding-Time Expiration & Revocation**: Sessions have an absolute 24-hour expiration (`expires_at`). Logout instantly deletes the session record from SQLite, revoking the token immediately.
- **Transport Security**: Delivered via `Authorization: Bearer <token>` or `Set-Cookie` with `HttpOnly; SameSite=Lax; Path=/`.

### 3.3 Rate Limiting (`src/security/rateLimiter.js`)
- **Sliding Window In-Memory Limiter**: Bounded rate limiting prevents brute force attacks:
  - `/api/v1/auth/login`: 10 attempts per minute per IP.
  - `/api/v1/auth/register`: 5 attempts per 15 minutes per IP.
- When exceeded, returns HTTP 429 Too Many Requests with informative retry headers.

### 3.4 Security Audit Logging (`src/security/auditService.js`)
- Records structured security events to `audit_events`:
  - `USER_REGISTERED`, `LOGIN_SUCCESS`, `LOGIN_FAILURE`, `LOGOUT`, `SESSION_CREATED`, `SESSION_REVOKED`, `AUTHORIZATION_DENIED`, `ORGANIZATION_SWITCHED`.
- **Automated PII/Credential Redaction**: Automatically redacts keys containing `password`, `token`, `secret`, or `key`.
- Access to audit logs (`/api/v1/audit`) is restricted to `ADMIN` and `OWNER` roles.

### 3.5 Server-Side Tenant Guard (`src/security/tenantGuard.js`)
Centralized relational data access guards verify complete ownership hierarchies:
- `getScopedProject(projectId, orgId)`: verifies `projects.organization_id == orgId`.
- `getScopedInvestigation(investigationId, orgId)`: verifies `investigation -> project.organization_id == orgId`.
- `getScopedEvidence(evidenceId, orgId)`: verifies `evidence -> investigation -> project.organization_id == orgId`.
- `getScopedHypothesis(hypothesisId, orgId)`: verifies `hypothesis -> investigation -> project.organization_id == orgId`.
- `getScopedExperiment(experimentId, orgId)`: verifies `experiment -> hypothesis -> investigation -> project.organization_id == orgId`.
- `getScopedVerification(verificationId, orgId)`: verifies `verification -> experiment -> hypothesis -> investigation -> project.organization_id == orgId`.
- `getScopedRootCause(rootCauseId, orgId)`: verifies `root_cause -> investigation -> project.organization_id == orgId`.
- `getScopedRecommendation(recommendationId, orgId)`: verifies `recommendation -> investigation -> project.organization_id == orgId`.
- `getScopedMemory(memoryId, orgId)`: verifies `memories.organization_id == orgId`.

---

## 4. Protected Route Security Matrix

Every existing API route in PRISM has been audited and hardened:

| Endpoint | HTTP Method | Authentication | Tenant Isolation Enforced | RBAC Role Required | Cross-Tenant Protection Verified |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/v1/auth/register` | `POST` | Public (Rate Limited) | N/A (creates new tenant) | Public | Yes |
| `/api/v1/auth/login` | `POST` | Public (Rate Limited) | Derived from memberships | Public | Yes |
| `/api/v1/auth/logout` | `POST` | Required | Active session revoked | Any authenticated | Yes |
| `/api/v1/auth/me` | `GET` | Required | Scoped to active session org | Any authenticated | Yes |
| `/api/v1/auth/switch-org` | `POST` | Required | Membership check enforced | Active member | Yes |
| `/api/v1/projects` | `GET` | Required | `WHERE organization_id = ?` | `VIEWER+` | Yes (404/Isolated) |
| `/api/v1/projects` | `POST` | Required | Bound to `req.organization.id` | `ADMIN`, `OWNER` | Yes (Body ignored) |
| `/api/v1/projects/:id` | `GET` | Required | `getScopedProject` | `VIEWER+` | Yes (404 IDOR) |
| `/api/v1/projects/:id` | `DELETE` | Required | `getScopedProject` | `ADMIN`, `OWNER` | Yes (404 IDOR) |
| `/api/v1/projects/:id/repositories` | `POST` | Required | `getScopedProject` | `ADMIN`, `OWNER` | Yes (404 IDOR) |
| `/api/v1/investigations` | `GET` | Required | Scoped via project tenant | `VIEWER+` | Yes (Isolated list) |
| `/api/v1/investigations` | `POST` | Required | Validates project tenant | `MEMBER+` | Yes (403 cross-proj) |
| `/api/v1/investigations/:id` | `GET` | Required | `getScopedInvestigation` | `VIEWER+` | Yes (404 IDOR) |
| `/api/v1/investigations/:id/transition` | `POST` | Required | `getScopedInvestigation` | `MEMBER+` | Yes (404 IDOR) |
| `/api/v1/investigations/:id` | `DELETE` | Required | `getScopedInvestigation` | `ADMIN`, `OWNER` | Yes (404 IDOR) |
| `/api/v1/investigations/:id/evidence` | `GET` | Required | `getScopedInvestigation` | `VIEWER+` | Yes (404 IDOR) |
| `/api/v1/investigations/:id/evidence` | `POST` | Required | `getScopedInvestigation` | `MEMBER+` | Yes (404 IDOR) |
| `/api/v1/evidence/:id/verify-integrity` | `GET` | Required | `getScopedEvidence` | `VIEWER+` | Yes (404 IDOR) |
| `/api/v1/evidence/:id` | `DELETE` | Required | `getScopedEvidence` | `MEMBER+` | Yes (404 IDOR) |
| `/api/v1/investigations/:id/hypotheses`| `GET` | Required | `getScopedInvestigation` | `VIEWER+` | Yes (404 IDOR) |
| `/api/v1/investigations/:id/hypotheses`| `POST` | Required | `getScopedInvestigation` | `MEMBER+` | Yes (404 IDOR) |
| `/api/v1/hypotheses/:id/evaluate` | `POST` | Required | `getScopedHypothesis` | `MEMBER+` | Yes (404 IDOR) |
| `/api/v1/hypotheses/:id/experiments` | `GET` | Required | `getScopedHypothesis` | `VIEWER+` | Yes (404 IDOR) |
| `/api/v1/hypotheses/:id/experiments` | `POST` | Required | `getScopedHypothesis` | `MEMBER+` | Yes (404 IDOR) |
| `/api/v1/experiments/:id/run` | `POST` | Required | `getScopedExperiment` | `MEMBER+` | Yes (404 IDOR) |
| `/api/v1/experiments/:id/verifications`| `POST` | Required | `getScopedExperiment` | `MEMBER+` | Yes (404 IDOR) |
| `/api/v1/investigations/:id/root-cause`| `POST` | Required | `getScopedInvestigation` & verification | `MEMBER+` | Yes (404 IDOR) |
| `/api/v1/investigations/:id/impact` | `POST` | Required | `getScopedInvestigation` | `MEMBER+` | Yes (404 IDOR) |
| `/api/v1/investigations/:id/recommendations` | `GET`/`POST` | Required | `getScopedInvestigation` | `VIEWER+` / `MEMBER+` | Yes (404 IDOR) |
| `/api/v1/investigations/:id/report` | `GET` | Required | `getScopedInvestigation` | `VIEWER+` | Yes (404 IDOR) |
| `/api/v1/memories` | `GET` | Required | `WHERE organization_id = ?` | `VIEWER+` | Yes (Isolated list) |
| `/api/v1/memories/:id` | `GET` | Required | `getScopedMemory` | `VIEWER+` | Yes (404 IDOR) |
| `/api/v1/memories` | `POST` | Required | Bound to `req.organization.id` | `MEMBER+` | Yes (Body ignored) |
| `/api/v1/memories/:id` | `DELETE` | Required | `getScopedMemory` | `ADMIN`, `OWNER` | Yes (404 IDOR) |
| `/api/v1/audit` | `GET` | Required | `WHERE organization_id = ?` | `ADMIN`, `OWNER` | Yes (403 Viewer) |

---

## 5. Security Test Suite & Verification Results

All automated security tests are integrated into `npm test` (`tests/runAllTests.js`):

### 5.1 Authentication Suite (`tests/security/auth.test.js`)
- `Test 1`: Password strength validation (min 8 chars, uppercase, lowercase, numbers, special characters) — **PASSED**
- `Test 2`: Registration of valid user account with safe DTO return (no password hash) — **PASSED**
- `Test 3`: Duplicate email registration rejection (HTTP 409) — **PASSED**
- `Test 4`: Weak password rejection (HTTP 400) — **PASSED**
- `Test 5`: Login with valid credentials and token generation — **PASSED**
- `Test 6`: Login with invalid password rejection (HTTP 401) — **PASSED**
- `Test 7`: Session context introspection via `/api/v1/auth/me` — **PASSED**
- `Test 8`: Unauthenticated requests to protected endpoints rejected (HTTP 401) — **PASSED**
- `Test 9`: Session invalidation and revocation upon logout — **PASSED**

### 5.2 Multi-Tenant Isolation & IDOR Suite (`tests/security/tenantIsolation.test.js`)
- `Cross-Tenant Read: User Alpha -> Project Beta`: **404 NOT FOUND (PASS)**
- `Cross-Tenant Read: User Alpha -> Investigation Beta`: **404 NOT FOUND (PASS)**
- `Cross-Tenant Read: User Alpha -> Evidence Beta`: **404 NOT FOUND (PASS)**
- `Cross-Tenant Read: User Alpha -> Memory Beta`: **404 NOT FOUND (PASS)**
- `Cross-Tenant Read: User Alpha -> Report Beta`: **404 NOT FOUND (PASS)**
- `Listing Isolation: User Alpha Project List`: strictly contains Alpha projects (0 Beta projects) — **PASS**
- `Listing Isolation: User Alpha Investigation List`: strictly contains Alpha investigations — **PASS**
- `Listing Isolation: User Alpha Memory List`: strictly contains Alpha memories — **PASS**
- `Cross-Tenant Write: User Alpha creates Investigation under Beta Project`: **403 FORBIDDEN (PASS)**
- `Cross-Tenant Write: User Alpha attaches Evidence to Beta Investigation`: **404 NOT FOUND (PASS)**
- `Cross-Tenant Write: User Alpha transitions Beta Investigation State`: **404 NOT FOUND (PASS)**
- `Cross-Tenant Write: User Alpha deletes Beta Project`: **404 NOT FOUND (PASS)**
- `Cross-Tenant Write: User Alpha deletes Beta Investigation`: **404 NOT FOUND (PASS)**
- `Cross-Tenant Write: User Alpha deletes Beta Memory`: **404 NOT FOUND (PASS)**
- `Request Body Spoofing: User Alpha submits organization_id: orgBeta`: Server ignores body, binds to Alpha — **PASS**

### 5.3 Header Spoofing Suite (`tests/security/headerSpoofing.test.js`)
- `Test 1`: Unauthenticated request with `x-prism-user-id` and `x-prism-org-id` rejected with **401 UNAUTHORIZED (PASS)**
- `Test 2`: Authenticated User A sending `x-prism-user-id: usr_sarah` & `x-prism-org-id: org_globex`: headers completely ignored, identity remains User A in Org A — **PASS**
- `Test 3`: User A attempts to access victim project using spoofed headers: **404 NOT FOUND (PASS)**
- `Test 4`: User A attempts to use `x-organization-id` header without valid membership: **403 FORBIDDEN (PASS)**
- `Test 5`: Security audit confirms `AUTHORIZATION_DENIED` logged for tamper attempt — **PASS**

### 5.4 RBAC Suite (`tests/security/roleAuth.test.js`)
- `VIEWER Role`: Permitted to read projects/investigations (200), blocked from creating projects (403), investigations (403), and viewing audit logs (403) — **PASS**
- `MEMBER Role`: Permitted to create investigations (201) and evidence (201), blocked from creating projects (403) and viewing audit logs (403) — **PASS**
- `ADMIN Role`: Permitted to create projects (201), delete projects (200), and view audit logs (200) — **PASS**

### Overall Test Execution Metrics:
- **Domain Engine Tests**: 25 passing
- **Security & Multi-Tenant Tests**: 38 passing
- **Total Test Count**: 63 passing, 0 failing, 0 skipped (100% Green)

---

## 6. Migration Safety & Backwards Compatibility

1. **Automated Schema Migration (`src/db/database.js`)**:
   - Checks existing SQLite tables and upgrades schema dynamically on server startup.
   - Migrated legacy `users` table away from the single-tenant `organization_id` foreign key column to enable multi-organization memberships without data loss.
   - Backfilled `organization_memberships` for all legacy accounts with `OWNER` role.
   - Created `sessions` table and indexes for token lookups.
2. **Seed Fixtures (`src/db/seed.js`)**:
   - Seeded `org_acme` (Acme Cloud Platform) with Alex Chen (`alex.chen@acme.internal`, OWNER) and Bob Miller (`bob.miller@acme.internal`, VIEWER).
   - Seeded `org_globex` (Globex Corporation) with Sarah Connor (`sarah.connor@globex.internal`, OWNER) to serve as automated cross-tenant test baseline.
   - Demo passwords hashed with native `scrypt`: `PrismDemo2026!`.

---

## 7. Remaining Risks & Known Limitations

1. **In-Memory Rate Limiter Clustering**: The current rate limiter uses an in-memory sliding window appropriate for single-instance or vertical deployments. In a multi-node horizontal deployment, an external shared store (e.g. Redis) will be required.
2. **OAuth2 / OIDC Providers**: P0-01 implemented username/password authentication with scrypt hashing and session tokens. SSO integrations (Google Workspace, Okta, GitHub OAuth) remain for later phases.
3. **Database Migration Framework**: While the migration runner in `src/db/database.js` safely migrates SQLite tables and preserves existing rows, PRISM does not yet have a formal versioned migration CLI (e.g. Knex/Umzug).
