// PRISM Background Job Worker Architecture
// Aligned with P1-01 Specification: Lifecycle management, concurrent execution, heartbeats, and graceful shutdown
const crypto = require('node:crypto');
const { jobQueue, JOB_STATUSES, JOB_TYPES } = require('./jobQueue');
const { handleInvestigationJob } = require('./handlers/investigationHandler');
const { handleReportJob } = require('./handlers/reportHandler');
const { handleHypothesisJob } = require('./handlers/hypothesisHandler');
const { handleEvidenceJob } = require('./handlers/evidenceHandler');
const { JobError, ERROR_CODES } = require('./jobErrors');

const WORKER_STATES = {
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  STOPPING: 'STOPPING',
  STOPPED: 'STOPPED'
};

class JobWorker {
  constructor(options = {}) {
    this.id = options.workerId || `worker_${crypto.randomUUID().substring(0, 8)}`;
    this.queue = options.queue || jobQueue;
    this.concurrency = options.concurrency || 2;
    this.pollIntervalMs = options.pollIntervalMs || 500;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || 5000;
    this.recoveryIntervalMs = options.recoveryIntervalMs || 30000;
    this.staleThresholdMs = options.staleThresholdMs || 30000;
    this.types = options.types || Object.values(JOB_TYPES);

    this.state = WORKER_STATES.STOPPED;
    this.pollTimer = null;
    this.recoveryTimer = null;
    this.activeJobs = new Map(); // jobId -> { job, heartbeatTimer, cancelRequested }
    this.handlers = new Map();

    // Register built-in handlers
    this.registerHandler(JOB_TYPES.INVESTIGATION, handleInvestigationJob);
    this.registerHandler(JOB_TYPES.REPORT_GENERATION, handleReportJob);
    this.registerHandler(JOB_TYPES.HYPOTHESIS_EVALUATION, handleHypothesisJob);
    this.registerHandler(JOB_TYPES.EVIDENCE_COLLECTION, handleEvidenceJob);
  }

  registerHandler(type, handlerFn) {
    if (typeof handlerFn !== 'function') {
      throw new Error(`Handler for ${type} must be a function`);
    }
    this.handlers.set(type, handlerFn);
  }

  start() {
    if (this.state === WORKER_STATES.RUNNING || this.state === WORKER_STATES.STARTING) {
      return;
    }

    this.state = WORKER_STATES.STARTING;
    console.log(`[JobWorker ${this.id}] Starting worker with concurrency ${this.concurrency}...`);

    this.state = WORKER_STATES.RUNNING;

    // Start background polling loop
    this._scheduleNextPoll(10);

    // Start background stale job recovery loop
    this.recoveryTimer = setInterval(() => {
      try {
        const recovered = this.queue.recoverStaleJobs(this.staleThresholdMs);
        if (recovered > 0) {
          console.log(`[JobWorker ${this.id}] Recovered ${recovered} stale job(s).`);
        }
      } catch (err) {
        console.error(`[JobWorker ${this.id}] Stale recovery error:`, err);
      }
    }, this.recoveryIntervalMs);
  }

  async stop(graceTimeoutMs = 5000) {
    if (this.state === WORKER_STATES.STOPPED || this.state === WORKER_STATES.STOPPING) {
      return;
    }

    console.log(`[JobWorker ${this.id}] Initiating graceful shutdown...`);
    this.state = WORKER_STATES.STOPPING;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }

    // Signal all currently executing jobs to cancel or finish
    for (const [jobId, jobMeta] of this.activeJobs.entries()) {
      jobMeta.cancelRequested = true;
      if (jobMeta.heartbeatTimer) {
        clearInterval(jobMeta.heartbeatTimer);
      }
    }

    // Wait for active jobs to complete up to graceTimeoutMs
    const startWait = Date.now();
    while (this.activeJobs.size > 0 && (Date.now() - startWait) < graceTimeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.state = WORKER_STATES.STOPPED;
    console.log(`[JobWorker ${this.id}] Shutdown complete. Active jobs remaining: ${this.activeJobs.size}`);
  }

  _scheduleNextPoll(delayMs = this.pollIntervalMs) {
    if (this.state !== WORKER_STATES.RUNNING) {
      return;
    }

    this.pollTimer = setTimeout(async () => {
      await this._pollAndExecute();
      this._scheduleNextPoll();
    }, delayMs);
  }

  async _pollAndExecute() {
    if (this.state !== WORKER_STATES.RUNNING) {
      return;
    }

    const availableSlots = this.concurrency - this.activeJobs.size;
    if (availableSlots <= 0) {
      return;
    }

    try {
      const claimedJobs = this.queue.claim(this.id, {
        types: this.types,
        batchSize: availableSlots
      });

      for (const job of claimedJobs) {
        this._executeJob(job);
      }
    } catch (err) {
      console.error(`[JobWorker ${this.id}] Error claiming jobs:`, err);
    }
  }

  async _executeJob(job) {
    const jobMeta = {
      job,
      cancelRequested: false,
      heartbeatTimer: null
    };

    this.activeJobs.set(job.id, jobMeta);

    // Setup periodic lease heartbeat
    jobMeta.heartbeatTimer = setInterval(() => {
      try {
        this.queue.heartbeat(job.id, this.id);
      } catch (err) {
        console.error(`[JobWorker ${this.id}] Heartbeat error on job ${job.id}:`, err);
      }
    }, this.heartbeatIntervalMs);

    try {
      console.log(`[JobWorker ${this.id}] Executing job ${job.id} (type: ${job.type}, attempt: ${job.attempt_count})...`);

      const handler = this.handlers.get(job.type);
      if (!handler) {
        throw new JobError(ERROR_CODES.VALIDATION_ERROR, `No worker handler registered for job type: ${job.type}`, { isRetryable: false });
      }

      const checkCancellation = () => {
        if (jobMeta.cancelRequested) return true;
        const current = this.queue.getJob(job.id);
        return current && current.status === JOB_STATUSES.CANCELLED;
      };

      const result = await handler(job, {
        queue: this.queue,
        workerId: this.id,
        checkCancellation
      });

      // Clear heartbeat before finalizing
      if (jobMeta.heartbeatTimer) {
        clearInterval(jobMeta.heartbeatTimer);
        jobMeta.heartbeatTimer = null;
      }

      // Complete job
      this.queue.complete(job.id, result);
      console.log(`[JobWorker ${this.id}] Job ${job.id} SUCCEEDED.`);
    } catch (err) {
      if (jobMeta.heartbeatTimer) {
        clearInterval(jobMeta.heartbeatTimer);
        jobMeta.heartbeatTimer = null;
      }

      const failResult = this.queue.fail(job.id, err);
      if (failResult.retrying) {
        console.log(`[JobWorker ${this.id}] Job ${job.id} failed, scheduled for retry (attempt ${failResult.attempt}/${failResult.maxAttempts}) at ${failResult.nextScheduledAt}. Error: ${err.message}`);
      } else {
        console.error(`[JobWorker ${this.id}] Job ${job.id} terminated with final status ${failResult.status}. Error: ${err.message}`);
      }
    } finally {
      this.activeJobs.delete(job.id);
    }
  }
}

// Global default worker instance
const defaultWorker = new JobWorker();

module.exports = {
  JobWorker,
  defaultWorker,
  WORKER_STATES
};
