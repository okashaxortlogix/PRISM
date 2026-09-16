/**
 * PRISM Vector Embeddings & Semantic Similarity Engine (P2-01)
 * Provides dense normalized vector embeddings and cosine similarity computation.
 */
const crypto = require('crypto');

const EMBEDDING_DIMENSION = 64;

/**
 * Computes a normalized dense vector embedding for arbitrary text
 * Uses feature hashing with n-grams and term weighting
 * @param {string} text
 * @returns {number[]} Normalized 64-element float vector
 */
function generateEmbedding(text) {
  if (!text || typeof text !== 'string') {
    return new Array(EMBEDDING_DIMENSION).fill(0);
  }

  const normalized = text.toLowerCase().replace(/[^a-z0-9\s_-]/g, ' ');
  const words = normalized.split(/\s+/).filter(Boolean);
  const vector = new Array(EMBEDDING_DIMENSION).fill(0);

  // Technical synonyms expansion dictionary
  const SYNONYM_MAP = {
    'oom': 'memory leak heap overflow allocation',
    'leak': 'memory uncollected garbage retain',
    'timeout': 'latency deadline slow delay contention lock pool',
    'deadlock': 'concurrency race thread lock transaction',
    'auth': 'token signature credential permission unauthorized 401 403',
    'crash': 'fatal unhandled exception panic error exit',
    'webhook': 'hmac replay delivery signature digest payload'
  };

  const expandedTokens = [...words];
  for (const w of words) {
    if (SYNONYM_MAP[w]) {
      expandedTokens.push(...SYNONYM_MAP[w].split(' '));
    }
  }

  // Hash each token and bigram into vector bins with term frequency weights
  for (let i = 0; i < expandedTokens.length; i++) {
    const token = expandedTokens[i];
    const hash = crypto.createHash('sha256').update(token).digest();
    const bin = hash[0] % EMBEDDING_DIMENSION;
    vector[bin] += 1.0 + (token.length > 4 ? 0.5 : 0);

    // Bigram
    if (i < expandedTokens.length - 1) {
      const bigram = `${token}_${expandedTokens[i + 1]}`;
      const biHash = crypto.createHash('sha256').update(bigram).digest();
      const biBin = biHash[0] % EMBEDDING_DIMENSION;
      vector[biBin] += 1.2;
    }
  }

  // L2 Normalize
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);

  if (norm > 0) {
    for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
      vector[i] = Number((vector[i] / norm).toFixed(6));
    }
  }

  return vector;
}

/**
 * Computes cosine similarity between two normalized vectors
 * Returns value between -1.0 and 1.0 (clamped to 0.0 - 1.0 for positive similarity)
 * @param {number[]} vecA
 * @param {number[]} vecB
 * @returns {number}
 */
function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length) {
    return 0.0;
  }

  let dotProduct = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
  }

  return Math.max(0.0, Math.min(1.0, Number(dotProduct.toFixed(4))));
}

module.exports = {
  EMBEDDING_DIMENSION,
  generateEmbedding,
  cosineSimilarity
};
