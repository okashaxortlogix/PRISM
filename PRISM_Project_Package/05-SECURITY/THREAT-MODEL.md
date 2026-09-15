# PRISM — Threat Model

## Assets
Source code, logs, credentials, investigation data, customer data, model prompts, tool permissions, reports.

## Threats
- Cross-tenant data access
- Credential leakage
- Prompt injection through repositories/logs
- Malicious repository content
- SSRF via URLs/integrations
- Arbitrary code execution
- Supply-chain compromise
- Data exfiltration
- Privilege escalation
- Abuse of expensive model/tool calls

## Controls
- Strong authentication
- Server-side authorization
- Tenant isolation
- Secret management
- Sandboxed execution
- Allowlisted integrations
- Network egress controls
- Input/content isolation
- Audit logging
- Rate limits
- Resource/time limits
- Human approval for risky actions
- Dependency scanning
