// PRISM PagerDuty Integration Adapter
// Ingests PagerDuty incident triggers and normalizes into PRISM investigations

function parsePagerDutyIncident(incidentPayload, projectId = 'prj_checkout') {
  const inc = incidentPayload.incident || incidentPayload;
  const urgency = inc.urgency === 'high' ? 'SEV1' : 'SEV2';

  return {
    project_id: projectId,
    title: inc.title || `PagerDuty Incident #${inc.incident_number || 'ALERT'}`,
    problem_statement: inc.summary || inc.description || 'Triggered via PagerDuty incident integration.',
    severity: urgency,
    scope: {
      service: inc.service?.summary || 'unknown',
      urgency: inc.urgency,
      html_url: inc.html_url
    }
  };
}

module.exports = { parsePagerDutyIncident };
