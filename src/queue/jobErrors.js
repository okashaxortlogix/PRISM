// PRISM Asynchronous Job Queue Error Taxonomy & Classification
// Aligned with P1-01 Error Taxonomy Specification

const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
  DEPENDENCY_ERROR: 'DEPENDENCY_ERROR',
  TIMEOUT: 'TIMEOUT',
  RESOURCE_LIMIT: 'RESOURCE_LIMIT',
  TRANSIENT_ERROR: 'TRANSIENT_ERROR',
  PERMANENT_ERROR: 'PERMANENT_ERROR',
  CANCELLED: 'CANCELLED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

// Explicit mapping of retryability per error code
const RETRYABLE_CODES = new Set([
  ERROR_CODES.DEPENDENCY_ERROR,
  ERROR_CODES.TIMEOUT,
  ERROR_CODES.RESOURCE_LIMIT,
  ERROR_CODES.TRANSIENT_ERROR,
  ERROR_CODES.UNKNOWN_ERROR
]);

class JobError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'JobError';
    this.code = code || ERROR_CODES.UNKNOWN_ERROR;
    this.isRetryable = options.isRetryable !== undefined 
      ? options.isRetryable 
      : RETRYABLE_CODES.has(this.code);
    this.details = options.details || null;
    if (options.cause) {
      this.cause = options.cause;
    }
  }
}

/**
  * Classifies an arbitrary caught error into a standardized JobError
  */
function classifyError(err) {
  if (err instanceof JobError) {
    return err;
  }

  const message = err.message || String(err);

  if (message.includes('NOT_FOUND') || message.includes('not found') || message.includes('VALIDATION') || message.includes('Invalid')) {
    return new JobError(ERROR_CODES.VALIDATION_ERROR, message, { isRetryable: false, cause: err });
  }

  if (message.includes('FORBIDDEN') || message.includes('UNAUTHORIZED') || message.includes('Tenant') || message.includes('isolation')) {
    return new JobError(ERROR_CODES.AUTHORIZATION_ERROR, message, { isRetryable: false, cause: err });
  }

  if (message.includes('CANCELLED') || message.includes('canceled') || message.includes('abort')) {
    return new JobError(ERROR_CODES.CANCELLED, message, { isRetryable: false, cause: err });
  }

  if (message.includes('TIMEOUT') || message.includes('timed out') || message.includes('ETIMEDOUT') || message.includes('ECONNRESET')) {
    return new JobError(ERROR_CODES.TIMEOUT, message, { isRetryable: true, cause: err });
  }

  if (message.includes('RESOURCE_LIMIT') || message.includes('quota') || message.includes('rate limit')) {
    return new JobError(ERROR_CODES.RESOURCE_LIMIT, message, { isRetryable: true, cause: err });
  }

  if (message.includes('SQLITE_BUSY') || message.includes('database locked')) {
    return new JobError(ERROR_CODES.TRANSIENT_ERROR, message, { isRetryable: true, cause: err });
  }

  return new JobError(ERROR_CODES.UNKNOWN_ERROR, message, { isRetryable: true, cause: err });
}

/**
 * Calculates exponential backoff with full jitter to avoid thundering herds
 * Delay = min(maxDelayMs, (2^(attempt - 1) * baseDelayMs) + random_jitter)
 */
function calculateBackoff(attempt, baseDelayMs = 1000, maxDelayMs = 60000) {
  const expFactor = Math.pow(2, Math.max(0, attempt - 1));
  const rawDelay = expFactor * baseDelayMs;
  const cappedDelay = Math.min(rawDelay, maxDelayMs);
  const jitter = Math.floor(Math.random() * (cappedDelay * 0.2));
  return cappedDelay + jitter;
}

module.exports = {
  ERROR_CODES,
  RETRYABLE_CODES,
  JobError,
  classifyError,
  calculateBackoff
};
