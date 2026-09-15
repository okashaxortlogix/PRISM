# PRISM — Implementation Critical Path & Dependency Architecture

**Audit Date**: September 16, 2026  
**Purpose**: Map the strict technical dependency sequence required to achieve production release without architectural rework.

---

## 1. The PRISM Critical Path Sequence

Every layer in PRISM depends upon the integrity of the layer beneath it. Attempting to build higher-order intelligence without lower-order persistence and isolation leads directly to false completion.

```text
[PHASE 00] Core Data Contracts & Security Boundary
  ↓
[PHASE 01] Multi-Tenant Persistence, Auth & Migration Engine
  ↓
[PHASE 01b] Asynchronous Job Queue & Worker Infrastructure
  ↓
[PHASE 02] Repository Ingestion, AST Parsing & Symbol Graphs
  ↓
[PHASE 03] Evidence Normalization, Provenance & Ingestion Adapters
  ↓
[PHASE 04] AI Gateway, Context Budgeting & Competing Hypotheses
  ↓
[PHASE 05] Isolated Sandbox Execution & Verification Engine
  ↓
[PHASE 06] Root Cause Synthesis, Blast Radius & Recommendations
  ↓
[PHASE 07] Vector Embeddings & Incident Memory Bank
  ↓
[PHASE 08] Security Red-Teaming, Rate Limiting & SRE Hardening
  ↓
[PHASE 09] Golden Incident Evaluation & Accuracy Benchmarking
  ↓
[PHASE 10] Production Deployment & GA Launch
```

---

## 2. Phase-by-Phase Blockers & Dependencies

| Step | Component | Prerequisites / Dependencies | Immediate Blockers in Current Codebase | Status |
|---|---|---|---|---|
| **1** | **Auth & Multi-Tenancy (P0-01 / P0-02)** | None | Resolved: scrypt hashing, stateful sessions, RBAC, tenant isolation | **COMPLETED & VERIFIED** |
| **2** | **Inbound Webhook Verification (P0-03)** | Step 1 | Resolved: GitHub/Datadog/PagerDuty cryptographic HMAC & token checks, replay deduplication, tenant secrets | **COMPLETED & VERIFIED** |
| **3** | **Database Schema Normalization & Indexing (P0-04)** | Step 1, Step 2 | Resolved: hypothesis_evidence, memory_tags, root_cause_evidence, B-tree/composite indexes, query plans | **COMPLETED & VERIFIED** |
| **4** | **Job Queue & Workers (P1-01)** | Step 3 | Resolved: durable SQLite queue, atomic transactional claim, lease heartbeats, bounded retries, checkpoints | **COMPLETED & VERIFIED** |
| **5** | **Repository Ingestion & Git Hardening (P1-02)** | Step 4 | Lack of AST/symbol parsing and secure repo ingestion outside HTTP request loops. | **NEXT (P1-02)** |
| **6** | **AI Reasoning Engine (P1-03)** | Step 5 | Lack of LLM gateway blocks autonomous hypothesis generation and contradiction detection. | Blocked on P1-02 |
| **7** | **Verification Sandbox (P1-04)** | Step 4, Step 6 | Fake string generator blocks empirical proof; creates risk of false-positive root causes. | Blocked on P1-03 |
| **8** | **Root Cause & Decisions**| Step 7 | Cannot synthesize verified root cause without real empirical verification. | Blocked on P1-04 |
| **9** | **Memory Bank (P2-01)** | Step 8 | Keyword substring matching blocks semantic cross-investigation retrieval. | Blocked on P1-03 |
| **10**| **Production Hardening** | All preceding | Missing rate limiting, CSRF, and backups block production hosting. | Blocked |

---

## 3. The Next Recommended Step on the Critical Path

With **P1-01 Asynchronous Job Queue & Background Worker Architecture** 100% completed and verified:
> **Next Recommended Step**: **Task P1-02: Repository Ingestion, Git Adapter Hardening & File Tree Indexing** (deterministic repository cloning, file tree parsing, and immutable diff ingestion into the evidence vault outside HTTP request cycles).

