// PRISM Password Service
// Secure, zero-external-dependency password hashing using Node 24 native crypto.scrypt
const crypto = require('node:crypto');

const SCRYPT_CONFIG = {
  N: 16384, // CPU/memory cost factor
  r: 8,     // Block size
  p: 1,     // Parallelization
  keyLen: 64
};

/**
 * Validates password complexity: minimum 8 characters, mixed case, at least one number
 */
function validatePasswordStrength(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password is required.' };
  }
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long.' };
  }
  if (password.length > 128) {
    return { valid: false, message: 'Password must not exceed 128 characters.' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter.' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one number.' };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one special character.' };
  }
  return { valid: true };
}

/**
 * Hashes a plaintext password with a random 16-byte salt using scrypt
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, SCRYPT_CONFIG.keyLen, {
    N: SCRYPT_CONFIG.N,
    r: SCRYPT_CONFIG.r,
    p: SCRYPT_CONFIG.p
  });
  return `scrypt$N=${SCRYPT_CONFIG.N},r=${SCRYPT_CONFIG.r},p=${SCRYPT_CONFIG.p}$${salt}$${derivedKey.toString('hex')}`;
}

/**
 * Verifies a plaintext password against a stored scrypt hash using timing-safe comparison
 */
function verifyPassword(password, storedHash) {
  if (!password || !storedHash) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') {
    return false;
  }

  const salt = parts[2];
  const expectedHash = Buffer.from(parts[3], 'hex');

  const derivedKey = crypto.scryptSync(password, salt, expectedHash.length, {
    N: SCRYPT_CONFIG.N,
    r: SCRYPT_CONFIG.r,
    p: SCRYPT_CONFIG.p
  });

  if (derivedKey.length !== expectedHash.length) {
    return false;
  }

  return crypto.timingSafeEqual(derivedKey, expectedHash);
}

module.exports = {
  validatePasswordStrength,
  hashPassword,
  verifyPassword
};
