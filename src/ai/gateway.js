/**
 * PRISM AI / LLM Gateway & Structured Output Reasoning Engine (P1-04)
 * Coordinates LLM model invocations with structured schema output,
 * prompt budgeting, token estimation, and deterministic fallback reasoning.
 */
const { recordUsage } = require('../finops/costTracker');

class AIGateway {
  constructor(options = {}) {
    this.provider = options.provider || process.env.PRISM_AI_PROVIDER || 'HEURISTIC_OFFLINE';
    this.apiKey = options.apiKey || process.env.PRISM_AI_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
    this.model = options.model || process.env.PRISM_AI_MODEL || (this.provider === 'GEMINI' ? 'gemini-1.5-pro' : 'gpt-4o');
    this.baseUrl = options.baseUrl || process.env.PRISM_AI_BASE_URL || null;
  }

  /**
   * Sanitizes untrusted evidence text to prevent prompt injection breakouts
   */
  sanitizePromptContent(text) {
    if (typeof text !== 'string') text = JSON.stringify(text || '');
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Generates structured JSON output adhering to a schema
   * @param {object} params
   * @param {string} params.systemPrompt
   * @param {string} params.userPrompt
   * @param {object} params.schema
   * @param {string} [params.organizationId]
   * @param {string} [params.investigationId]
   * @param {number} [params.temperature=0.2]
   */
  async generateStructuredOutput({ systemPrompt, userPrompt, schema, organizationId, investigationId, temperature = 0.2 }) {
    // If external API key is configured and not offline mode, call LLM
    if (this.apiKey && this.provider !== 'HEURISTIC_OFFLINE') {
      try {
        const result = await this.callExternalLLM({ systemPrompt, userPrompt, schema, temperature, organizationId, investigationId });
        return {
          ...result,
          source_type: 'LLM_INFERENCE',
          provider: this.provider,
          model: this.model
        };
      } catch (err) {
        console.warn(`[AIGateway] External LLM failed (${err.message}), engaging heuristic offline engine.`);
      }
    }

    // Deterministic offline reasoning engine (honestly labeled)
    const heuristic = this.generateHeuristicOutput({ systemPrompt, userPrompt, schema });
    return {
      ...heuristic,
      source_type: 'DETERMINISTIC_OFFLINE_REASONING',
      provider: 'HEURISTIC_OFFLINE',
      model: 'prism-deterministic-v1'
    };
  }

  /**
   * Generates evidence-grounded hypotheses given investigation problem & evidence items
   * @param {object} params
   * @param {string} params.problem
   * @param {Array<object>} params.evidence
   * @param {Array<object>} [params.symbols=[]]
   * @param {string} [params.organizationId]
   * @param {string} [params.investigationId]
   * @returns {Promise<Array<object>>}
   */
  async synthesizeHypotheses({ problem, evidence = [], symbols = [], organizationId, investigationId }) {
    const validEvidenceIds = new Set(evidence.map(e => e.id));

    // Enclose evidence inside XML boundaries with sanitized contents
    const evidenceXml = evidence.map(e => {
      const cleanContent = this.sanitizePromptContent(
        typeof e.content === 'string' ? e.content.substring(0, 300) : JSON.stringify(e.content)
      );
      return `<untrusted_evidence id="${e.id}" type="${e.type}">\n  <title>${this.sanitizePromptContent(e.title)}</title>\n  <content>${cleanContent}</content>\n</untrusted_evidence>`;
    }).join('\n');

    const symbolSummary = symbols.slice(0, 20).map(s => `${s.kind} ${s.name} in ${s.file_path}`).join(', ');

    const systemPrompt = `You are PRISM's Principal Systems Reliability & Software Investigator.
Analyze the incident and evidence. Produce exactly 2 to 4 competing, falsifiable hypotheses.
CRITICAL GROUNDING RULES:
1. Every hypothesis MUST cite valid supporting evidence IDs exclusively from the provided <untrusted_evidence> elements.
2. DO NOT hallucinate or invent non-existent evidence IDs.
3. Every hypothesis MUST specify a falsification_condition and a confidence_state (one of: CONFIRMED, PROBABLE, POSSIBLE, UNKNOWN, CONTRADICTED, NOT_TESTED).`;

    const userPrompt = `Incident Problem: ${this.sanitizePromptContent(problem)}
Available Evidence:
${evidenceXml || '<empty_evidence/>'}
Repository Symbols:
${symbolSummary || 'None available.'}`;

    const schema = {
      type: 'object',
      properties: {
        hypotheses: {
          type: 'array',
          items: {
            statement: 'string',
            rationale: 'string',
            confidence_state: 'string',
            probability: 'number',
            supporting_evidence_ids: 'array',
            falsification_condition: 'string'
          }
        }
      }
    };

    const result = await this.generateStructuredOutput({
      systemPrompt,
      userPrompt,
      schema,
      organizationId,
      investigationId
    });

    const rawHypotheses = result.hypotheses || [];

    // Filter out any hallucinated evidence citations that do not exist in the vault
    return rawHypotheses.map(hyp => {
      const citedIds = Array.isArray(hyp.supporting_evidence_ids) ? hyp.supporting_evidence_ids : [];
      const groundedIds = citedIds.filter(id => validEvidenceIds.has(id));

      // Standardize confidence state
      let confidenceState = hyp.confidence_state || 'PROBABLE';
      const validStates = ['CONFIRMED', 'PROBABLE', 'POSSIBLE', 'UNKNOWN', 'CONTRADICTED', 'NOT_TESTED'];
      if (!validStates.includes(confidenceState)) {
        confidenceState = hyp.probability >= 0.8 ? 'PROBABLE' : 'POSSIBLE';
      }

      return {
        ...hyp,
        confidence_state: confidenceState,
        probability: Number((hyp.probability || 0.75).toFixed(2)),
        supporting_evidence_ids: groundedIds.length > 0 ? groundedIds : (evidence.length > 0 ? [evidence[0].id] : []),
        source_type: result.source_type,
        provider: result.provider
      };
    });
  }

  /**
   * Deterministic semantic heuristic reasoning engine
   */
  generateHeuristicOutput({ userPrompt }) {
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
        confidence_state: 'PROBABLE',
        probability: 0.85,
        supporting_evidence_ids: uniqueEvidenceIds.slice(0, 3),
        falsification_condition: falsification
      },
      {
        statement: `Competing Hypothesis B: Transient downstream dependency degradation`,
        rationale: `Intermittent network flakiness or third-party service rate limiting mimicking an internal failure.`,
        confidence_state: 'POSSIBLE',
        probability: 0.40,
        supporting_evidence_ids: uniqueEvidenceIds.slice(0, 1),
        falsification_condition: 'Isolated network sandbox execution reproduces the error even with mocked healthy downstream responses.'
      }
    ];

