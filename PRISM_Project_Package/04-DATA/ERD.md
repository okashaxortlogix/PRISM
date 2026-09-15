# PRISM — Entity Relationship Design

```text
Organization 1──N User
Organization 1──N Project
Project 1──N Repository
Project 1──N Investigation
Investigation 1──N Evidence
Investigation 1──N Hypothesis
Hypothesis 1──N Experiment
Experiment 1──N Verification
Investigation 1──1 RootCause
Investigation 1──N ImpactAssessment
Investigation 1──N Recommendation
Investigation 1──N Decision
Investigation 1──N Report
Project 1──N Memory
User 1──N AuditEvent
Project 1──N Integration
Project 1──N Job
```

## Core integrity rules
- Every investigation belongs to exactly one project.
- Evidence must have provenance.
- Experiments belong to a hypothesis/investigation.
- Verification records cannot be edited into a different outcome without an audit event.
- Tenant boundaries are enforced at the database/application authorization layer.
