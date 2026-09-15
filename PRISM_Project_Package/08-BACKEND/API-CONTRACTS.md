# PRISM — API Contract Rules
- Version public APIs.
- Validate every request server-side.
- Return stable error structures.
- Enforce authorization at the API/domain boundary.
- Use idempotency keys for retryable mutations where appropriate.
- Never trust client-provided tenant/project ownership.
- Long-running operations return job/investigation references rather than blocking requests.
