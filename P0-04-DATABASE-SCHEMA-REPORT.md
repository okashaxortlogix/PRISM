# PRISM — P0-04 Database Schema Normalization & Indexing Report

**Audit & Implementation Date**: September 16, 2026  
**Auditor & Implementation Engineer**: Antigravity Autonomous Database Engineer  
**Scope**: SQLite Relational Normalization, Join Tables, Foreign-Key Cascades, B-Tree & Composite Indexing, Query Plan Verification, and Migration Engine (`src/db/schema.sql`, `src/db/database.js`, `src/api/routes/hypotheses.js`, `src/api/routes/memories.js`, `src/api/routes/rootCauses.js`, `tests/database/schemaNormalization.test.js`)  
**Status**: **100% VERIFIED & PASSING (13/13 Schema Checks, 99/99 Total PRISM Suite Tests)**

---

## 1. Executive Summary

Prior to P0-04, PRISM stored relational entity links inside denormalized JSON text strings (e.g. `hypotheses.supporting_evidence_ids`, `memories.tags`, `root_causes.supporting_evidence`). This violated relational integrity:
- Foreign keys could not be enforced at the database level.
- Deleting an evidence record left orphaned ID strings in JSON arrays.
- Queries required in-memory JSON parsing and array scans rather than relational SQL joins.
- Zero explicit B-tree indexes existed beyond primary keys and email uniqueness, forcing table scans on key foreign-key filters.

**P0-04 successfully eliminates these anti-patterns**:
1. **Relational Join Tables**: Created `hypothesis_evidence`, `memory_tags`, and `root_cause_evidence` with foreign-key cascades and composite uniqueness constraints.
2. **Versioned Migration Runner**: Replaced ad-hoc schema initialization with an ordered, transactional, idempotent migration runner tracking applied versions in `schema_migrations`.
3. **Data Backfill**: Existing serialized array data in `prism.db` was safely and idempotently migrated into the normalized relational tables.
4. **Comprehensive B-Tree Indexing**: Created 16 targeted single-column and composite B-tree indexes matching PRISM's query patterns.
5. **Query Plan Verification**: SQLite `EXPLAIN QUERY PLAN` confirmed that all core lookups use index searches (`SEARCH ... USING INDEX`).
6. **Zero API Regressions**: API route serialization layers populate backward-compatible array fields from the relational source of truth, maintaining 100% compatibility across all 86 previous tests and adding 13 new database integrity tests (99 total tests passing).

---

## 2. Relational Normalization Details

### 2.1 Hypothesis ↔ Evidence Join Table (`hypothesis_evidence`)
```sql
CREATE TABLE IF NOT EXISTS hypothesis_evidence (
    id TEXT PRIMARY KEY,
    hypothesis_id TEXT NOT NULL,
    evidence_id TEXT NOT NULL,
    relationship_type TEXT NOT NULL DEFAULT 'SUPPORTS', -- 'SUPPORTS', 'CONTRADICTS'
    created_at TEXT NOT NULL,
    UNIQUE(hypothesis_id, evidence_id),
    FOREIGN KEY(hypothesis_id) REFERENCES hypotheses(id) ON DELETE CASCADE,
    FOREIGN KEY(evidence_id) REFERENCES evidence(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_hyp_evi_hypothesis ON hypothesis_evidence(hypothesis_id);
CREATE INDEX IF NOT EXISTS idx_hyp_evi_evidence ON hypothesis_evidence(evidence_id);
CREATE INDEX IF NOT EXISTS idx_hyp_evi_rel ON hypothesis_evidence(hypothesis_id, relationship_type);
```
- **Composite Uniqueness**: `UNIQUE(hypothesis_id, evidence_id)` prevents duplicate evidence associations.
- **Foreign Key Cascades**: Deleting a hypothesis or evidence record automatically purges orphaned join rows.

### 2.2 Memory Tags Table (`memory_tags`)
```sql
CREATE TABLE IF NOT EXISTS memory_tags (
    id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(memory_id, tag),
    FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_memory_tags_memory ON memory_tags(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_tags_tag ON memory_tags(tag);
```
- **Search Optimization**: Queries can now filter by tag directly via `JOIN memory_tags mt ON mt.memory_id = memories.id WHERE mt.tag = ?`.

### 2.3 Root Cause ↔ Evidence Join Table (`root_cause_evidence`)
```sql
CREATE TABLE IF NOT EXISTS root_cause_evidence (
    id TEXT PRIMARY KEY,
    root_cause_id TEXT NOT NULL,
    evidence_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(root_cause_id, evidence_id),
    FOREIGN KEY(root_cause_id) REFERENCES root_causes(id) ON DELETE CASCADE,
    FOREIGN KEY(evidence_id) REFERENCES evidence(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rc_evi_root_cause ON root_cause_evidence(root_cause_id);
CREATE INDEX IF NOT EXISTS idx_rc_evi_evidence ON root_cause_evidence(evidence_id);
```

### 2.4 Investigation Scope Decision (`investigations.scope`)
- **Classification**: **STRUCTURED_CONFIGURATION / INCIDENT_METADATA**.
- **Rationale**: `scope` stores dynamic incident boundaries (e.g. `{"services": ["checkout-api", "redis"], "region": "us-east-1", "environment": "production"}` and PagerDuty alert scope details). It does not represent fixed foreign-key relations to an entity table. Normalizing it into rigid relational tables would degrade flexibility without integrity gains. Retained as validated JSON metadata in accordance with Section 3 of the prompt.

