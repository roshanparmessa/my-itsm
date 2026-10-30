# Service Desk setup checkpoint — 30 October 2026

The live five-minute Service Desk scan completed successfully at 07:50:51 Mauritius time on 30 October 2026, evaluating zero managed tickets. This verifies scheduler execution, not authenticated customer acceptance testing.

All 16 country/priority policy defaults exist across Mauritius, Madagascar, Rwanda and Burundi. They remain 24×7 elapsed-time defaults with no SLA pause on hold:

| Priority | Response | Resolution |
| --- | --- | --- |
| Critical | 15 minutes | 4 hours |
| High | 1 hour | 8 hours |
| Medium | 4 hours | 24 hours |
| Low | 8 hours | 72 hours |

These defaults are operational configuration, not an assertion that every customer contract has those targets. No SLA policy has been falsely recorded as independently reviewed.

Four starter process guides have been prepared for each of the four countries, for 16 knowledge drafts total: intake/classification/routing; SLA warning and breach triage; project task/ticket execution; knowledge review and ticket citation. They are owned by the sole active global administrator and explicitly audited as assistant-prepared drafts. They are not published and cannot support ticket closure until independently reviewed. These process guides do not replace the specific technical remediation material used on a ticket.

`migrations/service-desk-starter-drafts.sql` is idempotent. It inserts only missing draft references, preserves existing edits and published material, creates one setup audit event per draft, and seeds only if exactly one active global administrator can own the drafts. `tests/service-desk-starter-drafts.test.mjs` verifies unpublished status, scope, repeat safety and audit deduplication.

At this checkpoint there are no active delivery departments/teams or routing rules. The only active internal account is the existing global administrator/country lead. Assigning technical ownership to that account without an operational decision would misrepresent the support team. Unmatched tickets therefore remain in triage with the existing unassigned-ticket notification workflow.

Remaining input: names, work emails and country responsibilities for the initial Service Desk engineers and independent knowledge reviewers. Confirm any department/team responsibilities and contract-specific SLA exceptions. Do not fabricate reviewer accounts, publish under the author's identity or claim customer sign-off. Live signed-in UAT remains pending.
