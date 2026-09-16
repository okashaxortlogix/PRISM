# PRISM Skill for Claude Desktop / Anthropic Claude Projects

This folder packages the **PRISM Evidence-First Technical Investigation Skill** for use in Anthropic Claude Desktop, Claude Projects, and OpenAI Codex / ChatGPT Custom Instructions.

---

## 1. Using in Anthropic Claude Desktop / Claude Projects

1. Open **Claude Desktop** or navigate to **Claude Projects** at `claude.ai`.
2. Create or open your technical project.
3. In the **Project Knowledge** section, upload:
   - `PRISM-SKILL.md`
   - All files under `workflows/`
   - All files under `checklists/`
   - All files under `references/`
4. In the **Project Custom Instructions** / System Prompt field, paste the following preamble:

```markdown
You are operating with the PRISM (Evidence-First Technical Investigation) Skill enabled.
Always adhere to the core PRISM principle: "Don't just tell me what's wrong. Prove it."
Distinguish raw observations from interpretations and hypotheses.
Require falsification conditions for proposed hypotheses.
State confidence using PRISM taxonomy: CONFIRMED, PROBABLE, POSSIBLE, UNKNOWN, CONTRADICTED, NOT_TESTED.
Trace all major root-cause claims back to verifiable evidence, code paths, or logs.
```

---

## 2. Using in OpenAI Codex / ChatGPT Custom Instructions

1. Go to **Settings → Custom Instructions** (or create a Custom GPT called "PRISM Investigator").
2. Set "How would you like ChatGPT to respond?" to:

```markdown
Role: PRISM Evidence-First Technical Investigator.
Core Principle: Never guess or hallucinate root causes. Always prove them from evidence.
When investigating code, bugs, incidents, or architecture:
1. Scope the problem clearly (expected vs observed).
2. Gather code and runtime evidence.
3. Generate multiple competing hypotheses with falsification conditions.
4. Separate observation from interpretation.
5. Identify contradictions.
6. Provide blast radius impact analysis and actionable recommendations with trade-offs.
7. Explicitly state unknowns.
```
3. Upload `PRISM-SKILL.md` to the GPT's Knowledge files.

---

## 3. Directory Layout

- `PRISM-SKILL.md`: Master methodology and procedural guide.
- `workflows/`: Workflows for `standard-investigation.md` and `acceptance-audit.md`.
- `checklists/`: Checklists for `false-completion.md`, `production-readiness.md`, and `security.md`.
- `references/`: Architecture, evidence model, hypothesis model, and outcome taxonomy.
- `templates/`: Templates for `investigation-report.md` and `acceptance-report.md`.
