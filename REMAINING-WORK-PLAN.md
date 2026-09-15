# PRISM — Remaining Work Plan & Engineering Backlog

**Audit Date**: September 16, 2026  
**Purpose**: Define the precise, actionable engineering tasks required to transition PRISM from an early prototype to a verified, production-ready engineering investigation platform.

---

## 1. Task Prioritization Summary

- **P0 — Must Fix Before Further Expansion**: Core security, real authentication, tenant isolation, and database schema integrity.
- **P1 — Required for V1 Launch**: Real LLM/AI reasoning integration, true asynchronous job workers, repository AST ingestion, empirical sandbox verification, and end-to-end integration tests.
- **P2 — Required for Production Scale**: Vector semantic memory bank, distributed observability & tracing, robust migration engine, and backup/restore automation.
- **P3 — Future Enhancements**: Bi-directional issue tracker syncing, multi-region database failover, and full client-side localization.

---

## 2. [P0] Critical Foundation Tasks (Must Fix First)

### Task P0-01: Implement Real Authentication & Session Security [COMPLETED & VERIFIED]
- **Status**: **COMPLETE** (Verified with 100% passing tests)
- **Implemented**: Native `scrypt` password hashing, stateful SHA-256 session token management, sliding rate limiting, `/api/v1/auth` endpoints (`register`, `login`, `logout`, `me`, `switch-org`), and centralized `authenticate` & `requireRole` middleware.
- **Files**: `src/security/passwordService.js`, `src/security/sessionService.js`, `src/security/rateLimiter.js`, `src/security/authMiddleware.js`, `src/api/routes/auth.js`, `tests/security/auth.test.js`.
- **Verification**: 9 automated tests passing in `tests/security/auth.test.js`.

---

### Task P0-02: Enforce Server-Side Multi-Tenant Isolation [COMPLETED & VERIFIED]
- **Status**: **COMPLETE** (Verified with 100% passing tests)
- **Implemented**: Centralized `src/security/tenantGuard.js` enforcing ownership hierarchies from tenant organizations down to nested investigations, evidence, hypotheses, experiments, verifications, root causes, recommendations, and reports. All database queries enforce `WHERE organization_id = req.organization.id`.
- **Files**: `src/security/tenantGuard.js`, all routers in `src/api/routes/`, `tests/security/tenantIsolation.test.js`, `tests/security/headerSpoofing.test.js`, `tests/security/roleAuth.test.js`.
- **Verification**: 15 cross-tenant read/write tests in `tests/security/tenantIsolation.test.js` + 5 header spoofing tests + 9 RBAC tests (100% passing).

---

### Task P0-03: Inbound Webhook Cryptographic Verification & Replay Protection [COMPLETED & VERIFIED]
- **Status**: **COMPLETE** (Verified with 100% passing tests)
- **Implemented**: Provider-correct cryptographic verification (GitHub `X-Hub-Signature-256`, PagerDuty `X-PagerDuty-Signature` with secret rotation support, and Datadog `X-Datadog-Webhook-Token`/`DD-Webhook-Token`/HMAC). Enforces raw request body verification (`req.rawBody`), constant-time signature comparison (`timingSafeEqual`), tenant-scoped secret resolution, persistent delivery replay deduplication (`processed_webhooks` table), sliding rate limiting, payload size limits, prompt injection trust boundary marking, and credential-safe security audit logging.
- **Files**: `src/security/webhookVerifier.js`, `src/api/routes/integrations.js`, `src/server.js`, `src/db/schema.sql`, `src/db/database.js`, `tests/security/webhookSecurity.test.js`, `P0-03-WEBHOOK-SECURITY-REPORT.md`.
- **Verification**: 23 automated tests passing in `tests/security/webhookSecurity.test.js`. Master test suite: 86 passing, 0 failing.

---