---

## 3. Versioned Migration Engine

Implemented in `src/db/database.js`:
- **Tracking Table**: `schema_migrations (version INTEGER PRIMARY KEY, name TEXT, executed_at TEXT)`.
- **Transactional Execution**: Each migration runs in an isolated `BEGIN TRANSACTION ... COMMIT` block with automatic `ROLLBACK` on error.
- **Idempotency**: Checked against applied versions set before execution; safe on restarts.
- **Connection Pragmas**: Every connection enforces `PRAGMA foreign_keys = ON;` and `PRAGMA journal_mode = WAL;`.

### Migration History:
- `001_base_schema`: Base DDL setup from `schema.sql`.
- `002_organizations_and_users`: Slug generation, system organizations, and user credentials.
- `003_memberships_and_sessions`: RBAC organization memberships and stateful session management.
- `004_integrations_and_webhooks`: Inbound integration secrets and delivery deduplication.
- `005_schema_normalization_and_indexing`: Normalized join tables, B-tree indexes, and data backfill for hypotheses, memories, and root causes.

---

## 4. Query Execution Plan Verification (`EXPLAIN QUERY PLAN`)

Using SQLite `EXPLAIN QUERY PLAN`, all critical entity lookups were verified to execute using indexes:

| Query Type | Query Statement | SQLite Plan Output | Verification |
|---|---|---|---|
| **Investigation Filtering** | `SELECT * FROM investigations WHERE project_id = ? AND status = ?` | `SEARCH investigations USING INDEX idx_investigations_proj_status (project_id=? AND status=?)` | **INDEXED** |
| **Evidence Ordering** | `SELECT * FROM evidence WHERE investigation_id = ? ORDER BY collected_at ASC` | `SEARCH evidence USING INDEX idx_evidence_inv_collected (investigation_id=?)` | **INDEXED** |
| **Hypothesis Evidence Join**| `SELECT * FROM hypothesis_evidence WHERE hypothesis_id = ?` | `SEARCH hypothesis_evidence USING INDEX idx_hyp_evi_rel (hypothesis_id=?)` | **INDEXED** |
| **Memory Tag Lookup** | `SELECT * FROM memory_tags WHERE tag = ?` | `SEARCH memory_tags USING INDEX idx_memory_tags_tag (tag=?)` | **INDEXED** |
| **Audit Log Pagination** | `SELECT * FROM audit_events WHERE organization_id = ? ORDER BY created_at DESC`| `SEARCH audit_events USING INDEX idx_audit_org_created (organization_id=?)` | **INDEXED** |

---

## 5. Automated Test Suite Results

The dedicated schema test suite (`tests/database/schemaNormalization.test.js`) ran 13 checks:

```text
=====================================================
🏛️ RUNNING PRISM SCHEMA NORMALIZATION & INDEX TESTS (P0-04)
=====================================================
Test 1: SQLite PRAGMA foreign_keys is active
  ✔ Foreign keys enforcement active
Test 2: SQLite PRAGMA journal_mode is WAL
  ✔ WAL journal mode confirmed
Test 3: Invalid foreign key in hypothesis_evidence is rejected
  ✔ Foreign key violation rejected for hypothesis_evidence
Test 4: Invalid foreign key in memory_tags is rejected
  ✔ Foreign key violation rejected for memory_tags
Test 5: Composite unique constraint on hypothesis_evidence prevents duplicates
  ✔ Composite uniqueness strictly enforced on hypothesis_evidence
Test 6: Cascade deletion on hypothesis_evidence when hypothesis is deleted
  ✔ Cascade delete verified: orphaned join rows automatically purged
Test 7: Schema migrations tracking table exists and recorded migrations
  ✔ Schema migration tracking verified
Test 8: Re-running migrations is completely idempotent
  ✔ Migration engine idempotency confirmed
Test 9: EXPLAIN QUERY PLAN verifies B-tree index usage
  ✔ Query plan: investigations lookup uses index (SEARCH investigations USING INDEX idx_investigations_proj_status)
  ✔ Query plan: evidence lookup uses index (SEARCH evidence USING INDEX idx_evidence_inv_collected)
  ✔ Query plan: hypothesis_evidence lookup uses index (SEARCH hypothesis_evidence USING INDEX idx_hyp_evi_rel)
  ✔ Query plan: memory_tags lookup uses index (SEARCH memory_tags USING INDEX idx_memory_tags_tag)
  ✔ Query plan: audit_events lookup uses index (SEARCH audit_events USING INDEX idx_audit_org_created)
Test 10: Authenticated User retrieves hypotheses with relationally populated evidence arrays
  ✔ Hypotheses API correctly reconstructs evidence arrays from relational table
Test 11: Memories API with relational tag filtering (tag=redis)
  ✔ Memories API relational tag filtering and array serialization verified
Test 12: Tenant Alpha cannot create hypothesis citing Tenant Beta evidence
  ✔ Cross-tenant evidence check validated
Test 13: Tenant Alpha tag search does not leak Tenant Beta memories
  ✔ Relational tag queries respect organization tenant boundaries

✔ ALL SCHEMA NORMALIZATION & INDEX TESTS PASSED (100% GREEN - 13/13 CHECKS)
```

### Full PRISM Platform Master Suite Status:
- **Domain & State Machine Tests**: 38 passed
- **Security, Auth, RBAC & Webhooks**: 61 passed
- **Grand Total**: **99 passed, 0 failed, 0 skipped (100% GREEN)**
