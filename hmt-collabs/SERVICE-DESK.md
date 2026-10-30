# Service Desk and Knowledge Base

## Deployed modules

`/module/service-desk` provides internal ticket intake, management, queue, SLA monitoring, escalations, routing/policy administration, knowledge authoring/reviews and links to reporting. `/module/knowledge` opens the knowledge view and has its own homepage tile. Customer portal access remains a restricted read-only experience; email ingestion, external ticket submission, outbound email/SMS and binary attachment uploads are not implemented. Evidence and attachments are captured as URLs/references. Production contains no fabricated tickets or published knowledge.

Ticket capture includes requester identity and contact, customer organization/contact/site, incident/request/problem/change type, category/subcategory/service/channel, impact/urgency, derived priority, owner, department/team, contract/SLA entitlement, asset name/serial, environment, location, business impact/users affected, symptoms/diagnostics/workaround, vendor/external references, planned dates, approval reason, security classification, work notes, root cause, resolution/code, validation and closure evidence. Customer contacts prefill requester information. Linked data is validated against the organization and country.

## Lifecycle and authorization

Internal authorization reuses active internal identity, role and country scope. Supervisors access their countries; technicians access owned or created tickets. Project ticket access additionally checks project membership/assignment. All changes require same-origin requests and revision guards. Customer/organization related-work, project source links, legacy customer ticket lists and general service/workload reports apply managed-ticket privacy. Only explicitly customer-visible standalone tickets appear in the requester portal; project and internal tickets do not.

Create → classify/route → record actual first response → fulfill approved work where required → resolve with resolution, validation and resolution code → close with a published knowledge citation and usage note. Assignment itself is not a first response. Fulfillment approval is mandatory for change tickets and optionally requested for other tickets. Approval is by an assigned independent governance user; changing the fulfillment scope supersedes approval. Notes and events are internal, never automatically emailed. Closed tickets retain their history; supervisors may reopen with a reason. Reopen retains original SLA deadlines, clears resolution fields and increments the closure cycle. Prior knowledge citations cannot satisfy a later closure cycle.

Legacy ticket intake/update APIs point users to the Service Desk workflow. Existing records remain readable and can be adopted by a supervisor; adoption preserves original dates and existing state. Historical closed tickets are not falsely supplied with knowledge citations. A missing legacy SLA deadline generates a workflow exception instead of inventing a target.

## SLA and routing

Country/priority policies default to 24×7 elapsed time: critical response 15 minutes / resolution 240; high 60 / 480; medium 240 / 1440; low 480 / 4320. These are configurable operational defaults, not claims about signed customer SLAs. Existing country policies are snapshotted into each ticket; updates affect future tickets. Contract SLA entitlement links provide commercial/service context; contractual support hours and ticket time targets are distinct. Contract-specific/business-hour/holiday calendars are not inferred from free text.

SLA monitoring runs every five minutes and after relevant ticket writes. Warnings start at 80%; response and resolution breaches are evaluated independently. Project tickets start their SLA at the later of creation or the planned start at 00:00 Mauritius. Task planned end and SLA resolution deadline remain separate. Later plan changes are audited and do not silently reset SLA targets. Execution respects the current planned task start.

Holds pause only when the captured policy allows it. Resume adds elapsed held seconds to open response/resolution targets; actual first response cannot be recorded while the clock is paused. On-hold review and overdue planned-end alerts remain visible. Reopening does not reset first response or SLA deadlines. Reports distinguish outcomes from outstanding breaches and account for an active paused clock.

Routing uses active country/category/service/priority rules. Exact matches take precedence over wildcard matches; ties use creation time and ID for deterministic ordering. An explicit authorized owner overrides routing. Unmatched tickets remain unassigned for triage and generate alerts. Project tickets always use the task owner. Alerts are deduplicated, acknowledged and resolved in-app; assigned owners, project manager/sponsor, scoped country leads and global administrators receive relevant in-app notification records. Failed scans are logged in `sd_scan_runs`. The legacy ticket scanner excludes managed tickets to avoid duplicate SLA alerts.