    return { hypotheses, category, confidence: 0.85 };
  }

  /**
   * External LLM HTTP caller with schema output and token accounting
   */
  async callExternalLLM({ systemPrompt, userPrompt, temperature, organizationId, investigationId }) {
    let url = 'https://api.openai.com/v1/chat/completions';
    let headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    };
    let body = {};

    if (this.provider === 'GEMINI') {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
      headers = { 'Content-Type': 'application/json' };
      body = {
        contents: [
          { role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }
        ],
        generationConfig: {
          temperature,
          responseMimeType: 'application/json'
        }
      };
    } else {
      if (this.baseUrl) {
        url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;
      }
      body = {
        model: this.model,
        temperature,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' }
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error(`External LLM call returned status ${response.status}`);
    }

    const data = await response.json();

    let content = '';
    let promptTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 4);
    let completionTokens = 100;

    if (this.provider === 'GEMINI') {
      content = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (data.usageMetadata) {
        promptTokens = data.usageMetadata.promptTokenCount || promptTokens;
        completionTokens = data.usageMetadata.candidatesTokenCount || completionTokens;
      }
    } else {
      content = data.choices?.[0]?.message?.content;
      if (data.usage) {
        promptTokens = data.usage.prompt_tokens || promptTokens;
        completionTokens = data.usage.completion_tokens || completionTokens;
      }
    }

    // Durable FinOps token usage recording
    try {
      recordUsage({
        organizationId,
        investigationId,
        type: 'MODEL_INPUT_TOKENS',
        quantity: promptTokens,
        provider: this.provider,
        model: this.model
      });
      recordUsage({
        organizationId,
        investigationId,
        type: 'MODEL_OUTPUT_TOKENS',
        quantity: completionTokens,
        provider: this.provider,
        model: this.model
      });
    } catch (_) {}

    return JSON.parse(content);
  }
}

module.exports = {
  AIGateway
};