### Task P0-04: Database Schema Normalization & Indexing [COMPLETED & VERIFIED]
- **Status**: **COMPLETE** (Verified with 100% passing tests)
- **Implemented**: Created normalized join tables `hypothesis_evidence`, `memory_tags`, and `root_cause_evidence` with composite uniqueness and foreign-key cascades. Linked `root_causes(verification_ref)` to `verifications(id)`. Implemented deterministic versioned migration runner with `schema_migrations` tracking table and automatic data backfill. Created 16 targeted B-tree and composite indexes, and verified index utilization via SQLite `EXPLAIN QUERY PLAN`.
- **Files**: `src/db/schema.sql`, `src/db/database.js`, `src/db/seed.js`, `src/api/routes/hypotheses.js`, `src/api/routes/memories.js`, `src/api/routes/rootCauses.js`, `tests/database/schemaNormalization.test.js`, `P0-04-DATABASE-SCHEMA-REPORT.md`.
- **Verification**: 13 automated tests passing in `tests/database/schemaNormalization.test.js`. Master test suite: 99 passing, 0 failing.

---

## 3. [P1] Required for V1 Launch

### Task P1-01: True Asynchronous Job Queue & Worker Architecture [COMPLETED & VERIFIED]
- **Status**: **COMPLETE** (Verified with 100% passing tests)
- **Implemented**: Embedded durable SQLite job queue with transactional atomic claiming, priority ordering (HIGH/NORMAL/LOW), bounded retries with exponential backoff and jitter, lease heartbeats and stale-job dead-worker recovery, execution checkpoints for resumability, cooperative cancellation, server-side tenant isolation, and Prometheus queue observability. Added `/api/v1/jobs` endpoints, `/api/v1/investigations/:id/execute` returning HTTP 202 Accepted, and asynchronous investigation creation.
- **Files**: `src/queue/jobQueue.js`, `src/queue/jobWorker.js`, `src/queue/jobErrors.js`, `src/queue/handlers/`, `src/api/routes/jobs.js`, `src/api/routes/investigations.js`, `src/server.js`, `src/db/schema.sql`, `src/db/database.js`, `src/observability/metrics.js`, `tests/jobs/jobQueue.test.js`, `P1-01-ASYNC-JOB-QUEUE-REPORT.md`.
- **Verification**: 19 automated tests passing in `tests/jobs/jobQueue.test.js`. Master test suite: 118 passing, 0 failing (100% green).

---

### Task P1-02: Repository Ingestion, Git Adapter Hardening & File Tree Indexing [COMPLETED & VERIFIED]
- **Status**: **COMPLETE** (Verified with 100% passing tests)
- **Implemented**: Strict Git URL security validation (preventing argument injection, shell metacharacter execution, and protocol traversal), deterministic file tree traversal ignoring binaries and vendor folders, SHA-256 content hashing, language detection, dependency manifest parsers for NPM (`package.json`), Go Modules (`go.mod`), and Python (`requirements.txt`). Implemented background ingestion worker pipeline (`JOB_TYPES.REPOSITORY_INGESTION`) with checkpoints, `repository_files` and `repository_dependencies` normalized persistence, automatic synthesis of immutable `REPOSITORY_CODE` evidence items, and tenant-scoped REST APIs (`/api/v1/repositories/:id`, `/api/v1/repositories/:id/files`, `/api/v1/repositories/:id/dependencies`, `/api/v1/repositories/:id/sync`, and `POST /api/v1/projects/:projectId/repositories`).
- **Files**: `src/ingestion/gitValidator.js`, `src/ingestion/repoIndexer.js`, `src/queue/handlers/repoIngestionHandler.js`, `src/api/routes/repositories.js`, `src/api/routes/projects.js`, `src/queue/jobQueue.js`, `src/queue/jobWorker.js`, `src/server.js`, `src/db/schema.sql`, `src/db/database.js`, `tests/ingestion/repoIngestion.test.js`, `P1-02-REPOSITORY-INGESTION-REPORT.md`.
- **Verification**: 16 automated tests passing in `tests/ingestion/repoIngestion.test.js`. Master test suite: 134 passing, 0 failing (100% green).