## Knowledge controls

Knowledge contains summary, symptoms, prerequisites, procedure, validation, rollback, references, tags and review date, with category/service/country metadata. Any authorized internal user may draft for their country. Drafts are private to author/reviewer and supervisory users; published versions are available to internal users in country scope. Technical reports preserve this distinction.

Publication requires a substantive procedure, validation/rollback, a valid review date and an independent assigned leadership reviewer. Authors and the last draft editor cannot approve their own work. Draft changes invalidate pending review through article revision guards. Published versions are immutable; subsequent edits make a new draft while the previous published version remains available. Retirement and expired review dates block new closure citations. Exact cited version content remains accessible in the ticket's usage evidence even after retirement. Missing knowledge is handled by creating, reviewing and publishing an article, not by bypassing closure controls.

## Project automation

Project WBS tasks now capture `start_date`, existing end/due date and assigned owner. Planning gate readiness requires all three. A fully defined unfinished task automatically creates exactly one ticket after any commercial handovers are accepted. The creation batch includes service ticket, managed profile, one-to-one task link and project/service audit. Repeated scans cannot duplicate it. Suggested framework tasks remain undated/unassigned until the project manager reviews them; the system does not fabricate dates.

Task edits synchronize owner/title/planned dates to the ticket with revision guards. Execution status is controlled from the linked Service Desk ticket. In-progress tickets update the project task to in progress; resolved tickets leave the task unfinished until closure. Ticket closure, its required knowledge evidence, project task completion, project revision invalidation and audit are one transaction. Database triggers prevent manually completing a linked task while its ticket is not closed. Reopening a closed ticket reopens its project task atomically. Dependencies and commercial handover guards still apply. Held/cancelled/closed projects or cancelled tasks block delivery actions and surface exceptions. A closed/cancelled project cannot be reopened through its ticket. Ticket events refresh project workflow evaluation.

No task ticket is created for incomplete planning data, inactive owners, cancelled/finished work or pending commercial acceptance. Scheduled reconciliation retries eligible tasks. Project creation/updates and scheduled scans synchronize tasks, while the full project remains subject to its independent stage/change controls. Ticket closure does not automatically approve a project gate or close the project. No contract support hours are consumed by closure; existing independently approved time entries remain the sole SLA-hours posting mechanism.

## Reporting, deployment and validation

Six new regional reports bring the catalog to 50: technical ticket operations/SLA, project task tickets, knowledge health; financial contract/SLA context; audit ticket workflow/closure and knowledge publication/usage. Existing service/workload reports now enforce managed-ticket scope and pause-aware breach logic. Detail sections cap at 1,000 and state their current-snapshot or event-date basis. No billing, revenue, FX, margin or certification claims are inferred.

Apply additive, idempotent `migrations/service-desk.sql`; deploy all current Worker modules while preserving unrelated source and inherited bindings. Keep the existing daily `0 4 * * *` schedule (08:00 Mauritius) and add `*/5 * * * *` exclusively for the Service Desk scan. Editable HTML and generated JS page exports must remain synchronized. Cloudflare cron configuration may take time to propagate after deployment.

Verification commands:
- `node hmt-collabs/tests/service-desk.test.mjs`
- `node hmt-collabs/tests/project-management-extra.test.mjs`
- `node hmt-collabs/tests/commercial-delivery.test.mjs`

Tests use synthetic SQLite/D1 fixtures with stub identity, not production bypass credentials. They exercise all 50 report paths, detailed intake, routing, priority, knowledge review/immutability/retirement, closure cycles, approval invalidation, revisions, pause/resume, SLA escalation deduplication, one-to-one project ticket ownership and completion, dependencies, commercial gates and portal/report privacy. Browser QA exercises intake, first response, resolution and knowledge-backed closure in a synthetic preview. Live authenticated UAT remains pending.
