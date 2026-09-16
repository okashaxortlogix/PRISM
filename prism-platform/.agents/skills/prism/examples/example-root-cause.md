# PRISM Example: Root-Cause Investigation

## Problem

A checkout API becomes slow after a deployment.

## Evidence

- APM traces show increased connection-acquisition latency.
- A recent deployment changed lock/timeout behavior.
- CPU metrics do not support CPU saturation as the primary explanation.
- Controlled reproduction succeeds only when the lock TTL expires during high latency.

## Hypotheses

- H1: database pool exhaustion
- H2: lock TTL expiry
- H3: network partition

## Verification

A controlled experiment reproduces the failure condition for H2.

## Conclusion

The evidence supports H2 as the root cause, while H1 and H3 are not supported by the available evidence.

## Recommendation

Increase/adjust the lock TTL and add a fallback mechanism, with regression tests and post-change verification.

## Principle

The recommendation is derived from evidence rather than from the initial assumption.
