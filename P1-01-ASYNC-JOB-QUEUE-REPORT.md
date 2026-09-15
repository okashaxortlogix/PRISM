# PRISM — P1-01 Asynchronous Job Queue & Background Worker Architecture Report

**Task ID**: P1-01  
**Status**: **COMPLETE & VERIFIED (100% GREEN)**  
**Verification Date**: 2026-09-16  
**Test Suite**: 118 passed, 0 failed, 0 skipped (57 domain & architecture + 61 security & isolation)

---

## A. Previous Synchronous Architecture & Forensic Assessment

Prior to P1-01, PRISM executed investigation transitions, confidence evaluations, and evidence checks synchronously within the HTTP request/response loop.

### Previous Synchronous Bottlenecks:
1. **HTTP Timeout Vulnerability**: Complex investigations spanning multiple services, gathering hundreds of evidence items, and calculating cross-hypothesis contradictions could block Express request handlers, causing reverse-proxy timeouts (e.g. 504 Gateway Timeout).
2. **Crash Fragility**: If a Node.js process crashed or was restarted mid-investigation, all in-flight progress was lost because state transitions were committed only upon full endpoint completion.
3. **Double-Execution & Lack of Idempotency**: Repeated client requests (e.g. browser retries on slow connections) repeatedly triggered duplicate evaluation loops.
4. **No Backpressure or Priority**: Heavy investigations starved lightweight queries because requests competed directly on the single-threaded Node event loop without concurrency caps or priority sorting.

---

## B. New Architecture: Decoupled Queue & Worker Model

PRISM now executes long-running investigation work via a decoupled, durable database-backed queue with asynchronous background workers:

```text
HTTP / API Request
        ↓
Authenticate & Enforce Tenant Isolation (P0-01 / P0-02)
        ↓
Create Investigation / Job Record (DRAFT / QUEUED)
        ↓
Persist Job & Optional Idempotency Key in SQLite
        ↓
HTTP 202 Accepted Returned Immediately
        ↓
Background Worker Pool (JobWorker)
        ↓
Atomic Transactional Claim (ORDER BY Priority, Scheduled At)
        ↓
Update Job to RUNNING + Begin Periodic Lease Heartbeats
        ↓
Execute Investigation Handler / Checkpoint Progress
        ↓
Evaluate Hypotheses / Checkpoint Progress
        ↓
Synthesize Root Causes & Blast Radius / Checkpoint Progress
        ↓
Persist Results + Mark Job SUCCEEDED (or RETRYING / DEAD_LETTER on failure)
        ↓
Client Polls GET /api/v1/jobs/:id (Tenant-Scoped)
```

---

## C. Job Data Model & Schema (Migration 006)

Implemented in `src/db/schema.sql` and `src/db/database.js`:

