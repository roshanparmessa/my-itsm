# Contract reporting and workflows

Regional Reporting has Financial, Technical, and Audit & Governance segments. Contracts & Renewals contributes portfolio/value, renewal quotations, coverage/SLA definitions, obligations, workflow alerts, control exceptions, before/after contract snapshots and workflow audit events. Existing organization and other module reports are preserved. Detail sections have a 1,000-row display/export limit; currency values are separate. Contract values and renewal quotes are not invoiced revenue, expenses, margin or annualized amounts. Contract SLA definitions are not measured compliance and do not rewrite ticket deadlines.

## Workflow behavior

The existing Cloudflare cron `0 4 * * *` runs daily at 08:00 Mauritius time. It invokes scanContractWorkflows independently of the existing task/ticket scan. Successful contract and child-record saves also scan that country's contract records. Administrators and assigned country leads can run a manual scan or acknowledge an alert from Contracts & Renewals → Automations & workflows. Technical roles have read-only scoped visibility.

Rules: expiry 61–90/31–60/0–30 days or expired; cancellation notice due in 30 days or overdue; entitlement and document expiry within 30 days; due/overdue renewal follow-ups and obligations; missing contract owner; contract due within 60 days without a live/confirmed renewal record. Draft, pending-signature, archived and terminated contracts do not create alerts. Contracts on hold remain monitored. Mauritius calendar dates determine deadlines.

Alerts are unique per rule and source record. Acknowledgement is preserved while the same condition remains; changed deadlines reopen the alert. Cleared conditions resolve alerts and cancel their in-app notifications. New expiry tiers replace the prior tier with a new alert. Workflow scans record start/completion/failure, and alert opening/reopening/resolution/acknowledgement creates workflow audit events.

Notifications are in-app records for active internal global administrators and assigned country leads. Recipients with requester roles are excluded. The generic task/ticket email-queue loop excludes contract rules. No contract email is sent or queued. Notification status `sent` for channel `in_app` means available in the application, not read by a person or externally emailed. Country authorization is rechecked when reading/acknowledging alerts and during delivery reconciliation.

Commercial decisions remain explicit: no contract signature, renewal acceptance, amount change, contract extension, purchase order, recurring task generation or automatic status change occurs. Frequency fields on obligations remain descriptive. Owners are descriptive text; notifications route to role holders, not by matching personal names. No unconfigured external messaging is performed.

## Integration

Apply migrations/contract-workflows.sql after migrations/contracts.sql. Deploy contract-automation.js together with contracts.js, contracts-ui.js, intelligence.js, reporting-ui.js and the updated entrypoint. Preserve all existing Worker modules, DB bindings, secrets, settings and cron triggers. The entrypoint starts the contract scan in its scheduled handler and excludes `contract_%` rules from the existing generic email queue loop. Source remains a partial mirror; do not deploy the directory standalone.

## Validation

All 31 reporting query paths were exercised against the current production schema in local SQLite. Workflow tests cover duplicate prevention, alert acknowledgement, resolution/reopening, country isolation, role/Origin restrictions, and in-app delivery without email. Browser script, API and entrypoint syntax checks pass. Authenticated live user workflows have not been exercised.

Run reproducible checks with Node.js 24+: `node tests/contracts-workflows.test.mjs`. The test database contains schema definitions and synthetic records only. The tracked index.js is the integrated entrypoint snapshot for this release; the remaining identity/governance modules must still be preserved from the existing Worker.
