// PRISM Memory Engine
// Reusable incident memory, semantic search, and freshness scoring

/**
 * Calculates time-decay freshness score for an incident memory
 * Half-life of 90 days
 */
function calculateFreshness(createdAt, halfLifeDays = 90) {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const freshness = Math.pow(0.5, ageDays / halfLifeDays);
  return Math.max(0.1, Math.min(1.0, Number(freshness.toFixed(3))));
}

/**
 * Ranks historical memories based on keyword similarity and freshness
 */
function searchMemories(memories, query) {
  if (!query) return memories;
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

  return memories
    .map(mem => {
      const text = `${mem.title} ${mem.summary} ${mem.root_cause} ${mem.resolution} ${mem.tags}`.toLowerCase();
      let matchCount = 0;
      for (const term of terms) {
        if (text.includes(term)) {
          matchCount++;
        }
      }
      const freshness = calculateFreshness(mem.created_at);
      const score = matchCount > 0 ? ((matchCount * 1.5) + (freshness * 0.5)) : 0;

      return {
        ...mem,
        relevanceScore: Number(score.toFixed(2)),
        freshness,
        matchCount
      };
    })
    .filter(m => m.matchCount > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/**
 * Semantic vector search for historical memories using dense embeddings
 */
function semanticSearchMemories(memories, query, minSimilarity = 0.05) {
  if (!query || !Array.isArray(memories) || memories.length === 0) return memories;
  const { generateEmbedding, cosineSimilarity } = require('../ai/embeddings');

  const queryVector = generateEmbedding(query);

  return memories
    .map(mem => {
      const memText = `${mem.title} ${mem.summary} ${mem.root_cause} ${mem.resolution} ${mem.tags || ''}`;
      const memVector = mem.embedding ? (typeof mem.embedding === 'string' ? JSON.parse(mem.embedding) : mem.embedding) : generateEmbedding(memText);
      const similarity = cosineSimilarity(queryVector, memVector);
      const freshness = calculateFreshness(mem.created_at);
      const compositeScore = Number(((similarity * 0.7) + (freshness * 0.3)).toFixed(3));

      return {
        ...mem,
        similarity,
        freshness,
        compositeScore,
        is_current_truth: false,
        provenance_type: 'HISTORICAL_ARCHIVE',
        retrieval_disclaimer: 'Historical incident memory provided for comparative reference only; verify against current environment.'
      };
    })
    .filter(m => m.similarity >= minSimilarity)
    .sort((a, b) => b.compositeScore - a.compositeScore);
}

module.exports = {
  calculateFreshness,
  searchMemories,
  semanticSearchMemories
};