### 1. `jobs` Table
```sql
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    investigation_id TEXT REFERENCES investigations(id) ON DELETE CASCADE,
    type TEXT NOT NULL, -- INVESTIGATION, REPORT_GENERATION, EVIDENCE_COLLECTION, HYPOTHESIS_EVALUATION
    status TEXT NOT NULL DEFAULT 'QUEUED', -- QUEUED, RUNNING, SUCCEEDED, FAILED, RETRYING, CANCELLED, BLOCKED, DEAD_LETTER
    priority TEXT NOT NULL DEFAULT 'NORMAL', -- HIGH, NORMAL, LOW
    payload TEXT NOT NULL DEFAULT '{}',
    result TEXT,
    error_code TEXT,
    error_message TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    scheduled_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    heartbeat_at TEXT,
    worker_id TEXT,
    idempotency_key TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

### 2. `job_checkpoints` Table
```sql
CREATE TABLE IF NOT EXISTS job_checkpoints (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    checkpoint_type TEXT NOT NULL,
    phase TEXT NOT NULL,
    progress_pct INTEGER NOT NULL DEFAULT 0,
    state_data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
```

### 3. Queue Performance Indexes
```sql
CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs(status, scheduled_at, priority);
CREATE INDEX IF NOT EXISTS idx_jobs_org_status ON jobs(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_investigation ON jobs(investigation_id);
CREATE INDEX IF NOT EXISTS idx_jobs_heartbeat ON jobs(status, heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_jobs_idempotency ON jobs(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_job_checkpoints_job ON job_checkpoints(job_id, created_at);
```

---

## D. Queue Semantics & Core Mechanics

### 1. Transactional Atomic Claiming
Workers claim jobs inside an explicit transaction:
```sql
SELECT id FROM jobs
WHERE (status = 'QUEUED' OR (status = 'RETRYING' AND scheduled_at <= :now))
ORDER BY 
  CASE priority WHEN 'HIGH' THEN 3 WHEN 'NORMAL' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END DESC,
  scheduled_at ASC,
  created_at ASC
LIMIT :batchSize;
```
For each candidate job, SQLite executes an atomic update:
```sql
UPDATE jobs
SET status = 'RUNNING', worker_id = :workerId, started_at = COALESCE(started_at, :now),
    heartbeat_at = :now, attempt_count = attempt_count + 1, updated_at = :now
WHERE id = :candidateId AND (status = 'QUEUED' OR status = 'RETRYING');
```
If two workers compete for the same job simultaneously, SQLite's atomic write locks ensure exactly one worker successfully increments changes; the second worker receives zero rows and skips to the next eligible job.

### 2. Bounded Retries & Exponential Backoff with Jitter
- **Retryable Failures** (`TIMEOUT`, `RESOURCE_LIMIT`, `DEPENDENCY_ERROR`, `TRANSIENT_ERROR`): Job status transitions to `RETRYING`. `scheduled_at` is pushed forward using exponential backoff:
  $$\text{Delay} = \min(\text{maxDelay}, 2^{\text{attempt}-1} \times \text{baseDelay}) + \text{jitter}$$
- **Non-Retryable Failures** (`VALIDATION_ERROR`, `AUTHORIZATION_ERROR`, `CANCELLED`): Job status transitions immediately to `FAILED` without retrying.

### 3. Dead-Letter Queue
When a retryable job reaches its configured maximum attempts (`attempt_count >= max_attempts`), it transitions to `DEAD_LETTER`. The failure reason and last worker ID are preserved for administrative inspection.

### 4. Lease Heartbeats & Dead-Worker Recovery
While processing a job, the worker periodically touches `heartbeat_at`. If a worker crashes ungracefully, a background stale-job sweep detects jobs in `RUNNING` state where `heartbeat_at < (now - staleThresholdMs)` and recovers them to `RETRYING` or `DEAD_LETTER`.

---

## E. Worker Lifecycle Architecture (`JobWorker`)

1. **`STARTING`**: Initializes worker ID, verifies handlers, connects to queue.
2. **`RUNNING`**: Runs non-blocking polling loop (`pollIntervalMs = 500ms`), claims jobs up to `concurrency` limit (default 2), executes handler, and updates lease heartbeats every 5 seconds.
3. **`STOPPING`**: Initiated via `worker.stop()` or POSIX signals (`SIGTERM`/`SIGINT`). Rejects any new claims, signals running jobs to cancel gracefully, and waits up to `graceTimeoutMs` for in-flight jobs to complete cleanly.
4. **`STOPPED`**: All timers cleared, no jobs stranded.

---

## F. Idempotency & Checkpoint/Resume

### 1. Idempotency Keys
Clients can submit `idempotency_key` (e.g. webhook delivery ID or client UUID). If an existing job with that key exists for the organization, the queue returns the existing job record without re-inserting or re-executing.

### 2. Checkpoint Persistence
Investigation execution writes durable checkpoints into `job_checkpoints` at each lifecycle stage:
- `SCOPING` (20%)
- `EVIDENCE_COLLECTION` (40%)
- `HYPOTHESIS_GENERATION` (65%)
- `ROOT_CAUSE_REVIEW` (85%)
- `COMPLETED` (100%)

When a recovered or retried job resumes, the handler reads existing checkpoints and skips already-completed phases, avoiding duplicated side effects or redundant database writes.

---

## G. Investigation Integration Proof

Investigation workflow execution is connected through the worker:
1. `POST /api/v1/investigations/:id/execute` creates a job of type `INVESTIGATION`.
2. The worker claims the job, evaluates evidence gaps, validates hypotheses, calibrates confidence scores, and updates `investigations.status` incrementally.
3. Full checkpoint trail is persisted in `job_checkpoints`.
4. Client polls `GET /api/v1/jobs/:id` and observes progression from `QUEUED` to `RUNNING` to `SUCCEEDED`.

---

## H. REST API Specification

| Method | Path | Auth | Roles | Description |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/jobs` | Bearer Token | `MEMBER`, `ADMIN`, `OWNER` | Enqueues a job; returns `202 Accepted` with job metadata. |
| `GET` | `/api/v1/jobs/:id` | Bearer Token | All (Tenant-Scoped) | Returns job details, attempt count, progress, and checkpoints. Returns 404 for cross-tenant IDs. |
| `GET` | `/api/v1/jobs` | Bearer Token | All (Tenant-Scoped) | Lists organization jobs with optional filters (`status`, `type`, `investigationId`). |
| `POST` | `/api/v1/jobs/:id/cancel` | Bearer Token | `MEMBER`, `ADMIN`, `OWNER` | Cooperatively cancels an active or queued job. |
| `POST` | `/api/v1/investigations/:id/execute` | Bearer Token | `MEMBER`, `ADMIN`, `OWNER` | Asynchronously executes investigation workflow; returns `202 Accepted`. |
| `POST` | `/api/v1/investigations?async=true` | Bearer Token | `MEMBER`, `ADMIN`, `OWNER` | Creates investigation and enqueues background job; returns `202 Accepted`. |

---

## I. Security & Tenant Isolation Audit

1. **Organization ID Injection**: `organization_id` is strictly extracted from `req.organization.id` (set by verified bearer session). Client payload values cannot override tenant ownership.
2. **Anti-IDOR Protection**: `GET /api/v1/jobs/:id` and `POST /api/v1/jobs/:id/cancel` enforce `WHERE id = ? AND organization_id = ?`. Inquiries for cross-tenant jobs yield `404 NOT_FOUND` to prevent resource enumeration.
3. **Cross-Tenant Entity Validation**: Referencing an `investigation_id` or `project_id` belonging to another organization is rejected with `404 NOT_FOUND` or `403 FORBIDDEN`.
4. **Credential Redaction**: Error payloads and audit trails never log bearer tokens, secrets, or raw passwords.

---

## J. Test Execution Results (`npm test`)

```text
=====================================================
🧪 PRISM PLATFORM MASTER TEST SUITE EXECUTION
=====================================================

Running PRISM State Machine Tests...
✔ All State Machine Tests Passed! (8 tests)

Running PRISM Evidence Engine Tests...
✔ All Evidence Engine Tests Passed! (6 tests)

Running PRISM Verification Engine Tests...
✔ All Verification Engine Tests Passed! (5 tests)

Running PRISM Intelligence Engine Tests...
✔ All Intelligence Engine Tests Passed! (2 tests)

Running PRISM Decision & Blast Radius Tests...
✔ All Decision Engine Tests Passed! (2 tests)

Running PRISM Memory Engine Tests...
✔ All Memory Engine Tests Passed! (2 tests)

Running PRISM Authentication & Session Tests...
✔ All Authentication Tests Passed! (9 tests)

Running PRISM Multi-Tenant Isolation & IDOR Tests...
✔ All Multi-Tenant Isolation Tests Passed! (15 tests)

Running PRISM Header Spoofing & Tampering Tests...
✔ All Header Spoofing Tests Passed! (5 tests)

Running PRISM RBAC Authorization Tests...
✔ All RBAC Authorization Tests Passed! (9 tests)

Running PRISM Inbound Webhook Security Tests (P0-03)...
✔ All Webhook Security Tests Passed! (23 tests)

Running PRISM Schema Normalization & Index Tests (P0-04)...
✔ All Schema Normalization Tests Passed! (13 tests)

Running PRISM Async Job Queue & Worker Tests (P1-01)...
Test 1: Enqueue validation and tenant requirement
  ✔ Enqueue validation & tenant scoping enforced
Test 2: Atomic concurrent claiming (two workers competing)
  ✔ Atomic claiming verified: zero double-claim on concurrent workers
Test 3: Priority ordering (HIGH before NORMAL before LOW)
  ✔ Priority scheduling verified (HIGH -> NORMAL -> LOW)
Test 4: Bounded retries with exponential backoff on transient failure
  ✔ Transient failure correctly scheduled for bounded retry
Test 5: Transition to DEAD_LETTER when max attempts exceeded
  ✔ Dead-letter transition verified upon reaching max attempts
Test 6: Permanent validation errors fail immediately
  ✔ Non-retryable permanent error terminated immediately
Test 7: Idempotency key deduplication
  ✔ Idempotency key deduplication confirmed
Test 8: Lease heartbeat & stale job recovery after worker crash
  ✔ Stale job recovery verified for dead workers
Test 9: Execution checkpoints & resumability
  ✔ Incremental checkpoints recorded & retrieved in order
Test 10: Cooperative job cancellation
  ✔ Cooperative cancellation verified
Test 11: Multi-tenant job isolation
  ✔ Server-side tenant isolation strictly enforced on jobs
Test 12: End-to-end investigation execution with JobWorker
  ✔ End-to-end investigation worker execution succeeded with full checkpoint trail
Test 13: Worker lifecycle transitions & graceful shutdown
  ✔ Worker graceful shutdown verified
Test 14: HTTP API: POST /api/v1/jobs returns 202 Accepted with tenant isolation
  ✔ POST /api/v1/jobs returns 202 Accepted and safely bounds to authenticated tenant
Test 15: HTTP API: GET /api/v1/jobs/:id (anti-IDOR enforcement)
  ✔ GET /api/v1/jobs/:id strictly blocks cross-tenant access with 404
Test 16: HTTP API: GET /api/v1/jobs list tenant filtering
  ✔ GET /api/v1/jobs lists only authenticated tenant jobs
Test 17: HTTP API: POST /api/v1/jobs/:id/cancel
  ✔ POST /api/v1/jobs/:id/cancel securely cancels with tenant authorization
Test 18: HTTP API: POST /api/v1/investigations/:id/execute
  ✔ POST /api/v1/investigations/:id/execute returns 202 Accepted with queued job
Test 19: HTTP API: POST /api/v1/investigations?async=true
  ✔ POST /api/v1/investigations?async=true returns 202 Accepted with investigation + job
✔ All Job Queue Tests Passed! (19 tests)

=====================================================
🎉 ALL PRISM SUITES PASSED SUCCESSFULLY! (100% GREEN)
📊 Domain & Architecture Tests: 57 passed
🛡️ Security & Isolation Tests: 61 passed
📈 Grand Total: 118 tests passed, 0 failed, 0 skipped
=====================================================
```

---

## K. Architectural Limitations & Production Path

1. **Storage Backend**: The queue is currently backed by SQLite using WAL mode and transactional atomic updates. This provides zero-native-dependency deployment and strong durability for single-node installations.
2. **Horizontal Worker Scaling**: While multiple worker instances within the same Node process or across processes on the same host can safely claim jobs, multi-node clustered deployments will benefit from transitioning the `JobQueue` adapter to Redis Streams or SQS (P2 roadmap). The `JobQueue` abstraction cleanly encapsulates all SQL queries, making provider migration transparent to the investigation engines.

---

## L. Roadmap Verification & Critical Path Update

- **P0-01 Authentication & Sessions**: COMPLETE & VERIFIED
- **P0-02 Multi-Tenant Isolation**: COMPLETE & VERIFIED
- **P0-03 Inbound Webhook Cryptographic Verification**: COMPLETE & VERIFIED
- **P0-04 Database Schema Normalization & Indexing**: COMPLETE & VERIFIED
- **P1-01 Asynchronous Job Queue & Background Worker Architecture**: **COMPLETE & VERIFIED**

The next task on the verified critical path is:
> **P1-02 — Repository Ingestion, Git Adapter Hardening & File Tree Indexing**  
> (Deterministic repository cloning, file tree parsing, and immutable diff ingestion into the evidence vault outside HTTP request cycles).
