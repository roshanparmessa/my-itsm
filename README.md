# HMT Collabs

Regional collaboration platform for IT service desk, projects, presales, RFPs, POCs, quotations, customers, assets, interventions, contracts, SLAs, renewals and automation.

## Implemented foundation

- Responsive tile-based landing page, with **illustrative** KPIs.
- Cloudflare Worker app and D1 migrations.
- Schema foundations for support groups, multi-group membership, tickets, workflow rules, customers, projects, opportunities and renewals.
- Country reference records: Mauritius, Madagascar, Rwanda and Burundi.

**Not production ready:** tiles are placeholders; authentication, actual ticket submission, workflow execution, permissions, attachments, notifications and deployment are not yet implemented. Ticket API access is intentionally blocked.

## Run locally

1. Install Node.js 20+ and run `npm install`.
2. Run `npx wrangler d1 create my-itsm-db`.
3. Replace the database ID placeholder in `wrangler.jsonc`.
4. Run `npm run db` to apply D1 migrations locally.
5. Run `npm run dev` to preview.

## Deploy after configuration

Run `npx wrangler login`, then `npm run db:remote`, then `npm run deploy`. Cloudflare is not yet connected for direct deployment. The Cloudflare Worker name is currently `my-itsm` until the configuration is updated.

## Production security requirements

Implement verified requester access, secure sessions, role/group/region authorization, public submission rate limits and anti-abuse protection, attachment scanning and restrictions, tenant isolation, audit trails, backups, and tested restoration before handling real data.

The repository is currently public; make it private before adding confidential configuration or proprietary business logic.
