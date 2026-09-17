# PRISM Skill — Evidence-First Technical Investigation & Engineering Audit

> **Core Axiom:** *Don't just tell me what's wrong. Prove it.*

PRISM is a specialized agentic engineering skill designed for **Google Antigravity**, **Claude Desktop / Claude Projects**, and **OpenAI Codex / ChatGPT**. It transforms an AI agent from a guessing engine into a disciplined, evidence-first technical investigator.

---

## 🚀 Quick Navigation

- [1. Overview & Identity](#1-overview--identity)
- [2. Installation in Antigravity](#2-installation-in-antigravity)
- [3. Investigation Depth Modes](#3-investigation-depth-modes)
- [4. The 10 Core Operating Rules](#4-the-10-core-operating-rules)
- [5. Example Prompts](#5-example-prompts)
- [6. Skill Directory Structure](#6-skill-directory-structure)
- [7. Using with Claude Desktop & OpenAI Codex](#7-using-with-claude-desktop--openai-codex)

---

## 1. Overview & Identity

PRISM treats an LLM as a reasoning and orchestration component, **never as the sole source of truth**. When investigating incidents, code defects, regressions, or security findings:
1. Tools and system artifacts collect raw evidence.
2. Multiple competing hypotheses are formulated with mandatory **falsification conditions**.
3. Experiments and code inspections test those hypotheses.
4. Contradictions are explicitly documented rather than ignored.
5. Findings, blast radius, and recommendations are delivered in a structured, verifiable report.

---

## 2. Installation in Antigravity

Antigravity discovers skills using **progressive disclosure**:
- Only the YAML `name` and `description` are indexed at startup.
- The full instructions in `SKILL.md` and supporting workflows/checklists are loaded on-demand when the skill is triggered.

### Installation Locations:
1. **Workspace Level (Current Project):**
   ```text
   .agents/skills/prism/
   ├── SKILL.md
   ├── PRISM-SKILL.md
   ├── workflows/
   ├── checklists/
   ├── references/
   ├── templates/
   └── examples/
   ```
2. **Global Level (All Projects on Machine):**
   ```text
   C:\Users\<user>\.gemini\config\skills\prism\
   ```

### How Antigravity Triggers PRISM:
- **Explicit Trigger:** Mentioning "PRISM" or "PRISM skill" in your prompt (e.g. *"Use PRISM to investigate..."*).
- **Implicit Intent Trigger:** Prompts asking for root-cause analysis, production incident investigation, hypothesis falsification, or completion auditing automatically match the skill's description.

---

## 3. Investigation Depth Modes

PRISM supports 4 distinct depth modes depending on urgency and complexity:

| Mode | Trigger Keyword | Focus Area | Deliverables |
| :--- | :--- | :--- | :--- |
| **`QUICK`** | `PRISM [QUICK]` | Localized syntax errors, quick triage, single-file bugs | Rapid static check, targeted fix, smoke test verification |
| **`STANDARD`** | `PRISM` *(Default)* | Multi-service regressions, unexpected API failures, flaky tests | Minimal reproducible reproduction script, code trace, 2+ competing hypotheses, root cause report |
| **`DEEP`** | `PRISM [DEEP]` | Concurrency bugs, race conditions, memory/resource leaks, security audits | Instrument tracing, stress reproduction, formal falsification matrix, blast radius analysis |
| **`ACCEPTANCE`** | `PRISM [ACCEPTANCE]` | Pre-release gates, full project audits, deployment verification | Clean-state build, zero-trust migration from zero, real E2E lifecycle verification, audit scorecard |

---

## 4. The 10 Core Operating Rules

When PRISM is active, the agent adheres to 10 mandatory rules:

1. **Evidence Before Conclusions:** Never treat an LLM assumption as proof. Code, runtime logs, and reproduction runs outrank intuition.
2. **Observation vs. Interpretation:** Distinguish what was seen from what it might mean.
3. **Traceability:** Every important claim must trace back to a file, line number, commit SHA, or execution log.
4. **Contradictions Are First-Class:** Contradictory evidence must be highlighted and resolved, never hidden.
5. **Unknown Is a Valid Result:** Explicitly classify certainty (`CONFIRMED`, `PROBABLE`, `POSSIBLE`, `UNKNOWN`, `CONTRADICTED`, `NOT_TESTED`).
6. **Failed Experiments Are Evidence:** Differentiate environment setup failures from true hypothesis falsification.
7. **Never Fake Completion:** Do not claim a feature works just because a file, stub, or mock test exists.
8. **Preserve Provenance:** Keep track of evidence source, collection method, and timestamp.
9. **Zero Hidden Reasoning:** Keep reasoning summaries concise and evidence-grounded.
10. **Safety Boundary:** Read-only analysis and isolated verification by default; no destructive modifications without authorization.

---

## 5. Example Prompts

### Bug / Incident Investigation:
```text
PRISM: We are seeing intermittent 500 errors on POST /api/v1/jobs.
Investigate the root cause, formulate competing hypotheses, trace the code path,
and recommend a verified fix.
```

### Security Audit (Deep Mode):
```text
Use the PRISM skill in DEEP security-audit mode.
Perform a complete security investigation of the authentication, tenant isolation,
sandbox execution, and webhook verification layers. Document all confirmed
vulnerabilities with concrete code evidence.
```

### Project Completion / Acceptance Gate:
```text
PRISM [ACCEPTANCE]: Run a full forensic audit on this repository.
Verify clean-start setup, migrations from zero, and real E2E lifecycle
execution. Check for false completion markers (TODO, FIXME, stubs, mocks).
```

---

## 6. Skill Directory Structure

```text
PRISM-Skill/
├── SKILL.md                          # Master instruction file with YAML frontmatter
├── PRISM-SKILL.md                    # Core methodology specification
├── README.md                         # This documentation guide
├── workflows/
│   ├── investigation-flow.md         # 7-phase RCA workflow
│   ├── audit-flow.md                 # Acceptance audit procedure
│   └── decision-support-flow.md      # Trade-off & blast radius evaluator
├── checklists/
│   ├── evidence-checklist.md         # Evidence validation criteria
│   ├── falsification-checklist.md    # Hypothesis disproof criteria
│   ├── production-readiness.md       # Pre-deployment verification gate
│   └── security.md                   # Security boundary checklist
├── references/
│   ├── architecture.md               # Canonical PRISM platform architecture
│   ├── evidence-model.md             # Evidence JSON schema and classification
│   └── hypothesis-model.md           # Hypothesis lifecycle and states
└── templates/
    ├── investigation-report.md       # Standardized investigation output template
    └── audit-report.md               # Acceptance audit output template
```

---

## 7. Using with Claude Desktop & OpenAI Codex

### Claude Desktop / Claude Projects:
1. Upload `PRISM-SKILL.md` and all files under `workflows/`, `checklists/`, and `references/` into your **Project Knowledge**.
2. Set Custom Instructions:
   > *"You operate with the PRISM (Evidence-First Investigation) skill. Don't just tell me what's wrong; prove it from code and runtime evidence. Require falsification conditions for hypotheses."*

### OpenAI Codex / Custom GPT:
1. Upload `PRISM-SKILL.md` to your Custom GPT Knowledge base.
2. In Instructions, paste:
   > *"You are PRISM, an evidence-first technical investigator. Follow the 10 PRISM operating rules: separate observation from interpretation, formulate competing hypotheses, state explicit unknowns, and trace claims to code artifacts."*
