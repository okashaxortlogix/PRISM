-- PRISM Platform Database Schema
-- Aligned with PRISM Specification (04-DATA/DATABASE-SCHEMA.md & DATA-DICTIONARY.md)
-- Hardened with P0-01 Auth, P0-02 Multi-Tenancy, P0-03 Webhook Security, and P0-04 Schema Normalization & Indexing

-- =====================================================
-- SCHEMA MIGRATIONS TRACKING (P0-04)
-- =====================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    executed_at TEXT NOT NULL
);

-- =====================================================
-- TENANCY & IDENTITY (P0-01 / P0-02)
-- =====================================================
CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_memberships (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'MEMBER', -- OWNER, ADMIN, MEMBER, VIEWER
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(organization_id, user_id),
    FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    active_organization_id TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(active_organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS repositories (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'GITHUB',
    external_id TEXT,
    url TEXT NOT NULL,
    default_branch TEXT NOT NULL DEFAULT 'main',
    metadata TEXT DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'INGESTED',
    created_at TEXT NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- =====================================================
-- INVESTIGATION LIFECYCLE DOMAIN MODEL
-- =====================================================
CREATE TABLE IF NOT EXISTS investigations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    title TEXT NOT NULL,
    problem_statement TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    severity TEXT NOT NULL DEFAULT 'SEV2',
    scope TEXT DEFAULT '{}', -- Validated structured JSON configuration/metadata
    started_at TEXT NOT NULL,
    completed_at TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS evidence (
    id TEXT PRIMARY KEY,
    investigation_id TEXT NOT NULL,
    type TEXT NOT NULL,
    source TEXT NOT NULL,
    source_ref TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    observed_at TEXT NOT NULL,
    collected_at TEXT NOT NULL,
    reliability REAL NOT NULL DEFAULT 1.0,
    provenance TEXT NOT NULL,
    hash TEXT NOT NULL,
    FOREIGN KEY(investigation_id) REFERENCES investigations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS hypotheses (
    id TEXT PRIMARY KEY,
    investigation_id TEXT NOT NULL,
    statement TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PROPOSED',
    confidence REAL NOT NULL DEFAULT 0.5,
    rationale TEXT NOT NULL,
    supporting_evidence_ids TEXT DEFAULT '[]', -- Kept for backward compatibility; relational source is hypothesis_evidence
    conflicting_evidence_ids TEXT DEFAULT '[]', -- Kept for backward compatibility; relational source is hypothesis_evidence
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(investigation_id) REFERENCES investigations(id) ON DELETE CASCADE
);

-- Normalized Join Table: Hypotheses ↔ Evidence (P0-04)
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

CREATE TABLE IF NOT EXISTS experiments (
    id TEXT PRIMARY KEY,
    hypothesis_id TEXT NOT NULL,
    plan TEXT NOT NULL,
    permissions TEXT DEFAULT '["READ_ONLY"]',
    status TEXT NOT NULL DEFAULT 'PENDING',
    started_at TEXT,
    completed_at TEXT,
    result_ref TEXT,
    logs TEXT DEFAULT '[]',
    created_at TEXT NOT NULL,
    FOREIGN KEY(hypothesis_id) REFERENCES hypotheses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS verifications (
    id TEXT PRIMARY KEY,
    experiment_id TEXT NOT NULL,
    claim TEXT NOT NULL,
    method TEXT NOT NULL,
    expected_result TEXT NOT NULL,
    actual_result TEXT NOT NULL,
    outcome TEXT NOT NULL, -- VERIFIED, REFUTED, INCONCLUSIVE, BLOCKED, FAILED
    evidence_ref TEXT,
    performed_by TEXT NOT NULL,
    performed_at TEXT NOT NULL,
    limitations TEXT,
    FOREIGN KEY(experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS root_causes (
    id TEXT PRIMARY KEY,
    investigation_id TEXT NOT NULL,
    statement TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.9,
    supporting_evidence TEXT NOT NULL, -- Kept for backward compatibility; relational source is root_cause_evidence
    verification_ref TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(investigation_id) REFERENCES investigations(id) ON DELETE CASCADE,
    FOREIGN KEY(verification_ref) REFERENCES verifications(id) ON DELETE RESTRICT
);

-- Normalized Join Table: Root Cause ↔ Evidence (P0-04)
CREATE TABLE IF NOT EXISTS root_cause_evidence (
    id TEXT PRIMARY KEY,
    root_cause_id TEXT NOT NULL,
    evidence_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(root_cause_id, evidence_id),
    FOREIGN KEY(root_cause_id) REFERENCES root_causes(id) ON DELETE CASCADE,
    FOREIGN KEY(evidence_id) REFERENCES evidence(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS impact_assessments (
    id TEXT PRIMARY KEY,
    investigation_id TEXT NOT NULL,
    affected_components TEXT NOT NULL, -- JSON array
    user_impact TEXT NOT NULL,
    data_integrity_impact TEXT NOT NULL,
    blast_radius_level TEXT NOT NULL DEFAULT 'MEDIUM',
    financial_cost_estimate TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(investigation_id) REFERENCES investigations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS recommendations (
    id TEXT PRIMARY KEY,
    investigation_id TEXT NOT NULL,
    action TEXT NOT NULL,
    rationale TEXT NOT NULL,
    tradeoffs TEXT NOT NULL,
    risk TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'P1',
    evidence_ref TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(investigation_id) REFERENCES investigations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    investigation_id TEXT,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    root_cause TEXT NOT NULL,
    resolution TEXT NOT NULL,
    tags TEXT NOT NULL, -- JSON array kept for backward compatibility; relational source is memory_tags
    freshness_score REAL NOT NULL DEFAULT 1.0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Normalized Relational Tags Table (P0-04)
CREATE TABLE IF NOT EXISTS memory_tags (
    id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(memory_id, tag),
    FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

-- =====================================================
-- INTEGRATIONS & WEBHOOK REPLAY SECURITY (P0-03)
-- =====================================================
CREATE TABLE IF NOT EXISTS integrations (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    provider TEXT NOT NULL, -- GITHUB, DATADOG, PAGERDUTY
    name TEXT NOT NULL,
    webhook_secret TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS processed_webhooks (
    id TEXT PRIMARY KEY,
    integration_id TEXT NOT NULL,
    delivery_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    processed_at TEXT NOT NULL,
    UNIQUE(integration_id, delivery_id),
    FOREIGN KEY(integration_id) REFERENCES integrations(id) ON DELETE CASCADE
);

-- =====================================================
-- PERFORMANCE B-TREE & COMPOSITE INDEXES (P0-04)
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON organization_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON organization_memberships(organization_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_projects_org_status ON projects(organization_id, status);

CREATE INDEX IF NOT EXISTS idx_investigations_project ON investigations(project_id);
CREATE INDEX IF NOT EXISTS idx_investigations_status ON investigations(status);
CREATE INDEX IF NOT EXISTS idx_investigations_proj_status ON investigations(project_id, status);
CREATE INDEX IF NOT EXISTS idx_investigations_created ON investigations(project_id, started_at);

CREATE INDEX IF NOT EXISTS idx_evidence_inv ON evidence(investigation_id);
CREATE INDEX IF NOT EXISTS idx_evidence_inv_collected ON evidence(investigation_id, collected_at);
CREATE INDEX IF NOT EXISTS idx_evidence_hash ON evidence(hash);

CREATE INDEX IF NOT EXISTS idx_hypotheses_inv ON hypotheses(investigation_id);
CREATE INDEX IF NOT EXISTS idx_hypotheses_inv_status ON hypotheses(investigation_id, status);

CREATE INDEX IF NOT EXISTS idx_hyp_evi_hypothesis ON hypothesis_evidence(hypothesis_id);
CREATE INDEX IF NOT EXISTS idx_hyp_evi_evidence ON hypothesis_evidence(evidence_id);
CREATE INDEX IF NOT EXISTS idx_hyp_evi_rel ON hypothesis_evidence(hypothesis_id, relationship_type);

CREATE INDEX IF NOT EXISTS idx_experiments_hyp ON experiments(hypothesis_id);
CREATE INDEX IF NOT EXISTS idx_verifications_exp ON verifications(experiment_id);
CREATE INDEX IF NOT EXISTS idx_verifications_exp_outcome ON verifications(experiment_id, outcome);

CREATE INDEX IF NOT EXISTS idx_root_causes_inv ON root_causes(investigation_id);
CREATE INDEX IF NOT EXISTS idx_root_causes_ver ON root_causes(verification_ref);
CREATE INDEX IF NOT EXISTS idx_rc_evi_root_cause ON root_cause_evidence(root_cause_id);
CREATE INDEX IF NOT EXISTS idx_rc_evi_evidence ON root_cause_evidence(evidence_id);

CREATE INDEX IF NOT EXISTS idx_recommendations_inv ON recommendations(investigation_id);

CREATE INDEX IF NOT EXISTS idx_memories_org ON memories(organization_id);
CREATE INDEX IF NOT EXISTS idx_memories_org_proj ON memories(organization_id, project_id);
CREATE INDEX IF NOT EXISTS idx_memories_freshness ON memories(organization_id, freshness_score DESC);
CREATE INDEX IF NOT EXISTS idx_memory_tags_memory ON memory_tags(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_tags_tag ON memory_tags(tag);

CREATE INDEX IF NOT EXISTS idx_audit_org_created ON audit_events(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_events(target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_integrations_org ON integrations(organization_id);
CREATE INDEX IF NOT EXISTS idx_integrations_provider ON integrations(provider);
CREATE INDEX IF NOT EXISTS idx_processed_webhooks_lookup ON processed_webhooks(integration_id, delivery_id);
