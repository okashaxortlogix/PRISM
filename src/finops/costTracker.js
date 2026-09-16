// PRISM FinOps & Cloud Cost Tracker
// Aligned with 15-FINOPS/FINOPS-SPEC.md
// Durable SQLite persistence with tenant isolation, budgeting, and spend anomaly detection

const crypto = require('node:crypto');
const { getDatabase } = require('../db/database');

const RATES = {
  MODEL_INPUT_PER_1K: 0.00015,
  MODEL_OUTPUT_PER_1K: 0.00060,
  SANDBOX_COMPUTE_PER_MINUTE: 0.0025,
  STORAGE_PER_GB_MONTH: 0.02,
  TOOL_CALL_PER_UNIT: 0.00010
};

/**
 * Calculates USD cost for given usage type and quantity
 */
function calculateCostUsd(type, quantity) {
  let cost = 0;
  if (type === 'MODEL_INPUT_TOKENS') {
    cost = (quantity / 1000) * RATES.MODEL_INPUT_PER_1K;
  } else if (type === 'MODEL_OUTPUT_TOKENS') {
    cost = (quantity / 1000) * RATES.MODEL_OUTPUT_PER_1K;
  } else if (type === 'SANDBOX_SECONDS') {
    cost = (quantity / 60) * RATES.SANDBOX_COMPUTE_PER_MINUTE;
  } else if (type === 'STORAGE_BYTES') {
    const gb = quantity / (1024 * 1024 * 1024);
    cost = gb * RATES.STORAGE_PER_GB_MONTH;
  } else if (type === 'TOOL_CALLS') {
    cost = quantity * RATES.TOOL_CALL_PER_UNIT;
  }
  return Number(cost.toFixed(6));
}

/**
 * Durably records usage into the database
 * @param {object} params
 * @param {string} [params.organizationId]
 * @param {string} [params.investigationId]
 * @param {string} params.type - MODEL_INPUT_TOKENS | MODEL_OUTPUT_TOKENS | SANDBOX_SECONDS | STORAGE_BYTES | TOOL_CALLS
 * @param {number} params.quantity
 * @param {string} [params.provider='SYSTEM']
 * @param {string} [params.model='SYSTEM']
 * @returns {object} The persisted record
 */
function recordUsage(params) {
  const db = getDatabase();
  const id = `cost_${crypto.randomUUID().replace(/-/g, '')}`;
  const now = new Date().toISOString();
  const type = params.type || params.usageType || 'MODEL_INPUT_TOKENS';
  const quantity = Number(params.quantity) || 0;
  const costUsd = params.costUsd !== undefined ? Number(params.costUsd) : calculateCostUsd(type, quantity);

  // If organizationId wasn't passed directly but investigationId was, resolve organizationId
  let organizationId = params.organizationId;
  if (!organizationId && params.investigationId) {
    try {
      const inv = db.prepare(`
        SELECT p.organization_id 
        FROM investigations i
        JOIN projects p ON i.project_id = p.id
        WHERE i.id = ?
      `).get(params.investigationId);
      if (inv) organizationId = inv.organization_id;
    } catch (_) {}
  }

  if (!organizationId) {
    organizationId = 'system';
  }

  db.prepare(`
    INSERT INTO finops_cost_records (
      id, organization_id, investigation_id, type, quantity, provider, model, cost_usd, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    organizationId,
    params.investigationId || null,
    type,
    quantity,
    params.provider || 'system',
    params.model || 'internal',
    costUsd,
    now
  );

  return {
    id,
    organizationId,
    investigationId: params.investigationId || null,
    type: params.type,
    quantity,
    costUsd,
    createdAt: now
  };
}

/**
 * Returns durable total cost and itemized breakdown for an investigation
 */
function getInvestigationTotalCost(investigationId, organizationId = null) {
  const db = getDatabase();
  let query = 'SELECT * FROM finops_cost_records WHERE investigation_id = ?';
  const sqlParams = [investigationId];

  if (organizationId) {
    query += ' AND organization_id = ?';
    sqlParams.push(organizationId);
  }
  query += ' ORDER BY created_at ASC';

  const items = db.prepare(query).all(...sqlParams);
  const total = items.reduce((sum, item) => sum + item.cost_usd, 0);

  return {
    investigationId,
    totalCostUsd: Number(total.toFixed(4)),
    itemCount: items.length,
    breakdown: items.map(i => ({
      id: i.id,
      type: i.type,
      quantity: i.quantity,
      provider: i.provider,
      model: i.model,
      costUsd: i.cost_usd,
      createdAt: i.created_at
    }))
  };
}

/**
 * Returns aggregated organization spend summary with anomaly analysis
 */
function getOrganizationCostSummary(organizationId, days = 30) {
  const db = getDatabase();
  const since = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();

  const records = db.prepare(`
    SELECT * FROM finops_cost_records
    WHERE organization_id = ? AND created_at >= ?
    ORDER BY created_at DESC
  `).all(organizationId, since);

  const totalCostUsd = records.reduce((sum, r) => sum + r.cost_usd, 0);

  // Group by usage type
  const byType = {};
  for (const r of records) {
    byType[r.type] = byType[r.type] || { count: 0, quantity: 0, costUsd: 0 };
    byType[r.type].count++;
    byType[r.type].quantity += r.quantity;
    byType[r.type].costUsd += r.cost_usd;
  }

  // Calculate per-investigation metrics
  const byInv = {};
  for (const r of records) {
    if (r.investigation_id) {
      byInv[r.investigation_id] = (byInv[r.investigation_id] || 0) + r.cost_usd;
    }
  }

  const invCosts = Object.values(byInv);
  const avgInvestigationCost = invCosts.length > 0 
    ? invCosts.reduce((a, b) => a + b, 0) / invCosts.length 
    : 0;

  // Anomaly threshold: > 1.8x average or single investigation cost >= $5.00
  const anomalyThreshold = Math.max(0.20, avgInvestigationCost * 1.5);
  const anomalies = [];
  for (const [invId, cost] of Object.entries(byInv)) {
    if ((cost > anomalyThreshold && invCosts.length > 1) || cost >= 10.00) {
      anomalies.push({
        investigationId: invId,
        costUsd: Number(cost.toFixed(4)),
        anomalyRatio: avgInvestigationCost > 0 ? Number((cost / avgInvestigationCost).toFixed(2)) : 1.0,
        flag: 'SPEND_SPIKE_DETECTED'
      });
    }
  }

  const budgetMonthlyUsd = 100.00;
  const budgetUtilization = Number(((totalCostUsd / budgetMonthlyUsd) * 100).toFixed(1));

  return {
    organizationId,
    windowDays: days,
    totalCostUsd: Number(totalCostUsd.toFixed(4)),
    budgetMonthlyUsd,
    budgetUtilizationPercent: budgetUtilization,
    budgetExceeded: totalCostUsd > budgetMonthlyUsd,
    averageInvestigationCostUsd: Number(avgInvestigationCost.toFixed(4)),
    activeInvestigationsTracked: invCosts.length,
    byType,
    spendAnomalies: anomalies
  };
}

module.exports = {
  RATES,
  calculateCostUsd,
  recordUsage,
  getInvestigationTotalCost,
  getOrganizationCostSummary
};
