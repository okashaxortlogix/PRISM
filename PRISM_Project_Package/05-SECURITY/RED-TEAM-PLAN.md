# PRISM — Red Team Plan
Test the system as if the goal were to prevent launch.

1. Attempt cross-tenant reads/writes.
2. Inject instructions through repository files.
3. Attempt prompt/tool privilege escalation.
4. Supply malicious URLs and test SSRF controls.
5. Try secret extraction through model prompts.
6. Attempt arbitrary command execution.
7. Abuse retries/queues for resource exhaustion.
8. Attempt to forge verification results.
9. Tamper with evidence provenance.
10. Attempt unauthorized exports.
11. Test session/token abuse.
12. Test dependency and container vulnerabilities.

Launch blocker: any critical path allowing unauthorized customer data access or unsafe arbitrary execution.
