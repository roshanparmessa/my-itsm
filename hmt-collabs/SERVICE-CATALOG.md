# Service Catalog and contract-specific SLA management

## Workspace and intake

`/module/service-catalog` is linked from Service Desk and the selected contract in Contracts & Renewals. It contains service/request-template configuration, business calendars, contract SLA policies, a deadline preview and reporting/audit. Existing countries, identities, customer grants and role checks are reused; no separate staff directory is introduced.

Country/global governance creates and publishes service definitions. Supervisors can inspect the governance workspace; assigned technicians use published templates during intake. Definitions include reference, category/subcategory, guidance, request type, permitted funding modes, required intake fields, up to twelve custom typed questions, description prompts, optional default engineer and an independent approval route. Questions support text, long text, number, date and fixed choices. Raw configuration JSON is not required in the UI.

Published customer-visible services appear in the customer's portal. Category, service name and request type are normalized server-side; required answers, valid choices and funding modes cannot be bypassed by editing a request payload. Unchanged description prompts are rejected as incomplete requests. Each ticket captures the service revision, questions, answers and approval route. Later definition changes do not rewrite existing requests.

SLA funding for a catalog service requires an explicit mapping to actual same-country SLA entitlements. The customer sees only mappings belonging to their granted organization. Services can allow billable requests where no mapped SLA coverage exists. SLA-only customer services need mapped coverage before publication. Existing active-entitlement/date/hours validations remain in force. Staff retain explicit custom/legacy intake for incidents outside the published catalog; customer intake requires a catalog selection where an eligible published service is available.

Configured owners are checked against active internal country authority on intake. An unavailable owner falls back to existing routing or triage. A configured independent approver automatically receives a fulfillment approval request. Missing/unavailable approvers generate a selection exception rather than fabricated approval. Governance can replace a pending/configured approval route only with a substantive override reason and a new independent reviewer. Customer billable authorization remains a separate control.

## Policy selection and evidence

A matching effective entitlement policy takes precedence over a contract policy, then a service policy, then the existing 24×7 country/priority fallback. Within the same contract/entitlement scope, a service-specific match is more specific than an all-service match. Scope uniqueness and revision guards prevent ambiguous duplicate definitions and stale edits. Policies define priority, response/resolution working minutes, effective dates, hold-pause behavior, warning percent, calendar, staged escalation recipients and a reference supporting agreed terms.

An active policy requires eligible same-country scope, a published referenced service, an enabled referenced calendar and supporting target evidence. The reference is an auditable governance assertion, not independent verification of a signed contract. No customer terms or official holiday dates are invented. Ineligible/inactive/out-of-date contracts do not select their scoped policy. Future planned project-task activation and preview select the effective configuration for that start date; preview uses current configuration and does not reconstruct historical revisions.

Each new ticket captures the selected policy source, ID/revision, target durations, calendar revision, weekly hours, holidays, overrides and escalation plan. Existing ticket targets are not reset by later configuration or funding edits. Funding classifications and SLA time targets are distinct; operators can inspect the captured source on the ticket. Project task tickets use applicable contract-level policy context and keep their planned end separate from their SLA deadline.

## Business time

Calendars support IANA timezones, seven-day weekly schedules, up to six ordered intervals per day, lunch breaks, holiday dates and date-specific overrides. An override replaces the weekly schedule and takes precedence over a holiday; an empty override closes that date. Overnight schedules can be split across adjacent local dates; 24:00 is supported as an end boundary. Weekends are closed only when their configured intervals are empty. Choose no business calendar for true 24×7 elapsed time.

Deadline calculation adds working minutes rather than wall-clock hours. It handles timezone offset changes across dates. Ambiguous/nonexistent DST boundary times require an explicit unambiguous date override rather than silently miscounting time; ordinary daytime schedules across DST transitions are supported. Calculation has a ten-year safety horizon, with bounded holiday/override input.

When captured policy permits a hold pause, resume extends only still-open, unbreached deadlines by working time actually paused after SLA activation. Non-working time and pre-activation time do not inflate pauses. A hold does not erase a breach that existed before the hold, and escalation of that existing breach continues in working time. Reopening retains the ticket's original captured targets.

Warnings use remaining working minutes and the configured percentage. Escalation levels use working minutes after breach, with up to three ordered levels beginning at zero. Roles can include owner, country lead, global administrator and project authority, plus explicit eligible internal recipients. Current active country authorization is rechecked for notification delivery. Acknowledgement and resolution remain deduplicated. Policies without a staged plan retain the existing oversight notification behavior. Notifications remain in-app; no external messages or new personal automations are created.

The existing five-minute Service Desk scan evaluates captured business-time policies. The existing daily schedule stays unchanged. Database guards prevent disabling/unpublishing a calendar/service while an active policy depends on it, including racing updates.

## Setup and reporting

The idempotent starter migration prepares three service drafts per existing country: infrastructure incident support, standard IT assistance and controlled infrastructure change. It also creates one disabled 09:00–17:00 weekday calendar example per country, using the regional timezone, with no invented holidays. The four-country production setup therefore has twelve draft services and four disabled calendar examples. Owners, reviewers, SLA mappings, actual support hours and holiday dates are configured from real onboarding/contract decisions before publication or activation. No scoped policy is auto-activated.

Four new Regional Reporting views bring the catalog to 57: technical Service catalog & request controls; technical Contract SLA policies & coverage; financial Service funding & SLA allowance context; audit Service catalog & SLA governance audit. Existing operational reporting includes captured SLA source, revision and calendar. Support-hour allowances are not summed once per priority policy, and time targets do not consume sold support hours or create charges. The signed-target coverage view is a configuration review aid, not a claim of contractual noncompliance or certification.

## Migration, deployment and verification

Apply `migrations/service-catalog.sql`, then `migrations/service-catalog-starters.sql`. Deploy all current Worker modules with unchanged inherited bindings and schedules. Preserve the latest live Contracts & Renewals UI, including hours sold, categories, serials, warranty and licence dates; only the governance interlink is added there. Editable HTML and JS page exports must match.

Tests:
- `node hmt-collabs/tests/business-time.test.mjs`
- `node hmt-collabs/tests/service-catalog.test.mjs`
- `node hmt-collabs/tests/catalog-starters.test.mjs`
- Existing customer, Service Desk, project and commercial regression suites.

Synthetic SQLite/D1 tests cover required/custom fields, explicit coverage, customer isolation, owner/approval automation, policy precedence, future-start preview, snapshot preservation, revision/dependency guards, weekends/lunches/holidays/overrides, DST handling, working-time pause/escalation and all 57 report paths. Browser QA verifies the governance workspace, entitlement-level deadline preview and catalog-driven customer intake with synthetic accounts. Live authenticated customer/staff acceptance testing follows real onboarding and agreed operational configuration.
