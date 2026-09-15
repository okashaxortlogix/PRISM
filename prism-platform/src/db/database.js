// PRISM Database Management using Node 24 native DatabaseSync
// Hardened with P0-01 Auth, P0-02 Tenancy, P0-03 Webhook Security, and P0-04 Schema Normalization & Indexing
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

let dbInstance = null;

/**
 * Migration 001: Base Schema
 */
function migration001(db) {
  const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schemaSql);
}

/**
 * Migration 002: Organizations Slug & System Org Fixtures
 */
function migration002(db) {
  const orgColumns = db.prepare('PRAGMA table_info(organizations)').all().map(c => c.name);
  if (!orgColumns.includes('slug')) {
    db.exec("ALTER TABLE organizations ADD COLUMN slug TEXT NOT NULL DEFAULT 'default-workspace'");
    db.exec("UPDATE organizations SET slug = lower(replace(name, ' ', '-')) || '-' || substr(id, 5, 4)");
  }

  // Ensure system organization and alias exist for system audit logging
  db.prepare(`
    INSERT OR IGNORE INTO organizations (id, name, slug, status, created_at, updated_at)
    VALUES ('system', 'PRISM System Organization', 'prism-system', 'ACTIVE', datetime('now'), datetime('now'))
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO organizations (id, name, slug, status, created_at, updated_at)
    VALUES ('org_system', 'PRISM System Organization Alias', 'prism-system-alias', 'ACTIVE', datetime('now'), datetime('now'))
  `).run();

  // User columns schema migration
  const userTableInfo = db.prepare('PRAGMA table_info(users)').all();
  const userColumns = userTableInfo.map(c => c.name);

  if (userColumns.includes('organization_id')) {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec(`
      CREATE TABLE users_migrated (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL DEFAULT '',
        display_name TEXT NOT NULL DEFAULT 'User',
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.exec(`
      INSERT OR IGNORE INTO users_migrated (id, email, password_hash, display_name, status, created_at, updated_at)
      SELECT 
        id, 
        email, 
        COALESCE(password_hash, ''), 
        COALESCE(display_name, COALESCE(name, 'User')), 
        COALESCE(status, 'ACTIVE'), 
        created_at, 
        COALESCE(updated_at, created_at)
      FROM users;
    `);
    db.exec('DROP TABLE users;');
    db.exec('ALTER TABLE users_migrated RENAME TO users;');
    db.exec('PRAGMA foreign_keys = ON;');
  } else {
    if (!userColumns.includes('password_hash')) {
      db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT DEFAULT ''");
    }
    if (!userColumns.includes('display_name')) {
      db.exec("ALTER TABLE users ADD COLUMN display_name TEXT DEFAULT 'User'");
    }
    if (!userColumns.includes('updated_at')) {
      db.exec("ALTER TABLE users ADD COLUMN updated_at TEXT DEFAULT ''");
      db.exec("UPDATE users SET updated_at = created_at WHERE updated_at = ''");
    }
  }
}

/**
 * Migration 003: Memberships & Sessions
 */
function migration003(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organization_memberships (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'MEMBER',
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

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_memberships_user ON organization_memberships(user_id);
    CREATE INDEX IF NOT EXISTS idx_memberships_org ON organization_memberships(organization_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  `);

  // Backfill organization_memberships for legacy users
  const unlinkedUsers = db.prepare(`
    SELECT u.id as user_id, p.organization_id
    FROM users u
    LEFT JOIN organization_memberships m ON u.id = m.user_id
    LEFT JOIN projects p ON 1=1
    WHERE m.id IS NULL
    GROUP BY u.id
  `).all();

  for (const row of unlinkedUsers) {
    if (row.organization_id) {
      db.prepare(`
        INSERT OR IGNORE INTO organization_memberships (id, organization_id, user_id, role, status, created_at, updated_at)
        VALUES (?, ?, ?, 'OWNER', 'ACTIVE', datetime('now'), datetime('now'))
      `).run(`mem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`, row.organization_id, row.user_id);
    }
  }
}

/**
 * Migration 004: Integrations & Webhook Replay
 */
function migration004(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      provider TEXT NOT NULL,
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

    CREATE INDEX IF NOT EXISTS idx_integrations_org ON integrations(organization_id);
    CREATE INDEX IF NOT EXISTS idx_integrations_provider ON integrations(provider);
    CREATE INDEX IF NOT EXISTS idx_processed_webhooks_lookup ON processed_webhooks(integration_id, delivery_id);
  `);
}

/**
 * Migration 005: Schema Normalization, Relational Join Tables & B-Tree Indexing (P0-04)
 */
function migration005(db) {
  // 1. Create normalized join tables
  db.exec(`
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

    CREATE TABLE IF NOT EXISTS memory_tags (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(memory_id, tag),
      FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS root_cause_evidence (
      id TEXT PRIMARY KEY,
      root_cause_id TEXT NOT NULL,
      evidence_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(root_cause_id, evidence_id),
      FOREIGN KEY(root_cause_id) REFERENCES root_causes(id) ON DELETE CASCADE,
      FOREIGN KEY(evidence_id) REFERENCES evidence(id) ON DELETE CASCADE
    );
  `);

  // 2. Create comprehensive performance and composite B-tree indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_projects_org_status ON projects(organization_id, status);
    CREATE INDEX IF NOT EXISTS idx_investigations_proj_status ON investigations(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_investigations_created ON investigations(project_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_evidence_inv_collected ON evidence(investigation_id, collected_at);
    CREATE INDEX IF NOT EXISTS idx_evidence_hash ON evidence(hash);
    CREATE INDEX IF NOT EXISTS idx_hypotheses_inv_status ON hypotheses(investigation_id, status);

    CREATE INDEX IF NOT EXISTS idx_hyp_evi_hypothesis ON hypothesis_evidence(hypothesis_id);
    CREATE INDEX IF NOT EXISTS idx_hyp_evi_evidence ON hypothesis_evidence(evidence_id);
    CREATE INDEX IF NOT EXISTS idx_hyp_evi_rel ON hypothesis_evidence(hypothesis_id, relationship_type);

    CREATE INDEX IF NOT EXISTS idx_memory_tags_memory ON memory_tags(memory_id);
    CREATE INDEX IF NOT EXISTS idx_memory_tags_tag ON memory_tags(tag);
    CREATE INDEX IF NOT EXISTS idx_memories_org_proj ON memories(organization_id, project_id);
    CREATE INDEX IF NOT EXISTS idx_memories_freshness ON memories(organization_id, freshness_score DESC);

    CREATE INDEX IF NOT EXISTS idx_rc_evi_root_cause ON root_cause_evidence(root_cause_id);
    CREATE INDEX IF NOT EXISTS idx_rc_evi_evidence ON root_cause_evidence(evidence_id);
    CREATE INDEX IF NOT EXISTS idx_root_causes_inv ON root_causes(investigation_id);
    CREATE INDEX IF NOT EXISTS idx_root_causes_ver ON root_causes(verification_ref);
    CREATE INDEX IF NOT EXISTS idx_verifications_exp_outcome ON verifications(experiment_id, outcome);
    CREATE INDEX IF NOT EXISTS idx_recommendations_inv ON recommendations(investigation_id);
  `);

  // 3. Backfill hypotheses -> hypothesis_evidence
  const allHypotheses = db.prepare('SELECT id, supporting_evidence_ids, conflicting_evidence_ids FROM hypotheses').all();
  for (const hyp of allHypotheses) {
    let supIds = [];
    let conIds = [];
    try {
      supIds = typeof hyp.supporting_evidence_ids === 'string' ? JSON.parse(hyp.supporting_evidence_ids || '[]') : (hyp.supporting_evidence_ids || []);
    } catch (_) {}
    try {
      conIds = typeof hyp.conflicting_evidence_ids === 'string' ? JSON.parse(hyp.conflicting_evidence_ids || '[]') : (hyp.conflicting_evidence_ids || []);
    } catch (_) {}

    if (Array.isArray(supIds)) {
      for (const eviId of supIds) {
        const eviExists = db.prepare('SELECT id FROM evidence WHERE id = ?').get(eviId);
        if (eviExists) {
          const id = `he_${crypto.randomUUID().substring(0, 8)}`;
          db.prepare(`
            INSERT OR IGNORE INTO hypothesis_evidence (id, hypothesis_id, evidence_id, relationship_type, created_at)
            VALUES (?, ?, ?, 'SUPPORTS', datetime('now'))
          `).run(id, hyp.id, eviId);
        }
      }
    }

    if (Array.isArray(conIds)) {
      for (const eviId of conIds) {
        const eviExists = db.prepare('SELECT id FROM evidence WHERE id = ?').get(eviId);
        if (eviExists) {
          const id = `he_${crypto.randomUUID().substring(0, 8)}`;
          db.prepare(`
            INSERT OR IGNORE INTO hypothesis_evidence (id, hypothesis_id, evidence_id, relationship_type, created_at)
            VALUES (?, ?, ?, 'CONTRADICTS', datetime('now'))
          `).run(id, hyp.id, eviId);
        }
      }
    }
  }

  // 4. Backfill memories -> memory_tags
  const allMemories = db.prepare('SELECT id, tags FROM memories').all();
  for (const mem of allMemories) {
    let tags = [];
    try {
      tags = typeof mem.tags === 'string' ? JSON.parse(mem.tags || '[]') : (mem.tags || []);
    } catch (_) {}
    if (Array.isArray(tags)) {
      for (const tag of tags) {
        if (typeof tag === 'string' && tag.trim()) {
          const id = `mt_${crypto.randomUUID().substring(0, 8)}`;
          db.prepare(`
            INSERT OR IGNORE INTO memory_tags (id, memory_id, tag, created_at)
            VALUES (?, ?, ?, datetime('now'))
          `).run(id, mem.id, tag.trim().toLowerCase());
        }
      }
    }
  }

  // 5. Backfill root_causes -> root_cause_evidence
  const allRCs = db.prepare('SELECT id, supporting_evidence FROM root_causes').all();
  for (const rc of allRCs) {
    let eviRefs = [];
    try {
      eviRefs = typeof rc.supporting_evidence === 'string' ? JSON.parse(rc.supporting_evidence || '[]') : (rc.supporting_evidence || []);
    } catch (_) {}
    if (Array.isArray(eviRefs)) {
      for (const eviId of eviRefs) {
        const eviExists = db.prepare('SELECT id FROM evidence WHERE id = ?').get(eviId);
        if (eviExists) {
          const id = `rce_${crypto.randomUUID().substring(0, 8)}`;
          db.prepare(`
            INSERT OR IGNORE INTO root_cause_evidence (id, root_cause_id, evidence_id, created_at)
            VALUES (?, ?, ?, datetime('now'))
          `).run(id, rc.id, eviId);
        }
      }
    }
  }
}

/**
 * Migration 006: Asynchronous Job Queue & Background Worker Architecture (P1-01)
 */
function migration006(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      project_id TEXT,
      investigation_id TEXT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'QUEUED',
      priority TEXT NOT NULL DEFAULT 'NORMAL',
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
      updated_at TEXT NOT NULL,
      FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL,
      FOREIGN KEY(investigation_id) REFERENCES investigations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS job_checkpoints (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      checkpoint_type TEXT NOT NULL,
      phase TEXT NOT NULL,
      progress_pct INTEGER NOT NULL DEFAULT 0,
      state_data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs(status, scheduled_at, priority);
    CREATE INDEX IF NOT EXISTS idx_jobs_org_status ON jobs(organization_id, status);
    CREATE INDEX IF NOT EXISTS idx_jobs_investigation ON jobs(investigation_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_heartbeat ON jobs(status, heartbeat_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_idempotency ON jobs(idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_job_checkpoints_job ON job_checkpoints(job_id, created_at);
  `);
}

const MIGRATIONS = [
  { version: 1, name: '001_base_schema', up: migration001 },
  { version: 2, name: '002_organizations_and_users', up: migration002 },
  { version: 3, name: '003_memberships_and_sessions', up: migration003 },
  { version: 4, name: '004_integrations_and_webhooks', up: migration004 },
  { version: 5, name: '005_schema_normalization_and_indexing', up: migration005 },
  { version: 6, name: '006_async_job_queue_and_workers', up: migration006 }
];

/**
 * Executes all pending migrations in order inside individual transactions
 */
function runMigrations(db) {
  // Ensure migration tracking table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      executed_at TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all();
  const applied = new Set(appliedRows.map(r => r.version));

  for (const migration of MIGRATIONS) {
    if (!applied.has(migration.version)) {
      db.exec('BEGIN TRANSACTION;');
      try {
        migration.up(db);
        db.prepare(`
          INSERT INTO schema_migrations (version, name, executed_at)
          VALUES (?, ?, ?)
        `).run(migration.version, migration.name, new Date().toISOString());
        db.exec('COMMIT;');
      } catch (err) {
        db.exec('ROLLBACK;');
        console.error(`[PRISM Migration Error] Migration ${migration.version} (${migration.name}) failed:`, err);
        throw err;
      }
    }
  }
}

function initDatabase(dbPath = null) {
  if (dbInstance) {
    return dbInstance;
  }

  const actualPath = dbPath || process.env.PRISM_DB_PATH || path.join(__dirname, '../../prism.db');
  dbInstance = new DatabaseSync(actualPath);

  // Enable foreign keys and WAL mode on every connection
  dbInstance.exec('PRAGMA foreign_keys = ON;');
  dbInstance.exec('PRAGMA journal_mode = WAL;');

  // Run schema migrations
  runMigrations(dbInstance);

  return dbInstance;
}

function getDatabase() {
  if (!dbInstance) {
    return initDatabase();
  }
  return dbInstance;
}

function closeDatabase() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

module.exports = {
  initDatabase,
  getDatabase,
  closeDatabase,
  runMigrations,
  MIGRATIONS
};
