# PRISM — System Architecture

## Logical layers
1. Web UI
2. API/application layer
3. Investigation orchestration
4. Intelligence/AI layer
5. Tool and integration adapters
6. Async queue/workers
7. Persistence
8. Security/observability/control plane

## Principle
Business rules live in the application/domain layer rather than being embedded only in prompts or UI code.

## Async architecture
Long-running ingestion, indexing, evidence collection, analysis, and experiments run through jobs. Jobs are idempotent, retryable, observable, and recoverable.

## Failure philosophy
PRISM fails closed for unsafe operations and fails transparently for incomplete evidence or model/tool failures.
