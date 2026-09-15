# PRISM — Infrastructure & DevOps Forensic Audit

**Audit Date**: September 16, 2026  
**Target Codebase**: `prism-platform/Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`  
**Specification Reference**: `06-INFRASTRUCTURE/ENVIRONMENTS.md`, `06-INFRASTRUCTURE/CI-CD.md`

---

## 1. Specification Baseline

`06-INFRASTRUCTURE/ENVIRONMENTS.md` mandates:
- Multi-tier environment architecture: Local Development, CI, Staging Sandbox, and Production.
- Production environment requirements: High availability, isolated networking, managed persistence, automated daily backups with restore drills, secret management (e.g. AWS Secrets Manager / Vault), and infrastructure-as-code (Terraform / Helm).

---

## 2. Forensic Infrastructure Audit

### 2.1 Containerfile (`Dockerfile`)
- **Strengths**: Multi-stage build structure based on lightweight `node:24-alpine`; drops root privileges using `USER node`.
- **Defects & Gaps**:
  1. Copies entire codebase including `prism.db` if built locally, baking local development database state into the container image.
  2. Does not include `dumb-init` or `tini` to properly handle PID 1 signal forwarding (`SIGTERM` / `SIGINT`).
  3. Hardcodes `NODE_ENV=production` and `PORT=3300` in image metadata rather than allowing dynamic cluster injection.

### 2.2 Docker Compose (`docker-compose.yml`)
- **Strengths**: Defines persistent volume `prism-data` mounted to `/data`; configures HTTP healthcheck.
- **Defects & Gaps**:
  1. Only runs a single container instance.
  2. Uses SQLite file on a Docker volume. SQLite over networked NFS/EBS volumes can suffer from lock corruption under multi-node container orchestration.
  3. No Redis or background worker containers are declared.
  4. Secrets are passed via plain text environment variables rather than Docker Secrets or external secret managers.

### 2.3 CI/CD Workflow (`.github/workflows/ci.yml`)
- **Strengths**: Runs on GitHub Actions Ubuntu runner; caches npm dependencies; executes `npm test` and `tests/benchmark.js`.
- **Defects & Gaps**:
  1. Does not build or push the Docker image to any container registry (ECR / Docker Hub / GHCR).
  2. Does not run any security linter (e.g. `npm audit`, Snyk, Trivy, or CodeQL).
  3. Does not run linting or code formatting checks (`eslint`, `prettier`).
  4. Has zero deployment steps (no staging deployment, no canary rollout, no production CD).

### 2.4 Backup, Restore & Disaster Recovery (DR)
- **Current State**: **0% Implemented**.
- There are no automated SQLite backup scripts (`VACUUM INTO` or Litestream), no off-site S3 replication, no point-in-time recovery (PITR) mechanism, and no documented or automated restore drill.
