// PRISM Durable Asynchronous Job Queue
// Aligned with P1-01 Specification: Transactional claiming, priority scheduling, lease heartbeats, and bounded retries
const crypto = require('node:crypto');
const { getDatabase } = require('../db/database');
const { JobError, ERROR_CODES, classifyError, calculateBackoff } = require('./jobErrors');

const JOB_STATUSES = {
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  RETRYING: 'RETRYING',
  CANCELLED: 'CANCELLED',
  BLOCKED: 'BLOCKED',
  DEAD_LETTER: 'DEAD_LETTER'
};

const JOB_PRIORITIES = {
  HIGH: 'HIGH',
  NORMAL: 'NORMAL',
  LOW: 'LOW'
};

const JOB_TYPES = {
  INVESTIGATION: 'INVESTIGATION',
  REPORT_GENERATION: 'REPORT_GENERATION',
  EVIDENCE_COLLECTION: 'EVIDENCE_COLLECTION',
  HYPOTHESIS_EVALUATION: 'HYPOTHESIS_EVALUATION'
};

class JobQueue {
  constructor(options = {}) {
    this.defaultMaxAttempts = options.defaultMaxAttempts || 3;
    this.baseRetryDelayMs = options.baseRetryDelayMs || 1000;
    this.maxRetryDelayMs = options.maxRetryDelayMs || 60000;
  }

  get db() {
    return getDatabase();
  }

  /**
   * Enqueues a new job with tenant scoping, optional idempotency key, and priority
   */
  enqueue(options) {
    const {
      organizationId,
      projectId = null,
      investigationId = null,
      type,
      payload = {},
      priority = JOB_PRIORITIES.NORMAL,
      maxAttempts = this.defaultMaxAttempts,
      scheduledAt = new Date().toISOString(),
      idempotencyKey = null
    } = options;

    if (!organizationId) {
      throw new JobError(ERROR_CODES.AUTHORIZATION_ERROR, 'organizationId is mandatory for tenant isolation', { isRetryable: false });
    }

    if (!type || !Object.values(JOB_TYPES).includes(type)) {
      throw new JobError(ERROR_CODES.VALIDATION_ERROR, `Invalid job type: ${type}. Must be one of: ${Object.values(JOB_TYPES).join(', ')}`, { isRetryable: false });
    }

    if (!Object.values(JOB_PRIORITIES).includes(priority)) {
      throw new JobError(ERROR_CODES.VALIDATION_ERROR, `Invalid priority: ${priority}`, { isRetryable: false });
    }

    const db = this.db;

    // Check idempotency
    if (idempotencyKey) {
      const existing = db.prepare('SELECT * FROM jobs WHERE idempotency_key = ? AND organization_id = ?').get(idempotencyKey, organizationId);
      if (existing) {
        return this._formatJob(existing);
      }
    }

    const id = `job_${crypto.randomUUID().substring(0, 8)}`;
    const now = new Date().toISOString();
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);

    db.prepare(`
      INSERT INTO jobs (
        id, organization_id, project_id, investigation_id, type,
        status, priority, payload, attempt_count, max_attempts,
        scheduled_at, idempotency_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
    `).run(
      id,
      organizationId,
      projectId,
      investigationId,
      type,
      JOB_STATUSES.QUEUED,
      priority,
      payloadStr,
      maxAttempts,
      scheduledAt,
      idempotencyKey,
      now,
      now
    );

