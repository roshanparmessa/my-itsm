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
