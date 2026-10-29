# HMT Collabs — Customers & Partners

Deployed at https://hmt-collabs.roshan-parmessa.workers.dev/module/customers.

This directory contains the new module sources, additive D1 migration and the integration patch against the live Worker's index.js. The existing Worker includes other modules not mirrored in this directory. Do not deploy this directory as a standalone Worker. Place organizations.js and organizations-ui.js beside the existing auth.js/index.js, apply integration.patch and apply migrations/organizations.sql to the existing DB binding. The live Worker already has these changes.

## Functions

Organization directory and CSV export; company profiles with multiple organization types; contacts; sites; IT capabilities; agreements and commercial terms; qualifications and compliance; interactions and follow-ups; organization relationships; existing linked work; audited change history.

Types: customer, prospect, partner, supplier, contractor, subcontractor, OEM, distributor, reseller, service provider, consultant and other. Organizations can have more than one type. Existing customer IDs and their linked work are preserved. Organizations are archived through their profile status, without deleting work history.

## Authorization

Internal accounts only. Requester accounts are denied. Super Administrators and Administrators can read/write all countries. Country Leads can read/write only explicitly assigned countries. Regional Managers, Group Leaders and Technicians can read their account's country. No role assignment or customer portal access is granted by creating an organization. POSTs require a same-origin Origin header. Database writes use bound parameters and an audit entry in the same batch.

Document references are HTTP/HTTPS links. Files are not uploaded by this module. Expiry and follow-up dates can be captured, viewed and edited; automated reminders are not implemented here. Account/technical owner names are descriptive fields; they do not grant permissions. Organization directory exports contain only the currently visible filtered rows.

## Verification

JavaScript syntax checks passed for API, UI and integrated Worker entrypoint. Local route tests checked unauthenticated access, customer-role exclusion, country filtering, editing roles, cross-country writes, Origin validation, allowed organization types and unsafe URLs. Additive migration validated in SQLite and applied to D1. Live HTTP checks confirmed module rendering, function options, CSP nonce, no-store and anonymous API denial. Authenticated browser create/edit workflows were not exercised in this session.

## Regional Reporting & Intelligence

Deployed at https://hmt-collabs.roshan-parmessa.workers.dev/module/reporting. Add intelligence.js alongside existing modules, replace reporting-ui.js and apply the updated integration.patch to the current Worker. No reporting schema migration is required. The integration patch is based on the current entrypoint containing enterprise governance. It restores Customers & Partners routing and preserves homepage dashboard removal.

24 report options are organized into Financial, Technical, and Audit & Governance. Each report has data, rule-based intelligence and definitions/coverage views. Financial and Technical also have restricted segment-specific change-history reports. Customers & Partners is included through organization exposure, agreements, portfolio, expiries, data-quality controls and business audit history. Existing source registers are kept separate to avoid unsupported deduplication and double counting.

Filters: authorized country, financial year, optional dates and organization where applicable. Financial years honor enterprise_settings.fy_start_month. Financial values remain separate by currency; forecast projection is won opportunity value plus weighted open pipeline, not invoiced/recognized revenue. Snapshot sections ignore date ranges explicitly; period sections state their date basis. Detail results are capped at 1,000 displayed rows per section with a truncation notice. Aggregates use all matching records. CSV exports and printing use the displayed report and scope. Expiry reporting does not send emails.

Authorization is enforced by the backend: internal roles only; requester accounts are denied; technicians/group leaders see authorized technical reports; financial reports require super_admin/admin/country_lead/regional_manager; audit evidence requires super_admin/admin/country_lead. Country Leads are restricted to assigned countries. Global configuration history requires super_admin/admin. Country filtering applies to business, financial and identity sources. Reports do not accept writes.

Coverage limitations are visible inside the module: no invoicing, payment, margin, time utilization or full immutable audit archive is claimed; regional progress notes are not a complete field-change audit; placeholder module data is not invented.

Validation: all 24 report SQL paths passed with SQLite using the live D1 schema and synthetic fixtures. Tests verified fiscal-year dates, per-currency weighted pipeline and target gap, current backlog visibility, country/organization filtering, role restrictions, invalid dates and anonymous denial. JavaScript syntax checks passed. Live HTTP route, CSP nonce, no-cache and anonymous API tests passed; browser sign-in rendering was checked. Authenticated end-to-end browsing was not performed.