---

### Task P1-03: Abstract Syntax Tree (AST) Parsing & Symbol Call-Graph Modeling
- **Why**: PRISM needs deep syntactic code comprehension and caller-callee relationship graphs across repository source files.
- **Current State**: File inventory and dependency manifests indexed; no AST symbol extraction or call-graph models.
- **Required State**: Multi-language AST parsing (Babel / TypeScript / Tree-sitter), symbol tables (functions, classes, interfaces, variables), caller-callee relationship graphing, and code entity indexing for investigations.
- **Files Affected**: `src/ingestion/astParser.js` [NEW], `src/ingestion/symbolGraph.js` [NEW], `src/db/schema.sql`, `src/db/database.js`.
- **Complexity**: High (4-5 days).
- **Testing Required**: AST syntax tree fixtures, symbol table accuracy tests, call graph traversal tests.
- **Acceptance Criteria**: Ingested repository populates symbol tables and caller-callee call graphs.

---

### Task P1-04: Production AI / LLM Gateway & Structured Output Engine
- **Why**: PRISM currently has zero AI models and cannot read or reason about code/logs.
- **Current State**: 70 lines of static division in `intelligenceEngine.js`.
- **Required State**: Integrate real LLM client (e.g. Gemini 1.5 Pro / Claude 3.5 Sonnet) with schema-constrained JSON outputs, prompt templates, token budgeting, and fallback handling.
- **Files Affected**: `src/ai/gateway.js` [NEW], `src/ai/prompts/` [NEW], `src/engine/intelligenceEngine.js`.
- **Complexity**: High (5 days).
- **Testing Required**: Schema validation unit tests; prompt snapshot tests; mock LLM failure tests.
- **Acceptance Criteria**: Given an investigation problem and evidence, the AI autonomously produces valid schema-compliant hypotheses citing specific evidence IDs.

---

### Task P1-05: Isolated Sandbox Experiment Runner (Phase 05)
- **Why**: The experiment runner currently generates mock strings.
- **Current State**: String concatenation simulator in `experiments.js:47-65`.
- **Required State**: Real isolated execution runner using Docker/containerd or ephemeral microVMs with strict memory/CPU limits and no host filesystem access.
- **Files Affected**: `src/sandbox/` [NEW], `src/api/routes/experiments.js`.
- **Complexity**: High (5-7 days).
- **Testing Required**: Sandbox escape tests; resource exhaustion limits tests; artifact capture tests.
- **Acceptance Criteria**: Experiments execute real code/commands in isolated containers and capture standard output/exit codes.

---

### Task P1-05: Comprehensive End-to-End & Integration Test Suite
- **Why**: Existing 21 unit assertions test almost none of the application.
- **Current State**: 5 test files testing pure arithmetic functions; 0 HTTP route tests.
- **Required State**: Supertest integration tests for all 30 endpoints; Playwright E2E tests for the web console.
- **Files Affected**: `tests/integration/` [NEW], `tests/e2e/` [NEW].
- **Complexity**: Medium (3-4 days).
- **Testing Required**: Full CI pipeline execution.
- **Acceptance Criteria**: Test coverage >80% on backend routes and critical state machine paths.

---

## 4. [P2] Required for Production Scale

### Task P2-01: Vector Embeddings & Semantic Memory Bank (Phase 07)
- Integrate vector embeddings (e.g. `text-embedding-3-small` / Gemini embeddings) and SQLite vector extension (`sqlite-vec`) or Chroma/Qdrant for true semantic similarity search.

### Task P2-02: OpenTelemetry Distributed Tracing & SRE Observability (Phase 08)
- Replace in-memory latency counters with OpenTelemetry SDK exporting traces and metrics to Prometheus/Jaeger.

### Task P2-03: Automated Backups & Disaster Recovery Drills (Phase 08)
- Implement Litestream or WAL streaming to S3 with automated restore validation scripts.
