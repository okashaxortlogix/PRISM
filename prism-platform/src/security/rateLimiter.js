// PRISM In-Memory Sliding-Window Rate Limiter
// Protects sensitive authentication endpoints against brute force and credential stuffing

class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 15 * 60 * 1000; // 15 minutes default
    this.maxRequests = options.maxRequests || 10;        // 10 requests per window default
    this.message = options.message || 'Too many requests. Please try again later.';
    this.hits = new Map();

    // Clean up stale entries every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  cleanup() {
    const now = Date.now();
    for (const [key, timestamps] of this.hits.entries()) {
      const activeTimestamps = timestamps.filter(t => now - t < this.windowMs);
      if (activeTimestamps.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, activeTimestamps);
      }
    }
  }

  middleware() {
    return (req, res, next) => {
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
      const key = `${req.path}_${ip}`;
      const now = Date.now();

      const timestamps = this.hits.get(key) || [];
      const activeTimestamps = timestamps.filter(t => now - t < this.windowMs);

      if (activeTimestamps.length >= this.maxRequests) {
        const retryAfterSeconds = Math.ceil((activeTimestamps[0] + this.windowMs - now) / 1000);
        res.setHeader('Retry-After', retryAfterSeconds);
        return res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: this.message,
            retryAfterSeconds
          }
        });
      }

      activeTimestamps.push(now);
      this.hits.set(key, activeTimestamps);
      next();
    };
  }
}

const loginRateLimiter = new RateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 15,
  message: 'Too many login attempts. Please wait 15 minutes before trying again.'
});

const registerRateLimiter = new RateLimiter({
  windowMs: 60 * 60 * 1000,
  maxRequests: 10,
  message: 'Too many accounts registered from this IP. Please try again later.'
});

module.exports = {
  RateLimiter,
  loginRateLimiter,
  registerRateLimiter
};
