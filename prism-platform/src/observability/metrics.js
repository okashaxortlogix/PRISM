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
    `prism_audit_events_total ${auditCounts}`
  ];

  return lines.join('\n');
}

module.exports = {
  trackRequest,
  getPrometheusMetrics
};
