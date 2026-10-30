# Customer service portal and service funding

`/customer` is now an operational customer service portal. It uses existing onboarded requester accounts and `customer_user_access` organization grants. Countries are read from those organizations; no duplicate country or user directory is created. No production customer account or commercial permission is fabricated during deployment.

Customers can view their organization's explicitly customer-visible standalone tickets, create SLA-covered or billable incidents/requests/changes, add comments, request escalation/reopening/cancellation, track public support replies, view active SLA entitlements and hours, read explicitly shared customer-safe knowledge, and review billable estimate history. Designated customer commercial contacts can approve or reject the current estimate after reviewing scope, rate, hours and terms. Ordinary requester access does not grant commercial authorization.

## Access and visibility

New customer APIs authenticate the existing session and require exactly the requester role, with a current organization access grant checked on every read and write. Mixed customer/internal roles are rejected. Customer input cannot set an owner, internal fields or internal visibility. Portal tickets are explicitly customer-visible; internal work notes, diagnostics, technical audit snapshots and project-only tickets are excluded. Public support conversations have a separate table and clearly labelled staff UI. Closure knowledge references identify the version without publishing internal procedure content; customer knowledge bodies require an explicit per-organization governance share of a reviewed, current, unexpired published version.

Organizations grant shared ticket visibility to their onboarded customer contacts, consistent with the existing customer access model. This is not a per-person private mailbox. Billable approval authority is a separate per-user/per-organization setting assigned by country/global governance only after onboarding and an existing organization grant. Revoked organization access immediately makes the portal resources unavailable. Internal commercial pricing and terms are restricted to existing financial governance roles; assigned technicians see authorization state, scope and effort, while full quotes remain available to the authorized customer's organization.

## Ticket interactions

Portal creation derives priority from impact and urgency, snapshots the existing operational SLA policy, applies matching active routing rules to eligible internal users, and triggers normal SLA and unassigned-ticket workflows. Unmatched tickets remain in triage pending onboarding/routing configuration. Customer comments never become internal work notes or first responses. A substantive public support reply records the first response only where its clock is active and not paused.

Escalation is a traceable follow-up request and in-app alert, not an unrestricted customer priority override. Support acknowledges, fulfills or declines the request with a public explanation. Only one active request of each type can exist per ticket. Reopen and cancellation requests do not bypass supervisor lifecycle controls or mandatory knowledge-backed closure. Closed tickets can still receive public comments and reopen requests. Customer and internal writes use origin checks, bounded bodies and current ticket revisions.

## SLA-covered versus billable

Customer intake requires one of two explicit funding modes. SLA intake needs a current active contract, an in-date entitlement with defined sold hours and a positive recorded balance. The portal shows hours sold, recorded usage and remaining hours using the existing shared SLA ledger. Warranty, licence and entitlement coverage dates are respected. Intake does not reserve or deduct hours; pending work is not misrepresented as consumed capacity. Internal staff can also classify genuine internal work, but cannot reclassify a portal request as internal through that funding action.

Billable intake starts pending estimate. Authorized internal financial governance proposes a versioned estimate with hours, hourly rate, currency, scope and terms. Positive decimal hours and integer hundredth currency arithmetic are validated. Only an explicitly designated customer approver can accept/reject the current version, with a substantive note and acknowledgment. Prior versions are preserved and superseded. Material fulfillment-scope changes invalidate estimate authorization; active work must first be placed on hold before its scope is changed. API checks and a database trigger prevent billable fulfillment before approval. No invoice, payment, revenue recognition, FX calculation or automatic financial transaction is executed.

A rejected or withdrawn estimate can be cancelled without pretending that work was approved. Commercial governance may declare no-work cancellation only before prior fulfillment or outstanding/approved recorded effort. The ticket still needs actual response, cancellation resolution/validation and a knowledge citation before closure. This exception permits cancellation closure only, not implementation.

## Actual effort and balances

Assigned staff submit actual standalone ticket time with date, notes and hundredth-hour units. An independent supervisor approves/rejects it. Project tickets use the existing Project Management time mechanism, avoiding double charging. The combined daily limit across submitted/approved project and ticket time is 24 hours per engineer.

Approved SLA ticket effort atomically inserts one uniquely identified entry into the existing `sla_time_entries` ledger and records contract/service audit. A database capacity guard prevents overspending sold SLA hours, including concurrent approvals. Repeat approval cannot post twice. Independent corrections mark the time and ledger entry void and restore remaining capacity without deleting history. Funding mode, estimate version and entitlement are captured at time submission, preserving changes in commercial classification over time. Billable actual effort remains separate from invoices and estimates. Customers see approved total effort, not private engineer work notes. Submitted effort requires review before ticket closure.

## UI and reports

Portal tiles: Service Overview; Organization Tickets; Create Ticket; Active SLAs & Hours; Self-Service Knowledge; Billable Work Approvals. Staff Service Desk adds public customer replies, customer request handling, funding classification, versioned estimates, work-time review, onboarding-aware customer commercial authority and controlled knowledge sharing.

Three new Regional Reporting entries bring the catalog to 53: technical Customer service & escalations; financial Billable service estimates & approvals; audit Customer service & authorization audit. Existing service, SLA and knowledge reports remain in place. Estimated values and approved actual hours are distinct; billable actual-hour totals exclude time previously recorded as SLA-funded. Report scopes reuse country, organization and role permissions.

## Migration and verification

Apply additive/idempotent `migrations/customer-service.sql` after existing Service Desk/Project Management migrations. It also replaces the project daily-hours guard to enforce the shared project-plus-ticket limit. Deploy the full preserved Worker with existing inherited bindings and both existing daily/five-minute schedules. No new external notification channel is enabled.

Tests: `node hmt-collabs/tests/customer-service.test.mjs`, existing Service Desk, project, commercial and starter-draft suites. Synthetic tests cover organization isolation, requester/mixed-role restrictions, customer intake and comments, escalation deduplication, private/internal data exclusion, SLA balances and zero-balance rejection, billable estimate versions and explicit delegated approval, fulfillment guards, scope invalidation, no-work cancellation, approved time single posting/capacity/credits, public knowledge sharing, financial redaction and all 53 report paths. Browser QA verifies the customer portal, active SLA selection and ticket creation using synthetic customer accounts. Production signed-in customer acceptance testing awaits real onboarding.
