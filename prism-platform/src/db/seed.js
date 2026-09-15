// PRISM Platform Seed Data
// Includes hashed credentials and multi-tenant test fixtures
const { getDatabase } = require('./database');
const { computeEvidenceHash } = require('../engine/evidenceEngine');
const { hashPassword } = require('../security/passwordService');

function seedData() {
  const db = getDatabase();

  // Check if Globex tenant is already seeded
  const globexCheck = db.prepare('SELECT count(*) as count FROM organizations WHERE id = ?').get('org_globex');
  const shouldSeedGlobex = !globexCheck || globexCheck.count === 0;

  // Ensure password_hash is populated for Alex
  const alex = db.prepare('SELECT password_hash FROM users WHERE id = ?').get('usr_alex');
  if (alex && (!alex.password_hash || alex.password_hash === '')) {
    const demoHash = hashPassword('PrismDemo2026!');
    db.prepare("UPDATE users SET password_hash = ? WHERE password_hash IS NULL OR password_hash = ''").run(demoHash);
  }

  const intCheck = db.prepare('SELECT count(*) as count FROM integrations').get();
  const shouldSeedIntegrations = !intCheck || intCheck.count === 0;

  const orgCheck = db.prepare('SELECT count(*) as count FROM organizations WHERE id = ?').get('org_acme');
  if (orgCheck && orgCheck.count > 0 && !shouldSeedGlobex && !shouldSeedIntegrations) {
    return;
  }

  const now = new Date().toISOString();
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const twoDaysAgo = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const demoHash = hashPassword('PrismDemo2026!');

  // ==========================================
  // TENANT 1: Acme Cloud Platform (org_acme)
  // ==========================================
  db.prepare(`
    INSERT OR IGNORE INTO organizations (id, name, slug, status, created_at, updated_at)
    VALUES ('org_acme', 'Acme Cloud Platform', 'acme-cloud', 'ACTIVE', ?, ?)
  `).run(twoDaysAgo, now);

  // User 1: Alex Chen (OWNER)
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, password_hash, display_name, status, created_at, updated_at)
    VALUES ('usr_alex', 'alex.chen@acme.internal', ?, 'Alex Chen (Principal SRE)', 'ACTIVE', ?, ?)
  `).run(demoHash, twoDaysAgo, now);

  db.prepare(`
    INSERT OR IGNORE INTO organization_memberships (id, organization_id, user_id, role, status, created_at, updated_at)
    VALUES ('mem_alex_acme', 'org_acme', 'usr_alex', 'OWNER', 'ACTIVE', ?, ?)
  `).run(twoDaysAgo, now);

  // User 2: Bob Miller (VIEWER in org_acme)
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, password_hash, display_name, status, created_at, updated_at)
    VALUES ('usr_bob', 'bob.miller@acme.internal', ?, 'Bob Miller (Auditor)', 'ACTIVE', ?, ?)
  `).run(demoHash, twoDaysAgo, now);

  db.prepare(`
    INSERT OR IGNORE INTO organization_memberships (id, organization_id, user_id, role, status, created_at, updated_at)
    VALUES ('mem_bob_acme', 'org_acme', 'usr_bob', 'VIEWER', 'ACTIVE', ?, ?)
  `).run(twoDaysAgo, now);

  // Project 1 & Repos
  db.prepare(`
    INSERT OR IGNORE INTO projects (id, organization_id, name, description, status, created_at, updated_at)
    VALUES ('prj_checkout', 'org_acme', 'Payment & Checkout Core', 'High-throughput payment gateway and distributed transaction processor', 'ACTIVE', ?, ?)
  `).run(twoDaysAgo, now);

  db.prepare(`
    INSERT OR IGNORE INTO repositories (id, project_id, provider, external_id, url, default_branch, metadata, status, created_at)
    VALUES ('repo_pay_engine', 'prj_checkout', 'GITHUB', 'acme/payment-engine', 'https://github.com/acme/payment-engine.git', 'main', '{"language":"Go","framework":"gRPC/Go"}', 'INGESTED', ?)
  `).run(twoDaysAgo);

  // Investigation 1: Distributed Lock Starvation in Payment Checkout
  db.prepare(`
    INSERT OR IGNORE INTO investigations (id, project_id, created_by, title, problem_statement, status, severity, scope, started_at, completed_at, updated_at)
    VALUES (
      'inv_001',
      'prj_checkout',
      'usr_alex',
      'Distributed Lock Starvation in Payment Checkout Service',
      'Checkout workers sporadically timeout during peak load (SEV1). 14% of payment capture requests return 504 Gateway Timeout while CPU is at 35% and database latency is normal.',
      'RECOMMENDATION',
      'SEV1',
      '{"services":["checkout-api","payment-processor","redis-cluster"],"region":"us-east-1"}',
      ?,
      NULL,
      ?
    )
  `).run(yesterday, now);

  // Evidence for Investigation 1
  const evi1Content = `goroutine 4821 [select, 45 minutes]:
github.com/acme/payment-engine/lock.(*RedLock).Acquire(0xc000412000, 0x12a05f0, 0x20)
    /src/lock/redlock.go:84 +0x3d4
github.com/acme/payment-engine/checkout.ProcessPayment(0xc00028a000, 0xc0005d4000)
    /src/checkout/service.go:142 +0x18b`;

  const evi1Hash = computeEvidenceHash('LOG_EVIDENCE', 'checkout-worker-pod-89fd4', 'k8s/logs/pod/checkout-worker', evi1Content);

  db.prepare(`
    INSERT OR IGNORE INTO evidence (id, investigation_id, type, source, source_ref, title, content, metadata, observed_at, collected_at, reliability, provenance, hash)
    VALUES ('evi_001_logs', 'inv_001', 'LOG_EVIDENCE', 'checkout-worker-pod-89fd4', 'k8s/logs/pod/checkout-worker', 'Goroutine Dump: Stack trace blocked in RedLock.Acquire', ?, '{"pod":"checkout-worker-89fd4","node":"ip-10-0-4-12"}', ?, ?, 0.95, '{"collector":"datadog_agent","verified":true}', ?)
  `).run(evi1Content, yesterday, yesterday, evi1Hash);

  const evi2Content = `diff --git a/src/lock/redlock.go b/src/lock/redlock.go
@@ -82,3 +82,4 @@
- lockTTL := 5 * time.Second
+ lockTTL := 500 * time.Millisecond // reduced for faster failover
  retryDelay := 100 * time.Millisecond`;

  const evi2Hash = computeEvidenceHash('REPOSITORY_CODE', 'git.acme.internal/payment-engine', 'commit/88fa2b1d', evi2Content);

  db.prepare(`
    INSERT OR IGNORE INTO evidence (id, investigation_id, type, source, source_ref, title, content, metadata, observed_at, collected_at, reliability, provenance, hash)
    VALUES ('evi_002_git', 'inv_001', 'REPOSITORY_CODE', 'git.acme.internal/payment-engine', 'commit/88fa2b1d', 'Git Diff: lockTTL decreased from 5000ms to 500ms in PR #412', ?, '{"author":"j.doe@acme.internal","pr":412}', ?, ?, 0.98, '{"collector":"github_webhook","commit_sha":"88fa2b1d"}', ?)
  `).run(evi2Content, yesterday, yesterday, evi2Hash);

  const evi3Content = `p99 Redis network roundtrip latency spikes from 1.2ms to 620ms during peak burst traffic between 14:00 and 14:20 UTC.`;
  const evi3Hash = computeEvidenceHash('METRIC_TRACE', 'datadog-metrics', 'query/redis.latency.p99', evi3Content);

  db.prepare(`
    INSERT OR IGNORE INTO evidence (id, investigation_id, type, source, source_ref, title, content, metadata, observed_at, collected_at, reliability, provenance, hash)
    VALUES ('evi_003_metric', 'inv_001', 'METRIC_TRACE', 'datadog-metrics', 'query/redis.latency.p99', 'Redis p99 Network Latency Spike Graph', ?, '{"metric":"redis.network.latency","p99_max":"620ms"}', ?, ?, 0.96, '{"collector":"datadog_api"}', ?)
  `).run(evi3Content, yesterday, yesterday, evi3Hash);

  // Hypotheses
  db.prepare(`
    INSERT OR IGNORE INTO hypotheses (id, investigation_id, statement, status, confidence, rationale, supporting_evidence_ids, conflicting_evidence_ids, created_at, updated_at)
    VALUES (
      'hyp_001',
      'inv_001',
      'The lockTTL (500ms) expires before the distributed Redis lock quorum can be acknowledged during cross-AZ latency bursts, triggering cascading lock acquisition loops and client deadlocks.',
      'VERIFIED',
      0.96,
      'Direct correlation between reduced lockTTL in commit 88fa2b1d and redis network p99 latency spikes exceeding 500ms.',
      '["evi_001_logs","evi_002_git","evi_003_metric"]',
      '[]',
      ?,
      ?
    )
  `).run(yesterday, now);

  db.prepare(`
    INSERT OR IGNORE INTO hypotheses (id, investigation_id, statement, status, confidence, rationale, supporting_evidence_ids, conflicting_evidence_ids, created_at, updated_at)
    VALUES (
      'hyp_002',
      'inv_001',
      'PostgreSQL connection pool exhaustion on payment-db primary replica.',
      'REJECTED',
      0.08,
      'DB latency and active connection metrics remained strictly below 25% capacity throughout the incident window.',
      '[]',
      '["evi_001_logs"]',
      ?,
      ?
    )
  `).run(yesterday, now);

  // Normalized Hypothesis Evidence Joins (P0-04)
  db.prepare(`
    INSERT OR IGNORE INTO hypothesis_evidence (id, hypothesis_id, evidence_id, relationship_type, created_at)
    VALUES 
      ('he_001', 'hyp_001', 'evi_001_logs', 'SUPPORTS', ?),
      ('he_002', 'hyp_001', 'evi_002_git', 'SUPPORTS', ?),
      ('he_003', 'hyp_001', 'evi_003_metric', 'SUPPORTS', ?),
      ('he_004', 'hyp_002', 'evi_001_logs', 'CONTRADICTS', ?)
  `).run(yesterday, yesterday, yesterday, yesterday);

  // Experiment & Verification
  db.prepare(`
    INSERT OR IGNORE INTO experiments (id, hypothesis_id, plan, permissions, status, started_at, completed_at, result_ref, logs, created_at)
    VALUES (
      'exp_001',
      'hyp_001',
      'Simulate 600ms synthetic jitter on Redis TCP port in isolated staging sandbox with 200 concurrent checkout workers.',
      '["STAGING_EXECUTE"]',
      'COMPLETED',
      ?,
      ?,
      'sandbox-run-9182',
      '["Spawned 200 virtual workers","Injected 600ms delay via tc-netem","Worker lock timeout reproduced 100%"]',
      ?
    )
  `).run(yesterday, yesterday, yesterday);

  db.prepare(`
    INSERT OR IGNORE INTO verifications (id, experiment_id, claim, method, expected_result, actual_result, outcome, evidence_ref, performed_by, performed_at, limitations)
    VALUES (
      'ver_001',
      'exp_001',
      'LockTTL of 500ms is strictly less than cross-AZ Redis p99 latency under burst load, causing 100% lock renewal failures',
      'Deterministic fault injection via tc qdisc netem delay 600ms in staging cluster',
      'Reproduce 504 gateway timeout and lock timeout exception in worker pods',
      '100% reproduction rate. 182 out of 200 worker threads entered deadlock waiting for expired lock renewal.',
      'VERIFIED',
      'evi_001_logs',
      'usr_alex',
      ?,
      'Staging network is simulated single-region with artificial delay, production is multi-AZ.'
    )
  `).run(yesterday);

  // Root Cause
  db.prepare(`
    INSERT OR IGNORE INTO root_causes (id, investigation_id, statement, confidence, supporting_evidence, verification_ref, created_at)
    VALUES (
      'rc_001',
      'inv_001',
      'Aggressive reduction of lockTTL to 500ms in commit 88fa2b1d caused lock leases to expire during normal cross-AZ network latency variations, leading to unhandled lock loss exceptions and worker starvation.',
      0.97,
      '["evi_001_logs","evi_002_git","evi_003_metric"]',
      'ver_001',
      ?
    )
  `).run(yesterday);

  // Normalized Root Cause Evidence Joins (P0-04)
  db.prepare(`
    INSERT OR IGNORE INTO root_cause_evidence (id, root_cause_id, evidence_id, created_at)
    VALUES 
      ('rce_001', 'rc_001', 'evi_001_logs', ?),
      ('rce_002', 'rc_001', 'evi_002_git', ?),
      ('rce_003', 'rc_001', 'evi_003_metric', ?)
  `).run(yesterday, yesterday, yesterday);

  // Impact Assessment
  db.prepare(`
    INSERT OR IGNORE INTO impact_assessments (id, investigation_id, affected_components, user_impact, data_integrity_impact, blast_radius_level, financial_cost_estimate, created_at)
    VALUES (
      'imp_001',
      'inv_001',
      '["checkout-api","payment-processor","order-state-machine","stripe-webhook-gateway"]',
      '14% of customer checkout attempts timed out over a 45-minute period. Customers received retry prompts.',
      'Zero double-charge occurrences detected; transactions failed cleanly before state capture.',
      'HIGH',
      '$18,400 in delayed GMV',
      ?
    )
  `).run(yesterday);

  // Recommendation
  db.prepare(`
    INSERT OR IGNORE INTO recommendations (id, investigation_id, action, rationale, tradeoffs, risk, priority, evidence_ref, created_at)
    VALUES (
      'rec_001',
      'inv_001',
      'Increase lockTTL to 3,500ms and implement heartbeating auto-renewal goroutine for long-running payment operations.',
      'Ensures locks survive transient cross-AZ network spikes up to 1,500ms while retaining automatic release on node crash.',
      'Slightly longer wait times if a worker hard-crashes while holding the lock (up to 3.5s instead of 500ms).',
      'LOW. Extensively tested in staging sandbox.',
      'P0',
      'evi_002_git',
      ?
    )
  `).run(yesterday);

  // Reusable Memory
  db.prepare(`
    INSERT OR IGNORE INTO memories (id, organization_id, project_id, investigation_id, title, summary, root_cause, resolution, tags, freshness_score, created_at, updated_at)
    VALUES (
      'mem_001',
      'org_acme',
      'prj_checkout',
      'inv_001',
      'Redis RedLock Starvation during Cross-AZ Network Latency',
      'Checkout workers deadlocked when lockTTL was configured lower than p99 cross-AZ network roundtrip times.',
      'LockTTL of 500ms was shorter than network latency bursts under load.',
      'Set lockTTL >= 3.5s and enabled auto-heartbeat lease renewal.',
      '["redis","redlock","checkout","timeout","latency","distributed-locks"]',
      0.99,
      ?,
      ?
    )
  `).run(yesterday, now);

  // Normalized Memory Tags (P0-04)
  const mem1Tags = ["redis","redlock","checkout","timeout","latency","distributed-locks"];
  for (let i = 0; i < mem1Tags.length; i++) {
    db.prepare(`
      INSERT OR IGNORE INTO memory_tags (id, memory_id, tag, created_at)
      VALUES (?, 'mem_001', ?, ?)
    `).run(`mt_acme_${i}`, mem1Tags[i], yesterday);
  }

  // ==========================================
  // TENANT 2: Globex Corporation (org_globex)
  // Used for automated cross-tenant isolation testing
  // ==========================================
  db.prepare(`
    INSERT OR IGNORE INTO organizations (id, name, slug, status, created_at, updated_at)
    VALUES ('org_globex', 'Globex Corporation', 'globex-corp', 'ACTIVE', ?, ?)
  `).run(twoDaysAgo, now);

  // User: Sarah Connor (OWNER in org_globex)
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, password_hash, display_name, status, created_at, updated_at)
    VALUES ('usr_sarah', 'sarah.connor@globex.internal', ?, 'Sarah Connor (Head of Infra)', 'ACTIVE', ?, ?)
  `).run(demoHash, twoDaysAgo, now);

  db.prepare(`
    INSERT OR IGNORE INTO organization_memberships (id, organization_id, user_id, role, status, created_at, updated_at)
    VALUES ('mem_sarah_globex', 'org_globex', 'usr_sarah', 'OWNER', 'ACTIVE', ?, ?)
  `).run(twoDaysAgo, now);

  // Globex Project & Investigation
  db.prepare(`
    INSERT OR IGNORE INTO projects (id, organization_id, name, description, status, created_at, updated_at)
    VALUES ('prj_globex_core', 'org_globex', 'Globex Core Platform', 'Proprietary enterprise data lake and streaming cluster', 'ACTIVE', ?, ?)
  `).run(twoDaysAgo, now);

  db.prepare(`
    INSERT OR IGNORE INTO investigations (id, project_id, created_by, title, problem_statement, status, severity, scope, started_at, completed_at, updated_at)
    VALUES (
      'inv_globex_001',
      'prj_globex_core',
      'usr_sarah',
      'Kafka Partition Rebalance Storm on Broker 4 Failure',
      'Consumer lag exceeded 4M messages across all topics following broker 4 sudden termination.',
      'SCOPING',
      'SEV2',
      '{"services":["kafka-broker-04","zookeeper-ensemble"],"region":"eu-central-1"}',
      ?,
      NULL,
      ?
    )
  `).run(yesterday, now);

  db.prepare(`
    INSERT OR IGNORE INTO memories (id, organization_id, project_id, investigation_id, title, summary, root_cause, resolution, tags, freshness_score, created_at, updated_at)
    VALUES (
      'mem_globex_001',
      'org_globex',
      'prj_globex_core',
      'inv_globex_001',
      'Kafka Static Membership Configuration Error',
      'Consumer groups underwent cascading rebalances because session.timeout.ms was configured shorter than heartbeats.',
      'session.timeout.ms was set to 6000ms instead of 45000ms.',
      'Enabled group.instance.id static membership across all Kafka worker pods.',
      '["kafka","rebalance","consumer-lag","globex"]',
      0.95,
      ?,
      ?
    )
  `).run(yesterday, now);

  // Normalized Globex Memory Tags (P0-04)
  const globexTags = ["kafka","rebalance","consumer-lag","globex"];
  for (let i = 0; i < globexTags.length; i++) {
    db.prepare(`
      INSERT OR IGNORE INTO memory_tags (id, memory_id, tag, created_at)
      VALUES (?, 'mem_globex_001', ?, ?)
    `).run(`mt_globex_${i}`, globexTags[i], yesterday);
  }

  // ==========================================
  // INTEGRATIONS SEED DATA (Tenant-Scoped Webhooks)
  // ==========================================
  // Acme Integrations
  db.prepare(`
    INSERT OR IGNORE INTO integrations (id, organization_id, provider, name, webhook_secret, config, status, created_at, updated_at)
    VALUES ('int_acme_gh', 'org_acme', 'GITHUB', 'Acme GitHub Production Repo', 'whsec_acme_github_secret_2026', '{"repo":"acme/payment-engine"}', 'ACTIVE', ?, ?)
  `).run(twoDaysAgo, now);

  db.prepare(`
    INSERT OR IGNORE INTO integrations (id, organization_id, provider, name, webhook_secret, config, status, created_at, updated_at)
    VALUES ('int_acme_dd', 'org_acme', 'DATADOG', 'Acme Datadog APM & Alerts', 'dd_sec_acme_datadog_token_2026', '{"env":"production"}', 'ACTIVE', ?, ?)
  `).run(twoDaysAgo, now);

  db.prepare(`
    INSERT OR IGNORE INTO integrations (id, organization_id, provider, name, webhook_secret, config, status, created_at, updated_at)
    VALUES ('int_acme_pd', 'org_acme', 'PAGERDUTY', 'Acme PagerDuty Critical Escalations', 'pd_sec_acme_pagerduty_secret_2026', '{"service_key":"pd-acme-svc"}', 'ACTIVE', ?, ?)
  `).run(twoDaysAgo, now);

  // Globex Integrations
  db.prepare(`
    INSERT OR IGNORE INTO integrations (id, organization_id, provider, name, webhook_secret, config, status, created_at, updated_at)
    VALUES ('int_globex_gh', 'org_globex', 'GITHUB', 'Globex Core GitHub', 'whsec_globex_github_secret_9999', '{"repo":"globex/kafka-cluster"}', 'ACTIVE', ?, ?)
  `).run(yesterday, now);

  db.prepare(`
    INSERT OR IGNORE INTO integrations (id, organization_id, provider, name, webhook_secret, config, status, created_at, updated_at)
    VALUES ('int_globex_dd', 'org_globex', 'DATADOG', 'Globex Datadog APM', 'dd_sec_globex_datadog_token_9999', '{"env":"globex-prod"}', 'ACTIVE', ?, ?)
  `).run(yesterday, now);

  db.prepare(`
    INSERT OR IGNORE INTO integrations (id, organization_id, provider, name, webhook_secret, config, status, created_at, updated_at)
    VALUES ('int_globex_pd', 'org_globex', 'PAGERDUTY', 'Globex PagerDuty', 'pd_sec_globex_pagerduty_secret_9999', '{"service_key":"pd-globex-svc"}', 'ACTIVE', ?, ?)
  `).run(yesterday, now);

  console.log('PRISM Multi-Tenant Seed data populated successfully.');
}

module.exports = { seedData };
