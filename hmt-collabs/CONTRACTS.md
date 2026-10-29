# Contracts & Renewals

Module URL: https://hmt-collabs.roshan-parmessa.workers.dev/module/contracts

Uses the same function tile layout as Administration and Customers & Partners. Functions: register, contract details, coverage and entitlements, SLAs, renewal pipeline, expiry and notice reminders, obligations, document links, reports and change history. Contract organizations reuse existing customer/partner IDs. Organization agreements remain separate records and are not automatically converted or duplicated.

Apply migrations/contracts.sql to the existing DB binding. Add contracts.js and contracts-ui.js beside auth.js. Apply contracts-integration.patch to index.js. This directory remains a partial source mirror: do not deploy it standalone. contracts-page.html is the editable UI source; regenerate contracts-ui.js as `export const contractsPage = <JSON string of the HTML>;`.

Internal accounts only. Administrators have global access; country leads can edit assigned countries; regional managers, group leaders and technicians can read their account country. Requester roles are denied, including mixed requester/internal roles. POSTs require same-origin Origin. SQL parameters are bound; each change is batched with its audit snapshot. Organization assignments cannot change on an existing contract. Unique contract references, calendar dates, non-negative amounts and HTTP(S) document URLs are validated server-side. Records are archived through contract status; there is no hard delete.

Reminder dates use Indian/Mauritius calendar days. In-app expiry windows are <=30, 31–60 and 61–90 days; expired dates and cancellation notice deadlines are also shown. Refresh recalculates reminders. This module has no scheduled email delivery or background renewal automation. Renewal outcomes are records: confirming one does not change the parent contract's dates. Contract statuses are manually maintained. Documents are links, not file uploads. Contract values are grouped by currency, not converted or annualized. CSV exports contain the visible filtered register and escape spreadsheet formula prefixes. Audit UI shows the latest 100 changes; snapshots remain stored.

Validation: local SQLite-backed API tests cover unauthenticated/customer exclusion, country isolation, read-only roles, same-origin writes, create/update, entry saves, audit, duplicate references, unsafe URLs, invalid dates, and expiry/notice calculations. API, UI module, inline browser script and integrated entrypoint syntax checks pass. Authenticated live browser create/edit flows were not exercised.
