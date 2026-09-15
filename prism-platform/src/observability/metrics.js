// PRISM SRE & Observability Prometheus Metrics Registry
// Aligned with 14-SRE-OBSERVABILITY/SRE-SPEC.md
const { getDatabase } = require('../db/database');

const metricsData = {
  httpRequestsTotal: 0,
  requestDurations: [],
  endpointHits: {}
};

function trackRequest(method, path, durationMs, statusCode) {
  metricsData.httpRequestsTotal++;
  const key = `${method}_${path}_${statusCode}`;
  metricsData.endpointHits[key] = (metricsData.endpointHits[key] || 0) + 1;
  metricsData.requestDurations.push(durationMs);
  if (metricsData.requestDurations.length > 500) {
    metricsData.requestDurations.shift();
  }
}

function getPrometheusMetrics() {
  const db = getDatabase();
  const invCounts = db.prepare('SELECT count(*) as count FROM investigations').get().count;
  const evidenceCounts = db.prepare('SELECT count(*) as count FROM evidence').get().count;
  const verCounts = db.prepare('SELECT count(*) as count FROM verifications').get().count;
  const auditCounts = db.prepare('SELECT count(*) as count FROM audit_events').get().count;

  // Job Queue Metrics (P1-01)
  const jobStats = {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    retrying: 0,
    dead_letter: 0,
    cancelled: 0
  };

  try {
    const jobRows = db.prepare('SELECT status, count(*) as count FROM jobs GROUP BY status').all();
    for (const r of jobRows) {
      if (r.status === 'QUEUED') jobStats.queued = r.count;
      else if (r.status === 'RUNNING') jobStats.running = r.count;
      else if (r.status === 'SUCCEEDED') jobStats.succeeded = r.count;
      else if (r.status === 'FAILED') jobStats.failed = r.count;
      else if (r.status === 'RETRYING') jobStats.retrying = r.count;
      else if (r.status === 'DEAD_LETTER') jobStats.dead_letter = r.count;
      else if (r.status === 'CANCELLED') jobStats.cancelled = r.count;
    }
  } catch (_) {}

  const avgDuration = metricsData.requestDurations.length > 0
    ? (metricsData.requestDurations.reduce((a, b) => a + b, 0) / metricsData.requestDurations.length) / 1000
    : 0.005;

  const lines = [
    '# HELP prism_http_requests_total Total number of HTTP requests received by PRISM',
    '# TYPE prism_http_requests_total counter',
    `prism_http_requests_total ${metricsData.httpRequestsTotal}`,
    '',
    '# HELP prism_http_request_duration_seconds Average latency in seconds',
    '# TYPE prism_http_request_duration_seconds gauge',
    `prism_http_request_duration_seconds ${avgDuration.toFixed(4)}`,
    '',
    '# HELP prism_active_investigations_total Current count of active investigations',
    '# TYPE prism_active_investigations_total gauge',
    `prism_active_investigations_total ${invCounts}`,
    '',
    '# HELP prism_evidence_items_total Total immutable evidence items collected in vault',
    '# TYPE prism_evidence_items_total gauge',
    `prism_evidence_items_total ${evidenceCounts}`,
    '',
    '# HELP prism_verifications_total Total verifications recorded',
    '# TYPE prism_verifications_total gauge',
    `prism_verifications_total ${verCounts}`,
    '',
    '# HELP prism_audit_events_total Total security audit events recorded',
    '# TYPE prism_audit_events_total gauge',
    `prism_audit_events_total ${auditCounts}`,
    '',
    '# HELP prism_queue_jobs_queued_total Total queued jobs awaiting worker pickup',
    '# TYPE prism_queue_jobs_queued_total gauge',
    `prism_queue_jobs_queued_total ${jobStats.queued}`,
    '',
    '# HELP prism_queue_jobs_running_total Total jobs actively running across workers',
    '# TYPE prism_queue_jobs_running_total gauge',
    `prism_queue_jobs_running_total ${jobStats.running}`,
    '',
    '# HELP prism_queue_jobs_succeeded_total Total successfully completed background jobs',
    '# TYPE prism_queue_jobs_succeeded_total gauge',
    `prism_queue_jobs_succeeded_total ${jobStats.succeeded}`,
    '',
    '# HELP prism_queue_jobs_failed_total Total failed jobs',
    '# TYPE prism_queue_jobs_failed_total gauge',
    `prism_queue_jobs_failed_total ${jobStats.failed}`,
    '',
    '# HELP prism_queue_jobs_retrying_total Total jobs currently in backoff retry state',
    '# TYPE prism_queue_jobs_retrying_total gauge',
    `prism_queue_jobs_retrying_total ${jobStats.retrying}`,
    '',
    '# HELP prism_queue_jobs_dead_letter_total Total jobs in dead letter state after max attempts',
    '# TYPE prism_queue_jobs_dead_letter_total gauge',
    `prism_queue_jobs_dead_letter_total ${jobStats.dead_letter}`,
    '',
    '# HELP prism_queue_jobs_cancelled_total Total jobs cancelled',
    '# TYPE prism_queue_jobs_cancelled_total gauge',
    `prism_queue_jobs_cancelled_total ${jobStats.cancelled}`
  ];

  return lines.join('\n');
}

module.exports = {
  trackRequest,
  getPrometheusMetrics
};
