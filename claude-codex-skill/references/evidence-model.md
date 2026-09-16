# PRISM Evidence Model

## Required concepts

Evidence should be independently addressable and traceable.

Recommended fields:

- evidence_id
- type
- source
- observation
- content/reference
- timestamp
- environment
- version/commit
- collection_method
- reliability
- freshness
- related_hypotheses
- integrity/hash where applicable

## Evidence hierarchy

1. AI assumption
2. Static/code evidence
3. Historical evidence
4. Runtime evidence
5. Reproduction
6. Independent verification

## Rule

The conclusion cannot be stronger than the evidence supporting it.
