# PRISM — Acceptance Criteria
## Investigation
- Every investigation has an owner, project, state, timestamps, and audit trail.
- State transitions are validated server-side.

## Evidence
- Evidence cannot exist without provenance.
- Deleted/unavailable source evidence is visibly marked.
- Conflicting evidence remains visible.

## AI
- AI outputs conform to schemas.
- Unsupported claims are rejected or marked uncertain.
- Model/tool failures are surfaced rather than hidden.

## Verification
- Verification records inputs, method, result, timestamp, and actor.
- A failed verification cannot be represented as successful.

## Security
- Unauthorized tenant data access is blocked and tested.
- Secrets never appear in normal application logs.

## Launch
- Critical tests pass.
- Rollback is tested.
- Backup restoration is tested.
- Monitoring and alerting are active.
