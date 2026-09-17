# PRISM Security Policy

## 🛡️ Security Policy & Vulnerability Disclosure

The PRISM team takes the security of our platform, customer telemetry data, and autonomous engineering investigation engine seriously. This document outlines our security policies, supported versions, and vulnerability disclosure process.

---

## Supported Versions

Only the latest active release branch receives security patches:

| Version | Supported | Security Audit Status |
| :--- | :--- | :--- |
| **1.0.x (Current)** | :white_check_mark: Yes | Audited (September 2026) — See [SECURITY-AUDIT.md](SECURITY-AUDIT.md) |
| `< 1.0.0` | :x: No | Unsupported |

---

## Reporting a Vulnerability

If you discover a security vulnerability in PRISM, please do **NOT** open a public GitHub issue.

Please report vulnerabilities directly to our security team:

- **Security Contact:** `security@prism-platform.local` / GitHub Security Advisory
- **Response SLA:** Initial acknowledgment within 24 hours; triage within 48 hours.

When submitting a report, please include:
1. Vulnerability description and classification (e.g. RCE, IDOR, XSS, Bypass).
2. Steps to reproduce or proof-of-concept payload.
3. Affected versions, endpoints, or components.
4. Remediation suggestions if available.

We practice coordinated vulnerability disclosure and will credit researchers who report findings responsibly.

---

## Security Architecture & Design Principles

PRISM adheres to strict **Evidence-First Security**:

1. **Zero-Trust Multi-Tenancy:** All queries enforce strict tenant boundary assertions (`tenantGuard.js`) linking organizations, projects, investigations, and evidence.
2. **Cryptographic Integrity:** SHA-256 canonical hashing for all evidence items, salted `scrypt` for password storage, and constant-time HMAC-SHA256 comparison for webhooks.
3. **Least Privilege (RBAC):** Role hierarchy (`VIEWER` < `MEMBER` < `ADMIN` < `OWNER`) enforced at API route boundaries.
4. **SQL Injection Immunity:** 100% parameter-bound queries across all SQLite interactions.
5. **No Blind Trust:** Untrusted external evidence is quarantined behind trust boundaries before being passed to AI reasoning engines.

For the complete forensic audit and open findings, review the official [SECURITY-AUDIT.md](SECURITY-AUDIT.md).
