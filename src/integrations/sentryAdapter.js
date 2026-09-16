// PRISM Sentry Integration Adapter
// Parses Sentry issue and error event webhooks into normalized PRISM evidence

function parseSentryWebhook(eventPayload, investigationId) {
  const event = eventPayload.event || eventPayload;
  const issue = eventPayload.issue || {};

  const eventId = event.event_id || event.id || `sentry_${Date.now()}`;
  const title = event.title || issue.title || 'Sentry Exception Alert';
  const culprit = event.culprit || issue.culprit || 'Unknown Culprit';
  const environment = event.environment || 'production';

  // Extract stack trace if available
  let stackTrace = null;
  if (event.exception?.values && event.exception.values[0]?.stacktrace) {
    stackTrace = event.exception.values[0].stacktrace.frames?.slice(-5).map(f => (
      `  at ${f.function || 'anonymous'} (${f.filename}:${f.lineno})`
    )).join('\n');
  }

  return {
    investigation_id: investigationId,
    type: 'LOG_EVIDENCE',
    source: 'sentry',
    source_ref: `issue/${issue.id || eventId}`,
    title: `Sentry Error: ${title}`,
    content: JSON.stringify({
      eventId,
      culprit,
      environment,
      level: event.level || 'error',
      stackTrace: stackTrace || 'No stacktrace frames provided',
      tags: event.tags || [],
      url: issue.permalink || event.web_url || ''
    }, null, 2),
    reliability: 0.96,
    provenance: {
      provider: 'sentry',
      eventId,
      issueId: issue.id || null
    }
  };
}

module.exports = { parseSentryWebhook };
