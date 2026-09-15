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
| **4** | **Job Queue & Workers (P1-01)** | Step 3 | Synchronous Express requests block long-running repo clones and AI reasoning. | **NEXT (P1-01)** |
| **5** | **Repository Ingestion (P1-03)** | Step 3, Step 4 | Lack of AST/symbol parsing blocks AI from understanding project architecture. | Blocked on P1-01 |
| **6** | **AI Reasoning Engine (P1-02)** | Step 5 | Lack of LLM gateway blocks autonomous hypothesis generation and contradiction detection. | Blocked on P1-03 |
| **7** | **Verification Sandbox (P1-04)** | Step 4, Step 6 | Fake string generator blocks empirical proof; creates risk of false-positive root causes. | Blocked on P1-02 |
| **8** | **Root Cause & Decisions**| Step 7 | Cannot synthesize verified root cause without real empirical verification. | Blocked on P1-04 |
| **9** | **Memory Bank (P2-01)** | Step 8 | Keyword substring matching blocks semantic cross-investigation retrieval. | Blocked on P1-02 |
| **10**| **Production Hardening** | All preceding | Missing rate limiting, CSRF, and backups block production hosting. | Blocked |

---

## 3. The Next Recommended Step on the Critical Path

With all P0 Foundation Tasks (**P0-01 Auth & Sessions**, **P0-02 Multi-Tenant Isolation**, **P0-03 Inbound Webhook Cryptographic Verification**, and **P0-04 Database Schema Normalization & Indexing**) 100% completed and verified:
> **Next Recommended Step**: **Task P1-01: Asynchronous Job Queue & Worker Architecture** (implementing SQLite-backed queue workers for background ingestion, indexing, and reasoning tasks).

