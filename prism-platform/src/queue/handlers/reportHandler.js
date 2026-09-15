// PRISM Report Generation Asynchronous Job Handler
const { getDatabase } = require('../../db/database');
const { JobError, ERROR_CODES } = require('../jobErrors');

async function handleReportJob(job, { queue, checkCancellation }) {
  const db = getDatabase();
  const investigationId = job.investigation_id || (job.payload && job.payload.investigation_id);

  if (!investigationId) {
    throw new JobError(ERROR_CODES.VALIDATION_ERROR, 'Job is missing investigation_id', { isRetryable: false });
  }

  const inv = db.prepare('SELECT * FROM investigations WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE organization_id = ?)').get(investigationId, job.organization_id);
  if (!inv) {
    throw new JobError(ERROR_CODES.VALIDATION_ERROR, `Investigation ${investigationId} not found in organization ${job.organization_id}`, { isRetryable: false });
  }

  queue.checkpoint(job.id, 'COLLECTING_SECTIONS', 30, { message: 'Aggregating investigation entities' });
  if (checkCancellation()) throw new JobError(ERROR_CODES.CANCELLED, 'Report generation cancelled');

  const evidence = db.prepare('SELECT * FROM evidence WHERE investigation_id = ?').all(inv.id);
  const hypotheses = db.prepare('SELECT * FROM hypotheses WHERE investigation_id = ?').all(inv.id);
  const rootCauses = db.prepare('SELECT * FROM root_causes WHERE investigation_id = ?').all(inv.id);
  const impact = db.prepare('SELECT * FROM impact_assessments WHERE investigation_id = ?').get(inv.id);
  const recommendations = db.prepare('SELECT * FROM recommendations WHERE investigation_id = ?').all(inv.id);

  queue.checkpoint(job.id, 'COMPILING_DOCUMENT', 70, { message: 'Compiling report formats' });
  if (checkCancellation()) throw new JobError(ERROR_CODES.CANCELLED, 'Report generation cancelled');

  const markdownContent = [
    `# PRISM Investigation Report: ${inv.title}`,
    `**ID**: \`${inv.id}\` | **Severity**: \`${inv.severity}\` | **Status**: \`${inv.status}\``,
    `**Generated**: ${new Date().toISOString()}`,
    '',
    `## Problem Statement\n> ${inv.problem_statement}`,
    '',
    `## Evidence Summary (${evidence.length} items)`,
    ...evidence.map(e => `- [${e.type}] **${e.title}** (Reliability: ${((e.reliability || 0.8) * 100).toFixed(0)}%)`),
    '',
    `## Hypotheses Matrix (${hypotheses.length} items)`,
    ...hypotheses.map(h => `- **${h.statement}** -> Status: \`${h.status}\`, Confidence: ${((h.confidence || 0) * 100).toFixed(0)}%`),
    '',
    `## Root Causes (${rootCauses.length} identified)`,
    ...rootCauses.map(rc => `- ${rc.statement} (Ref: \`${rc.verification_ref || 'N/A'}\`)`),
    '',
    `## Recommendations (${recommendations.length} action items)`,
    ...recommendations.map(r => `1. **${r.title}** [${r.priority}]: ${r.description}`)
  ].join('\n');

  queue.checkpoint(job.id, 'COMPLETED', 100, { message: 'Report generated successfully' });

  return {
    investigationId: inv.id,
    reportFormat: job.payload ? job.payload.format || 'markdown' : 'markdown',
    markdown: markdownContent,
    summary: {
      evidenceCount: evidence.length,
      hypothesesCount: hypotheses.length,
      rootCausesCount: rootCauses.length,
      recommendationsCount: recommendations.length
    },
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  handleReportJob
};
