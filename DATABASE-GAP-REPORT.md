# PRISM — Database Gap Report & Forensic Schema Audit

**Audit Date**: September 16, 2026  
**Target File**: `prism-platform/src/db/schema.sql` & `prism-platform/src/db/database.js`  
**Specification Reference**: `04-DATA/DATABASE-SCHEMA.md`, `04-DATA/ERD.md`, `04-DATA/DATA-DICTIONARY.md`

---

## 1. ERD Entity to Actual Schema Comparison

| ERD Entity | Actual DB Table | Status | Schema Gaps & Discrepancies |
|---|---|---|---|
| **Organization** | `organizations` | **Present** | Missing `billing_tier`, `tenant_settings`, `data_retention_days`, `slug`. |
| **User** | `users` | **Present** | Missing password hash/salt, MFA secret, session tokens, last_login_at. |
| **Project** | `projects` | **Present** | Missing repository associations counter, retention overrides, archive status. |
| **Repository** | `repositories` | **Present** | Missing `indexed_commit_sha`, `ast_cache_ref`, `ingestion_status`, `webhook_secret`. |
| **Investigation** | `investigations` | **Present** | Missing `closed_at`, `closed_by`, `lock_version` (for optimistic concurrency), `parent_investigation_id`. |
| **Evidence** | `evidence` | **Present** | Missing `version`, `digital_signature`, `content_mime_type`, `environment` (prod/staging), `redacted_fields`. |
| **Hypothesis** | `hypotheses` | **Present** | Uses JSON arrays in TEXT column for evidence references instead of normalized join tables (`hypothesis_evidence`). |
| **Experiment** | `experiments` | **Present** | Missing `container_image`, `cpu_limit`, `memory_limit`, `network_policy`, `execution_sandbox_id`. |
| **Verification** | `verifications` | **Present** | Outcome column constraint in SQL does not enforce `REFUTED`, `BLOCKED`, `FAILED` per Data Dictionary. |
| **RootCause** | `root_causes` | **Present** | Missing `causal_graph_json`, `falsification_conditions`, `alternate_causes_rejected`. |
| **ImpactAssessment** | `impact_assessments` | **Present** | Stored as JSON strings in TEXT; missing structured blast radius metrics and revenue impact precision. |
| **Recommendation** | `recommendations` | **Present** | Missing `status` (ACCEPTED, REJECTED, IN_PROGRESS, IMPLEMENTED), `assignee_id`, `pr_url`. |
| **Decision** | *(None)* | **MISSING** | Defined in `04-DATA/ERD.md` (Entity 15), but **completely absent** from `schema.sql`. |
| **Report** | *(None)* | **MISSING** | Defined in `04-DATA/ERD.md` (Entity 16), but **completely absent** from `schema.sql`. Reports are generated ephemerally. |
| **Memory** | `memories` | **Present** | Missing `embedding` (vector BLOB/JSON), `invalidation_reason`, `superseded_by_id`, `project_scope`. |
| **AuditEvent** | `audit_events` | **Present** | Missing `ip_address`, `user_agent`, `prev_state_hash`, `new_state_hash` (cryptographic chain). |
| **Integration** | *(None)* | **MISSING** | Defined in `04-DATA/ERD.md` (Entity 19); currently hardcoded in router; no credentials/config table. |
| **Job** | *(None)* | **MISSING** | Defined in `04-DATA/ERD.md` (Entity 20); background job execution tracking table is **completely absent**. |

---

## 2. Indexes & Performance Status (P0-04 RESOLVED)

Comprehensive B-Tree and composite indexes have been implemented and verified via SQLite `EXPLAIN QUERY PLAN`:
1. **`evidence(investigation_id, collected_at)`**: Verified index search on evidence timeline loading.
2. **`hypotheses(investigation_id, status)`**: Verified index search on hypothesis lookups.
3. **`hypothesis_evidence(hypothesis_id, relationship_type)`**: Verified index search on relationship retrieval.
4. **`experiments(hypothesis_id)`**: Foreign key index active.
5. **`verifications(experiment_id, outcome)`**: Composite index active.
6. **`investigations(project_id, status)`**: Verified composite index search for dashboard filtering.
7. **`audit_events(organization_id, created_at)`**: Verified composite index search for audit log pagination.
8. **`memories(organization_id, project_id)` & `memories(organization_id, freshness_score DESC)`**: Indexes active.
9. **`memory_tags(tag)` & `memory_tags(memory_id)`**: Fast relational tag lookup and filtering.

---

## 3. Relational Normalization Status (P0-04 RESOLVED)

Denormalized foreign-key arrays have been normalized into first-class relational tables with composite uniqueness and foreign-key cascades:
- `hypothesis_evidence`: Tracks `(hypothesis_id, evidence_id, relationship_type, created_at)` with `UNIQUE(hypothesis_id, evidence_id)`.
- `memory_tags`: Tracks `(memory_id, tag, created_at)` with `UNIQUE(memory_id, tag)`.
- `root_cause_evidence`: Tracks `(root_cause_id, evidence_id, created_at)` with `UNIQUE(root_cause_id, evidence_id)`.
- `root_causes.verification_ref`: Foreign key linked to `verifications(id)`.
- `investigations.scope`: Validated structured boundary configuration retained as JSON metadata per specification.

All historical serialized array data was safely backfilled via transactional migrations.

---

## 4. Database Migration & Transaction Architecture (P0-04 RESOLVED)

1. **Deterministic Migration System**: 
   - `schema_migrations` tracking table records executed migrations (`version`, `name`, `executed_at`).
   - Ordered, idempotent migrations (001 through 005) execute in transactional blocks (`BEGIN TRANSACTION ... COMMIT`).
2. **Pragma Enforcement**:
   - `PRAGMA foreign_keys = ON;` and `PRAGMA journal_mode = WAL;` are enforced on every database connection.
3. **Transactional Mutation Integrity**:
   - Multi-step entity and join table mutations are wrapped in database transactions preventing orphaned or corrupt states.
