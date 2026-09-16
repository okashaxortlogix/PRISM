// PRISM Platform Server
const express = require('express');
const cors = require('cors');
const path = require('node:path');
const { initDatabase } = require('./db/database');
const { seedData } = require('./db/seed');

const authRouter = require('./api/routes/auth');
const investigationsRouter = require('./api/routes/investigations');
const evidenceRouter = require('./api/routes/evidence');
const hypothesesRouter = require('./api/routes/hypotheses');
const experimentsRouter = require('./api/routes/experiments');
const verificationsRouter = require('./api/routes/verifications');
const rootCausesRouter = require('./api/routes/rootCauses');
const recommendationsRouter = require('./api/routes/recommendations');
const projectsRouter = require('./api/routes/projects');
const memoriesRouter = require('./api/routes/memories');
const auditRouter = require('./api/routes/audit');
const reportsRouter = require('./api/routes/reports');
const integrationsRouter = require('./api/routes/integrations');
const jobsRouter = require('./api/routes/jobs');
const repositoriesRouter = require('./api/routes/repositories');
const finopsRouter = require('./api/routes/finops');
const { defaultWorker } = require('./queue/jobWorker');
const { trackRequest, getPrometheusMetrics } = require('./observability/metrics');

const app = express();
const PORT = process.env.PORT || 3300;

// Initialize Database & Seed fixtures
initDatabase();
seedData();

// Security & Parsing Middleware
app.use(cors());
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true }));

// Metrics & Tracing middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    trackRequest(req.method, req.path, Date.now() - start, res.statusCode);
  });
  next();
});

// Static assets for UI
app.use(express.static(path.join(__dirname, '../public')));

// Public & Inbound Webhook APIs (Cryptographically verified at endpoint)
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/integrations', integrationsRouter);

// Domain & Protected Investigation APIs
app.use('/api/v1/investigations', investigationsRouter);
app.use('/api/v1/projects', projectsRouter);
app.use('/api/v1/memories', memoriesRouter);
app.use('/api/v1/audit', auditRouter);
app.use('/api/v1', evidenceRouter);
app.use('/api/v1', hypothesesRouter);
app.use('/api/v1', experimentsRouter);
app.use('/api/v1', verificationsRouter);
app.use('/api/v1', rootCausesRouter);
app.use('/api/v1', recommendationsRouter);
app.use('/api/v1', reportsRouter);
app.use('/api/v1', finopsRouter);
app.use('/api/v1/jobs', jobsRouter);
app.use('/api/v1/repositories', repositoriesRouter);

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'HEALTHY',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    system: 'PRISM Engineering Investigation Platform'
  });
});

// Prometheus Metrics Endpoint
app.get('/metrics', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4');
  res.send(getPrometheusMetrics());
});

// Centralized error handling (prevents internal stack trace leakage)
app.use((err, req, res, next) => {
  console.error('[PRISM Error]', err);
  res.status(err.status || 500).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'An unexpected error occurred.'
    }
  });
});

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`=====================================================`);
    console.log(`🚀 PRISM Platform running on http://localhost:${PORT}`);
    console.log(`🔒 Real Authentication & Tenant Isolation Active`);
    console.log(`⚡ Asynchronous Job Queue & Background Worker Active`);
    console.log(`=====================================================`);

    // Start background worker
    defaultWorker.start();
  });

  const shutdown = async (signal) => {
    console.log(`\nReceived ${signal}. Shutting down PRISM platform gracefully...`);
    await defaultWorker.stop();
    server.close(() => {
      console.log('PRISM HTTP server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
