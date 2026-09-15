# PRISM — Database Schema Outline

## organizations
id, name, status, created_at, updated_at

## users
id, organization_id, email, name, status, created_at

## projects
id, organization_id, name, description, status, created_at, updated_at

## repositories
id, project_id, provider, external_id, url, default_branch, metadata, status

## investigations
id, project_id, created_by, title, problem_statement, status, severity, started_at, completed_at

## evidence
id, investigation_id, type, source, source_ref, content_ref, observed_at, collected_at, reliability, provenance, hash

## hypotheses
id, investigation_id, statement, status, confidence, rationale, created_at

## experiments
id, hypothesis_id, plan, permissions, status, started_at, completed_at, result_ref

## verifications
id, experiment_id, method, outcome, evidence_ref, performed_by, performed_at

## root_causes
id, investigation_id, statement, confidence, supporting_evidence, verification_ref

## recommendations
id, investigation_id, action, rationale, tradeoffs, risk, evidence_ref

## audit_events
id, organization_id, actor_id, event_type, target_type, target_id, metadata, created_at
