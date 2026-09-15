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

module.exports = {
  calculateFreshness,
  searchMemories
};
