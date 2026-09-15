# PRISM — Risk Register

| Risk | Impact | Likelihood | Mitigation | Owner | Status |
|---|---|---|---|---|---|
| AI invents evidence | Critical | Medium | Provenance + structured outputs + evals | AI | Open |
| Unsafe tool execution | Critical | Medium | Sandbox + allowlists + permissions | Security | Open |
| Cross-tenant access | Critical | Low/Medium | Server-side tenant isolation + tests | Backend | Open |
| Investigation becomes too slow | High | Medium | Async jobs + incremental indexing | Architecture | Open |
| Model/API costs grow | High | Medium | Budgets + routing + quotas | FinOps | Open |
| Historical memory becomes stale | High | Medium | Freshness + invalidation | Data | Open |