    const created = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    return this._formatJob(created);
  }

  /**
   * Atomically claims eligible jobs for a worker using transactional locking
   */
  claim(workerId, options = {}) {
    if (!workerId) {
      throw new Error('workerId is required to claim jobs');
    }

    const {
      types = [],
      batchSize = 1,
      now = new Date().toISOString()
    } = options;

    const db = this.db;
    const claimed = [];

    // Begin transaction for claim
    db.exec('BEGIN TRANSACTION;');
    try {
      let query = `
        SELECT id FROM jobs
        WHERE (status = '${JOB_STATUSES.QUEUED}' OR (status = '${JOB_STATUSES.RETRYING}' AND scheduled_at <= ?))
      `;
      const params = [now];

      if (types.length > 0) {
        const placeholders = types.map(() => '?').join(', ');
        query += ` AND type IN (${placeholders})`;
        params.push(...types);
      }

      // Priority ordering: HIGH (3) -> NORMAL (2) -> LOW (1), then earliest scheduled_at
      query += `
        ORDER BY 
          CASE priority
            WHEN '${JOB_PRIORITIES.HIGH}' THEN 3
            WHEN '${JOB_PRIORITIES.NORMAL}' THEN 2
            WHEN '${JOB_PRIORITIES.LOW}' THEN 1
            ELSE 0
          END DESC,
          scheduled_at ASC,
          created_at ASC
        LIMIT ?
      `;
      params.push(batchSize);

      const candidateRows = db.prepare(query).all(...params);

      for (const row of candidateRows) {
        // Atomic update checking that job has not been claimed concurrently
        const updateResult = db.prepare(`
          UPDATE jobs
          SET status = '${JOB_STATUSES.RUNNING}',
              worker_id = ?,
              started_at = COALESCE(started_at, ?),
              heartbeat_at = ?,
              attempt_count = attempt_count + 1,
              updated_at = ?
          WHERE id = ? AND (status = '${JOB_STATUSES.QUEUED}' OR status = '${JOB_STATUSES.RETRYING}')
        `).run(workerId, now, now, now, row.id);

        if (updateResult.changes > 0) {
          const claimedJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(row.id);
          claimed.push(this._formatJob(claimedJob));
        }
      }

      db.exec('COMMIT;');
      return claimed;
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }

  /**
   * Marks a job as SUCCEEDED with durable result payload
   */
  complete(jobId, result = {}) {
    const db = this.db;
    const now = new Date().toISOString();
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

    const update = db.prepare(`
      UPDATE jobs
      SET status = '${JOB_STATUSES.SUCCEEDED}',
          result = ?,
          completed_at = ?,
          updated_at = ?
      WHERE id = ? AND status = '${JOB_STATUSES.RUNNING}'
    `).run(resultStr, now, now, jobId);

    if (update.changes === 0) {
      // Check if job was cancelled while running
      const current = db.prepare('SELECT status FROM jobs WHERE id = ?').get(jobId);
      if (current && current.status === JOB_STATUSES.CANCELLED) {
        return { success: false, reason: 'JOB_ALREADY_CANCELLED' };
      }
    }

    return { success: true };
  }

  /**
   * Records job failure with bounded retries and exponential backoff
   */
  fail(jobId, error, options = {}) {
    const classified = classifyError(error);
    const db = this.db;
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);

    if (!job) {
      return { success: false, reason: 'JOB_NOT_FOUND' };
    }

    if (job.status === JOB_STATUSES.CANCELLED) {
      return { success: false, reason: 'JOB_CANCELLED' };
    }

    const now = new Date().toISOString();
    const isRetryable = options.isRetryable !== undefined ? options.isRetryable : classified.isRetryable;
    const canRetry = isRetryable && job.attempt_count < job.max_attempts;

    if (canRetry) {
      const delayMs = options.retryDelayMs || calculateBackoff(job.attempt_count, this.baseRetryDelayMs, this.maxRetryDelayMs);
      const nextScheduledAt = new Date(Date.now() + delayMs).toISOString();

      db.prepare(`
        UPDATE jobs
        SET status = '${JOB_STATUSES.RETRYING}',
            error_code = ?,
            error_message = ?,
            scheduled_at = ?,
            worker_id = NULL,
            updated_at = ?
        WHERE id = ?
      `).run(classified.code, classified.message, nextScheduledAt, now, jobId);

      return {
        success: true,
        retrying: true,
        attempt: job.attempt_count,
        maxAttempts: job.max_attempts,
        nextScheduledAt
      };
    } else {
      // If max attempts exhausted, transition to DEAD_LETTER; otherwise FAILED
      const finalStatus = job.attempt_count >= job.max_attempts 
        ? JOB_STATUSES.DEAD_LETTER 
        : JOB_STATUSES.FAILED;

      db.prepare(`
        UPDATE jobs
        SET status = ?,
            error_code = ?,
            error_message = ?,
            completed_at = ?,
            updated_at = ?
        WHERE id = ?
      `).run(finalStatus, classified.code, classified.message, now, now, jobId);

      return {
        success: true,
        retrying: false,
        status: finalStatus,
        error: classified.code
      };
    }
  }

  /**
   * Updates lease heartbeat for a running job
   */
  heartbeat(jobId, workerId) {
    const db = this.db;
    const now = new Date().toISOString();

    const result = db.prepare(`
      UPDATE jobs
      SET heartbeat_at = ?, updated_at = ?
      WHERE id = ? AND worker_id = ? AND status = '${JOB_STATUSES.RUNNING}'
    `).run(now, now, jobId, workerId);

    return result.changes > 0;
  }

  /**
   * Cooperatively cancels a job
   */
  cancel(jobId, reason = 'User requested cancellation', organizationId = null) {
    const db = this.db;
    const now = new Date().toISOString();

    let query = `
      UPDATE jobs
      SET status = '${JOB_STATUSES.CANCELLED}',
          error_code = '${ERROR_CODES.CANCELLED}',
          error_message = ?,
          completed_at = ?,
          updated_at = ?
      WHERE id = ? AND status IN ('${JOB_STATUSES.QUEUED}', '${JOB_STATUSES.RETRYING}', '${JOB_STATUSES.RUNNING}', '${JOB_STATUSES.BLOCKED}')
    `;
    const params = [reason, now, now, jobId];

    if (organizationId) {
      query += ' AND organization_id = ?';
      params.push(organizationId);
    }

    const update = db.prepare(query).run(...params);
    return update.changes > 0;
  }

  /**
   * Creates an execution checkpoint for progress tracking & resumability
   */
  checkpoint(jobId, phase, progressPct = 0, stateData = {}, checkpointType = 'PHASE_PROGRESS') {
    const db = this.db;
    const id = `chk_${crypto.randomUUID().substring(0, 8)}`;
    const now = new Date().toISOString();
    const dataStr = typeof stateData === 'string' ? stateData : JSON.stringify(stateData);

    db.prepare(`
      INSERT INTO job_checkpoints (id, job_id, checkpoint_type, phase, progress_pct, state_data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, jobId, checkpointType, phase, Math.min(100, Math.max(0, progressPct)), dataStr, now);

    return { id, phase, progressPct, createdAt: now };
  }

  /**
   * Retrieves all checkpoints for a job in chronological order
   */
  getCheckpoints(jobId) {
    const db = this.db;
    const rows = db.prepare('SELECT * FROM job_checkpoints WHERE job_id = ? ORDER BY created_at ASC').all(jobId);
    return rows.map(r => ({
      ...r,
      state_data: this._parseJson(r.state_data)
    }));
  }

  /**
   * Recovers stale jobs whose lease heartbeat has expired (crashed worker detection)
   */
  recoverStaleJobs(staleThresholdMs = 30000) {
    const db = this.db;
    const cutoff = new Date(Date.now() - staleThresholdMs).toISOString();
    const now = new Date().toISOString();

    const staleJobs = db.prepare(`
      SELECT * FROM jobs
      WHERE status = '${JOB_STATUSES.RUNNING}' AND (heartbeat_at IS NULL OR heartbeat_at < ?)
    `).all(cutoff);

    let recoveredCount = 0;
    for (const job of staleJobs) {
      if (job.attempt_count < job.max_attempts) {
        db.prepare(`
          UPDATE jobs
          SET status = '${JOB_STATUSES.RETRYING}',
              error_code = 'WORKER_HEARTBEAT_EXPIRED',
              error_message = 'Worker lease heartbeat expired beyond threshold',
              scheduled_at = ?,
              worker_id = NULL,
              updated_at = ?
          WHERE id = ?
        `).run(now, now, job.id);
        recoveredCount++;
      } else {
        db.prepare(`
          UPDATE jobs
          SET status = '${JOB_STATUSES.DEAD_LETTER}',
              error_code = 'MAX_ATTEMPTS_EXCEEDED_AFTER_CRASH',
              error_message = 'Worker crashed and max attempts reached',
              completed_at = ?,
              worker_id = NULL,
              updated_at = ?
          WHERE id = ?
        `).run(now, now, job.id);
        recoveredCount++;
      }
    }

    return recoveredCount;
  }

  /**
   * Retrieves a job by ID, strictly scoped to organization tenant if provided
   */
  getJob(jobId, organizationId = null) {
    const db = this.db;
    let query = 'SELECT * FROM jobs WHERE id = ?';
    const params = [jobId];

    if (organizationId) {
      query += ' AND organization_id = ?';
      params.push(organizationId);
    }

    const row = db.prepare(query).get(...params);
    if (!row) return null;

    const formatted = this._formatJob(row);
    formatted.checkpoints = this.getCheckpoints(jobId);
    return formatted;
  }

  /**
   * Lists jobs with tenant isolation and optional filters
   */
  listJobs(options = {}) {
    const {
      organizationId,
      status,
      type,
      investigationId,
      limit = 50,
      offset = 0
    } = options;

    if (!organizationId) {
      throw new JobError(ERROR_CODES.AUTHORIZATION_ERROR, 'organizationId is mandatory for listing jobs', { isRetryable: false });
    }

    const db = this.db;
    let query = 'SELECT * FROM jobs WHERE organization_id = ?';
    const params = [organizationId];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }
    if (investigationId) {
      query += ' AND investigation_id = ?';
      params.push(investigationId);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = db.prepare(query).all(...params);
    return rows.map(r => this._formatJob(r));
  }

  _formatJob(row) {
    if (!row) return null;
    return {
      id: row.id,
      organization_id: row.organization_id,
      project_id: row.project_id,
      investigation_id: row.investigation_id,
      type: row.type,
      status: row.status,
      priority: row.priority,
      payload: this._parseJson(row.payload),
      result: this._parseJson(row.result),
      error_code: row.error_code,
      error_message: row.error_message,
      attempt_count: row.attempt_count,
      max_attempts: row.max_attempts,
      scheduled_at: row.scheduled_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
      heartbeat_at: row.heartbeat_at,
      worker_id: row.worker_id,
      idempotency_key: row.idempotency_key,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  _parseJson(val) {
    if (!val) return null;
    if (typeof val === 'object') return val;
    try {
      return JSON.parse(val);
    } catch (_) {
      return val;
    }
  }
}

// Global queue singleton
const jobQueue = new JobQueue();

module.exports = {
  JobQueue,
  jobQueue,
  JOB_STATUSES,
  JOB_PRIORITIES,
  JOB_TYPES
};
