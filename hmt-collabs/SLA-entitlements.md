# SLA hours and hardware/software entitlement lifecycle

Deploy contracts.js, contracts-ui.js, contract-automation.js, intelligence.js and the new sla-entitlements.js together beside the existing auth.js. Apply migrations/sla-hours.sql to the existing DB binding before deploying. No entrypoint changes are needed: existing /api/contracts routes and the scheduled contract workflow hook are reused. The live Worker already has these changes.

## Data and validation

Contracts have a hardware/software/mixed category and specific equipment/software/service details. Coverage and SLA lines have a hardware/software category and specific details. Hardware requires serial number(s), warranty start and warranty expiry dates. Software requires licence start and expiry dates; licence reference can also be stored. Start/expiry dates must be valid and ordered. Contract term, coverage term, warranty and licence dates remain separate.

Every SLA requires positive support hours sold with at most two decimals. Service operating hours remain a separate field. Contract hours sold are calculated once from its SLA lines. Legacy missing allowances are not manufactured: the directory shows their count and controls/workflows flag them.

## Usage and audit

The SLA hours & consumption option records delivered support against a specific SLA, with work date, engineer, work reference and notes. It is a manual support-hours ledger, not automatic ticket time tracking. It uses integer hundredths of an hour to avoid floating-point balance drift. Current balance = sold hours minus all recorded, non-voided support time. Overruns remain visible rather than discarding actual work. A stable request identifier protects against repeated submission. Corrections void the original entry and require a reason; original entries remain in the ledger and contract before/after audit. No destructive time-entry deletion is exposed.

Existing contract edit permissions are preserved: administrators and assigned Country Leads can record/void time; other internal users retain scoped read access. Cross-country and cross-contract entry references are rejected.

## Reporting and workflow

Financial: SLA hours sold & contract value. Technical: SLA hours & entitlement lifecycle. Audit: SLA entitlement & hours controls. Existing contract coverage/control and audit reports also include the new lifecycle data and before/after changes. Current SLA balances include all delivered time; the support-time register uses the selected work-date reporting period. Contract value is not treated as an hourly rate or recognized revenue.

New in-app workflow rules cover warranty/licence expiry within 30 days or already expired; missing category, product, serial or dates; missing SLA allowances; 20% or less hours remaining; exhausted and exceeded allowances. Alerts are evaluated after saves/time entries/corrections and by the existing daily cron (04:00 UTC / 08:00 Mauritius). They are deduplicated, updated and resolved as conditions clear. Overrun severity changes reopen the exhausted-hours alert. Existing notification recipients and in-app-only delivery are preserved.

## Verification

Passed actual SQLite-backed contract API and report tests using the current D1 schema plus the migration, with synthetic fixtures. Covered required classifications and dates, serial and hours validation, exact hour math, repeated submissions, void corrections, low/exhausted/overrun alert transitions and resolution, expiry rules, country/origin/role restrictions and all 34 report query paths. JavaScript syntax checks passed. Live HTML checks confirmed the new option, labels and script nonce. Authenticated browser create/edit interactions were not exercised. The existing daily schedule and scheduled workflow hook were confirmed.
