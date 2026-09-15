# PRISM — AI Architecture
AI is an intelligence component, not the source of truth.

Pipeline:
Context selection → Evidence retrieval → Structured reasoning task → Schema-constrained output → Validation → Contradiction check → Persisted decision artifact.

The AI must be able to say:
- insufficient evidence,
- conflicting evidence,
- cannot verify,
- tool failed,
- hypothesis rejected.

Prompts must not be the only place where safety rules exist; server-side controls are mandatory.
