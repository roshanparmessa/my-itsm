# HMT Collabs — Accelerated Delivery Plan

Status: development branch; security acceptance is mandatory before production SSO/MFA activation.

## Parallel workstreams
1. Identity: optional Microsoft Entra OIDC, explicit account-link approvals, internal MFA, account recovery.
2. Regional operations: organization and country hierarchy, project portfolio, presales, POCs, RFQs/RFPs, quotations, task ownership.
3. ITSM: incident, service request, problem, change, SLA, service catalog, knowledge base and customer portal.
4. Platform: audit, observability, migrations, CI/CD, authorization regression and disaster recovery.

## Integration contract
- Users and user_roles are the identity source of truth.
- Every regional or customer record must include appropriate scope.
- Server-side authorization and audit logging are required for mutations.
- Never automatically grant access based on an identity-provider email.
- Internal directory login remains independently available.
- No security-critical release without automated tests and threat-model review.

## Delivery gates
A. Migrations and static build checks.
B. Permission and cross-customer isolation tests.
C. Identity-provider integration and MFA recovery tests.
D. Pilot with nonproduction accounts.
E. Staged production rollout with rollback plan.
