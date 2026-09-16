// PRISM Datadog Integration Adapter
// Parses Datadog metric monitors and APM traces into evidence

function parseDatadogAlert(alertPayload, investigationId) {
  const alertId = alertPayload.id || `dd_${Date.now()}`;
  const title = alertPayload.title || 'Datadog Metric Anomaly';
  const metric = alertPayload.metric || 'system.network.latency';
  const snapshotUrl = alertPayload.snapshot_url || '';

  return {
    investigation_id: investigationId,
    type: 'METRIC_TRACE',
    source: 'datadog',
    source_ref: `monitor/${alertId}`,
    title: `Datadog Alert: ${title}`,
    content: JSON.stringify({
      metric,
      query: alertPayload.query,
      current_value: alertPayload.value,
      threshold: alertPayload.threshold,
      triggered_at: alertPayload.date || new Date().toISOString(),
      snapshot: snapshotUrl
    }, null, 2),
    reliability: 0.95,
    provenance: { provider: 'datadog', monitor_id: alertId }
  };
}

module.exports = { parseDatadogAlert };
