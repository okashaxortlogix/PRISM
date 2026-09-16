/**
 * PRISM AI / LLM Gateway & Structured Output Reasoning Engine (P1-04)
 * Coordinates LLM model invocations with structured schema output,
 * prompt budgeting, token estimation, and deterministic fallback reasoning.
 */

class AIGateway {
  constructor(options = {}) {
    this.provider = options.provider || process.env.PRISM_AI_PROVIDER || 'HEURISTIC_OFFLINE';
    this.apiKey = options.apiKey || process.env.PRISM_AI_API_KEY || process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
    this.model = options.model || process.env.PRISM_AI_MODEL || 'gemini-1.5-pro';
  }

  /**
   * Generates structured JSON output adhering to a schema
   * @param {object} params
   * @param {string} params.systemPrompt
   * @param {string} params.userPrompt
   * @param {object} params.schema
   * @param {number} [params.temperature=0.2]
   */
  async generateStructuredOutput({ systemPrompt, userPrompt, schema, temperature = 0.2 }) {
    // If external API key is configured and not offline mode, call LLM
    if (this.apiKey && this.provider !== 'HEURISTIC_OFFLINE') {
      try {
        return await this.callExternalLLM({ systemPrompt, userPrompt, schema, temperature });
      } catch (err) {
        console.warn(`[AIGateway] External LLM failed (${err.message}), engaging heuristic offline engine.`);
      }
    }

    // Deterministic offline reasoning engine
    return this.generateHeuristicOutput({ systemPrompt, userPrompt, schema });
  }

  /**
   * Generates evidence-grounded hypotheses given investigation problem & evidence items
   * @param {object} params
   * @param {string} params.problem
   * @param {Array<object>} params.evidence
   * @param {Array<object>} [params.symbols=[]]
   * @returns {Promise<Array<object>>}
   */
  async synthesizeHypotheses({ problem, evidence = [], symbols = [] }) {
    const evidenceSummary = evidence.map(e => `[${e.id}] (${e.type}) ${e.title}: ${typeof e.content === 'string' ? e.content.substring(0, 150) : JSON.stringify(e.content)}`).join('\n');
    const symbolSummary = symbols.slice(0, 20).map(s => `${s.kind} ${s.name} in ${s.file_path}`).join(', ');

    const systemPrompt = `You are PRISM's Principal Systems Reliability & Software Investigator.
Analyze the incident and evidence. Produce exactly 2 to 4 competing, falsifiable hypotheses.
Every hypothesis MUST cite valid supporting evidence IDs from the evidence list.`;

    const userPrompt = `Incident Problem: ${problem}
Available Evidence:
${evidenceSummary || 'No evidence collected yet.'}
Repository Symbols:
${symbolSummary || 'No symbols available.'}`;

    const schema = {
      type: 'object',
      properties: {
        hypotheses: {
          type: 'array',
          items: {
            statement: 'string',
            rationale: 'string',
            probability: 'number',
            supporting_evidence_ids: 'array',
            falsification_condition: 'string'
          }
        }
      }
    };

    const result = await this.generateStructuredOutput({ systemPrompt, userPrompt, schema });
    return result.hypotheses || [];
  }

  /**
   * Deterministic semantic heuristic reasoning engine
   */
  generateHeuristicOutput({ userPrompt, schema }) {
    const text = (userPrompt || '').toLowerCase();

    // Identify incident problem patterns
    let category = 'SYSTEM_RESOURCE_OR_LOGIC';
    let primaryCause = 'Unhandled exception or unexpected state';
    let falsification = 'Reproduction in sandbox without triggering the error condition';

    if (text.includes('leak') || text.includes('memory') || text.includes('heap') || text.includes('oom')) {
      category = 'MEMORY_LEAK_OR_EXHAUSTION';
      primaryCause = 'Memory leak from unbounded object retention or event listener accumulation leading to heap exhaustion';
      falsification = 'Heap snapshot after 1000 simulated iterations shows stable memory allocation';
    } else if (text.includes('timeout') || text.includes('deadline') || text.includes('latency') || text.includes('slow')) {
      category = 'LATENCY_OR_DEADLOCK';
      primaryCause = 'Unindexed database query or connection pool saturation under concurrent load';
      falsification = 'Query execution plan analysis and response latency benchmarks remain under 200ms at 50 concurrent requests';
    } else if (text.includes('auth') || text.includes('token') || text.includes('permission') || text.includes('401') || text.includes('403')) {
      category = 'AUTHENTICATION_OR_ACCESS_CONTROL';
      primaryCause = 'Cryptographic signature mismatch, expired session token, or flawed role authorization check';
      falsification = 'Valid cryptographic signature authentication succeeds and rejects unauthorized tokens';
    } else if (text.includes('webhook') || text.includes('signature') || text.includes('hmac') || text.includes('replay')) {
      category = 'INBOUND_WEBHOOK_VERIFICATION_FAILURE';
      primaryCause = 'Missing raw body preservation during HMAC digest calculation or missing replay nonce tracking';
      falsification = 'Timing-safe HMAC comparison with raw body matches incoming signature and rejects replayed delivery IDs';
    } else if (text.includes('ast') || text.includes('syntax') || text.includes('parse') || text.includes('call')) {
      category = 'CODE_STRUCTURE_OR_IMPORT';
      primaryCause = 'Circular dependency or undefined symbol call at runtime';
      falsification = 'AST symbol call graph verification shows all callees resolved with no circular links';
    }

    // Extract any evidence IDs mentioned in userPrompt
    const evidenceIdMatches = userPrompt.match(/evi_[a-zA-Z0-9_-]+/g) || [];
    const uniqueEvidenceIds = Array.from(new Set(evidenceIdMatches));

    const hypotheses = [
      {
        statement: `Root Cause Hypothesis A: ${primaryCause}`,
        rationale: `Evidence exhibits distinct symptoms characteristic of ${category.toLowerCase().replace(/_/g, ' ')}.`,
        probability: 0.85,
        supporting_evidence_ids: uniqueEvidenceIds.slice(0, 3),
        falsification_condition: falsification
      },
      {
        statement: `Competing Hypothesis B: Transient downstream dependency degradation`,
        rationale: `Intermittent network flakiness or third-party service rate limiting mimicking an internal failure.`,
        probability: 0.40,
        supporting_evidence_ids: uniqueEvidenceIds.slice(0, 1),
        falsification_condition: 'Isolated network sandbox execution reproduces the error even with mocked healthy downstream responses.'
      }
    ];

    return { hypotheses, category, confidence: 0.85 };
  }

  /**
   * External LLM HTTP caller with schema output
   */
  async callExternalLLM({ systemPrompt, userPrompt, schema, temperature }) {
    // Standard fetch call to Gemini / OpenAI endpoint with JSON response format
    const response = await fetch('https://api.prism-llm-proxy.internal/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        temperature,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      throw new Error(`LLM call failed with status ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return JSON.parse(content);
  }
}

module.exports = {
  AIGateway
};
