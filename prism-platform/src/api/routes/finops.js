// PRISM FinOps API Route
// Exposes durable investigation cost ledger, organization spend summary, and budget analytics
const express = require('express');
const router = express.Router();
const { authenticate } = require('../../security/authMiddleware');
const { getScopedInvestigation } = require('../../security/tenantGuard');
const { getInvestigationTotalCost, getOrganizationCostSummary } = require('../../finops/costTracker');

// All FinOps endpoints require authentication
router.use(authenticate);

// GET /api/v1/investigations/:id/cost
router.get('/investigations/:id/cost', (req, res) => {
  try {
    const inv = getScopedInvestigation(req.params.id, req.organization.id);
    if (!inv) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Investigation not found.' } });
    }

    const costData = getInvestigationTotalCost(inv.id, req.organization.id);
    res.json({ success: true, data: costData });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

// GET /api/v1/finops/summary?days=30
router.get('/finops/summary', (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    const summary = getOrganizationCostSummary(req.organization.id, days);
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

module.exports = router;
