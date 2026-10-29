# Project Management

Live module: `/module/projects`. Project deep links use `?id=<project UUID>#charter`. Function tiles follow the Administration/Customers & Partners layout.

## Framework and lifecycle

PMBOK Eighth Edition's Governance, Scope, Schedule, Finance, Stakeholders, Resources and Risk domains are mapped to 22 original, organization-tailored control descriptions. Relevant ITIL practices guide change authorization, testing, release/deployment, configuration, support readiness, knowledge handover and improvement. Sources: https://www.pmi.org/standards/pmbok and https://www.peoplecert.org/browse-certifications/it-governance-and-service-management/itil-practice-manager . The tool supports evidence and decisions; it does not certify framework conformance, legal compliance or maturity.

Stages: initiation → planning → delivery → transition → closure → closed. Creation seeds all 22 controls as not started and six suggested WBS tasks with no invented completion or dates. Predictive, agile and hybrid approaches are captured as tailoring choices; there is no automatic agile estimation or critical-path scheduler.

Controls require evidence, an owner and review notes, or an explicit non-applicability justification. Gate readiness evaluates all controls up to the current phase. Planning also requires the scope, dates, cost budget and assigned/dated tasks. Pending changes, critical issues, unfinished tasks and unreviewed time affect later gates. Gate requests freeze evidence and the baseline; independent decisions cannot approve stale revisions or the requester's own submission. Customer acceptance is an internal record referencing customer sign-off evidence, not an electronic signature service.

After planning, protected baseline values change only through a submitted change, independent approval and explicit application. Approved changes reopen affected baseline evidence. Changes are checked against their original baseline before approval/application. Country governance can reassign accountable roles; managers and sponsors must be different people. Project oversight can hold/resume/cancel with a recorded reason. Closed/cancelled projects are read-only except time-review/correction and alert acknowledgement paths.

## Linked data and prefill

Projects reuse `projects` identities and can adopt an existing legacy project. Organizations, customer contacts, sites, contracts, coverage, SLA definitions and hours, commercial records, regional activities, tickets and unlinked tasks are read from their existing modules. Selecting source records supplies editable suggestions; source selections and provenance are recorded. Quotation value is not inferred to be a cost budget or booked revenue. Contract/site/source selections remain fixed after initiation.

WBS tasks reuse `work_tasks`, with planning metadata/dependencies in pm_task_links. Existing tasks are adopted by ID, not copied. Circular dependencies and premature start/completion are rejected. Linked task updates from the existing customer work API route through PM authorization/dependency checks. Database triggers also invalidate outstanding gate revisions after task source changes. Customers & Partners → Related work includes authorized project links.

The Assets/CMDB and intervention tiles do not yet expose dedicated capture data. Configuration/asset handover therefore references actual contract entitlements and external inventory evidence; missing asset data is not invented. Documents are HTTP(S) URLs or evidence references, not uploaded binaries. Procurement records are planning/evidence records, not supplier orders or payments.

## Time, costs and support hours

Each contributor submits their own effort, with a 24-hour daily ceiling across project submissions. The project manager or sponsor/scoped governance reviews other people's submissions. No self approval is allowed. Independently approved billable time posts once to `sla_time_entries` using the stable ID `pm-<time entry UUID>`, in the same database transaction as PM and contract audit evidence. Contract work dates, available entitlement boundaries and sold-hour capacity are checked. Database triggers prevent concurrent SLA overdraw and daily-time overstatement.

An independent correction with a reason voids an approved project entry and credits its corresponding SLA ledger entry; records are not deleted. Project planned/allocated hours are planning figures and do not reserve all SLA hours across other work. Do not add project billable hours to SLA ledger consumption a second time.

Project financial registers capture actual costs, outstanding commitments and forecasts in the project's currency. Currency cannot change after costs exist. Source evidence is retained in each record; users must reconcile superseded commitments. No payment, revenue recognition, currency conversion, earned-value calculation or automatic cost rate is inferred.

## Authorization and audit

Requester accounts and mixed requester/internal roles are denied. All reads/writes enforce current country scope. Country/global leadership and group leaders can initiate projects; administrators/country leads or the assigned project manager manage them. Non-supervisory technical users need project membership, accountability or a task assignment to read a project. Assigning a framework/record owner also records project membership. Assigned engineers can update their own task progress and submit their own time. Financial access is restricted to project accountability, country/global governance and regional managers.

Independent sponsor/governance decisions are required for gates and changes. All POSTs require same-origin Origin. Inputs use bound SQL, validated dates/non-negative decimal fields and HTTP(S) link validation. Revision guards make each project write transactional with the audit entry, rejecting stale edits. Project private tasks remain scoped in the old customer task list, organization related work and general task reports. Old generic task alerts are suppressed for PM-owned tasks to avoid duplicate workflow ownership.

pm_audit records previous/new values, approvals, corrections and workflow events. Triggered source events may have no resolvable actor and are labelled system/source updates. It is application audit history, not a tamper-proof external compliance archive. Detailed project audit views show the most recent 100 events; reporting details are capped at 1,000 rows per section. The underlying database retains the events.

## Workflows and reporting

Project scans run daily through the existing `0 4 * * *` cron (08:00 Mauritius time) and after PM mutations. Rules cover due/overdue tasks, missing assignment, blocked predecessors, overdue project/milestones/risks/issues/procurement/actions, high risks, pending or stale gate reviews, submitted changes/time, current evidence gaps and cost/effort/support-hour thresholds. Alerts are deduplicated by project/rule/entity; cleared conditions resolve alerts. Notifications are in-app for oversight and relevant assigned task/record owners. No external messages or email are sent. Approvals, contracts, purchases and project completions are never fabricated by automation.

Regional Reporting adds seven options: project budgets/costs (Financial); delivery, resources/effort, risks/changes and workflow exceptions (Technical); framework/gate controls and project audit (Audit & Governance). Project events also feed consolidated financial/technical/audit trails. Existing report paths and country/organization/date filters are preserved.

## Deployment and validation

Apply migrations/project-management.sql after the existing contract/SLA migrations. Preserve all existing modules, settings, secrets, bindings and cron triggers. New modules: project-management.js, project-ui.js, pm-framework.js, pm-workflows.js and pm-reporting.js; updated integration: index.js, intelligence.js, organizations.js and organizations-ui.js. project-page.html is the editable source for JSON-encoded project-ui.js. The repository remains a partial Worker source mirror and must not be deployed standalone without the remaining identity/governance modules.

Run `node tests/project-management.test.mjs` and `node tests/project-management-extra.test.mjs` with Node.js 24+. Tests use schema definitions and synthetic records only. They exercise all 41 report paths; scope; prefill; framework/WBS seeds; independent/stale gates; change controls; task cycles and predecessors; progress; single-posting SLA capacity; time corrections; source revision invalidation; workflow duplicate prevention; and privacy across existing source surfaces. Browser QA used a synthetic local project to inspect prefill, portfolio, baseline and control screens. Live authenticated UAT remains to be performed with actual internal accounts.
