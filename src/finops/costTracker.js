// PRISM FinOps & Cloud Cost Tracker
// Aligned with 15-FINOPS/FINOPS-SPEC.md

const RATES = {
  MODEL_INPUT_PER_1K: 0.00015,
  MODEL_OUTPUT_PER_1K: 0.00060,
  SANDBOX_COMPUTE_PER_MINUTE: 0.0025,
  STORAGE_PER_GB_MONTH: 0.02
};

const usageLedger = [];

function recordUsage(investigationId, type, quantity) {
  let cost = 0;
  if (type === 'MODEL_INPUT_TOKENS') {
    cost = (quantity / 1000) * RATES.MODEL_INPUT_PER_1K;
  } else if (type === 'MODEL_OUTPUT_TOKENS') {
    cost = (quantity / 1000) * RATES.MODEL_OUTPUT_PER_1K;
  } else if (type === 'SANDBOX_SECONDS') {
    cost = (quantity / 60) * RATES.SANDBOX_COMPUTE_PER_MINUTE;
  }

  const record = {
    id: `cost_${Date.now()}`,
    investigationId,
    type,
    quantity,
    costUsd: Number(cost.toFixed(5)),
    timestamp: new Date().toISOString()
  };

  usageLedger.push(record);
  return record;
}

function getInvestigationTotalCost(investigationId) {
  const items = usageLedger.filter(u => u.investigationId === investigationId);
  const total = items.reduce((sum, item) => sum + item.costUsd, 0);
  return {
    investigationId,
    totalCostUsd: Number(total.toFixed(4)),
    breakdown: items
  };
}

module.exports = {
  recordUsage,
  getInvestigationTotalCost,
  RATES
};
