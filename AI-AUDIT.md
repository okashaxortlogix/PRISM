# PRISM — Forensic AI & Intelligence Layer Audit

**Audit Date**: September 16, 2026  
**Target File**: `prism-platform/src/engine/intelligenceEngine.js`  
**Specification Reference**: `09-AI-INTELLIGENCE/AI-ARCHITECTURE.md`, `09-AI-INTELLIGENCE/EVALUATION.md`, `20-BENCHMARKS-EVALUATION/BENCHMARK-SPEC.md`

---

## 1. The Core Question: Is PRISM Actually Using an LLM?

### **NO.**

**PRISM contains zero LLM integrations, zero AI model clients, zero prompt templates, and zero machine learning models.**

The previous implementation report described an "autonomous reasoning module" and "calibrated intelligence engine". In reality, the entire file `src/engine/intelligenceEngine.js` consists of **77 lines of basic deterministic JavaScript arithmetic**.

---

## 2. Forensic Code Deconstruction of `intelligenceEngine.js`

Here is the entire core "intelligence" algorithm:
```javascript
let totalSupportScore = 0;
for (const id of supportingIds) {
  const evi = evidenceMap.get(id);
  if (evi) totalSupportScore += (evi.reliability || 0.8);
}

let totalConflictPenalty = 0;
for (const id of conflictingIds) {
  const evi = evidenceMap.get(id);
  if (evi) totalConflictPenalty += (evi.reliability || 0.8) * 1.5;
}

const rawScore = (totalSupportScore / (totalSupportScore + 0.6)) - (totalConflictPenalty * 0.4);
const confidence = Math.max(0.05, Math.min(0.99, Number(rawScore.toFixed(2))));
```

### Critical Deficiencies:
1. **No Language Model**: There is no call to Gemini, OpenAI, Claude, or any local model (Ollama / vLLM).
2. **No Natural Language Understanding**: The system cannot read an error log, cannot interpret a stack trace, and cannot understand a code diff. It only counts how many evidence IDs the human user manually clicked in the UI.
3. **No Hypothesis Generation**: The system cannot generate hypotheses. The user must manually type the hypothesis statement into an HTML textarea.
4. **No Semantic Contradiction Detection**: Contradictions are not detected by analyzing evidence content. They only exist if a human user explicitly checks the box under "Select Conflicting Evidence".
5. **No Context Management or Token Budgeting**: Because there is no LLM, there is no context selection, token counting, truncation, or prompt assembly.

---

## 3. Architecture Gap Matrix against `09-AI-INTELLIGENCE/AI-ARCHITECTURE.md`

| Requirement in Specification | Implementation State | Severity |
|---|---|---|
| **LLM Gateway / Provider Adapter** | **0% Implemented** (No SDK or HTTP client) | **P1 Blocker** |
| **Model Routing & Fallback** | **0% Implemented** | **P1 Blocker** |
| **Prompt Architecture & Templates** | **0% Implemented** (Zero prompt files exist) | **P1 Blocker** |
| **Context Construction & Token Budgeting** | **0% Implemented** | **P1 Blocker** |
| **Schema-Constrained Structured Output** | **0% Implemented** (No JSON Schema validation on AI output) | **P1 Blocker** |
| **AI Evaluation & Golden Benchmarks** | **0% Implemented** (`tests/benchmark.js` only measures CPU loop ops/sec) | **P1 Blocker** |
| **Hallucination & Uncertainty Controls** | **0% Implemented** | **P1 Blocker** |

---

## 4. Required AI Implementation Roadmap

To fulfill the specifications in `09-AI-INTELLIGENCE`:
1. **Model Gateway**: Implement pluggable LLM provider client (e.g. Gemini 1.5 Pro / Claude 3.5 Sonnet / OpenAI GPT-4o) using official SDKs with structured JSON output enforcement (`response_format: { type: "json_object" }`).
2. **Investigation Prompt Pipeline**:
   - `ScopingPrompt`: Analyzes incident title and symptoms to determine affected components.
   - `HypothesisGeneratorPrompt`: Given project AST summary and normalized evidence, proposes 3 competing hypotheses with explicit falsification conditions.
   - `ContradictionDetectorPrompt`: Cross-examines evidence items to find temporal or behavioral conflicts.
   - `RootCauseSynthesizerPrompt`: Synthesizes causal chain citing verified experiment IDs.
3. **Context Window Manager**: Token-aware evidence trimmer prioritizing high-reliability items (metrics, stack traces) over verbose logs.
4. **Golden Dataset Evaluator**: Benchmark measuring Precision, Recall, and False Positive Root Causes against known historical incidents.
