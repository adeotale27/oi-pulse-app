# Local end-to-end application audit

This is the repeatable procedure for an app-owner request to audit StrikLenz
end to end on a local machine. Use it when explicitly asked for a full/local
application audit; do not run a broad audit in response to an ordinary bug
report or a request scoped to one feature.

## Safety and scope

- Read `AGENTS.md`, `docs/CHANGE_CHECKLIST.md`, `docs/ARCHITECTURE.md`,
  `docs/ENGINEERING_RULES.md`, `docs/AI_DEVELOPMENT_RULES.md`, `README.md`,
  `docs/ABOUT.md`, `docs/DATA.md`, `docs/LOCAL_SETUP.md`, and relevant feature
  contracts before testing.
- Preserve the existing worktree. Never discard or overwrite unrelated staged
  or unstaged work. Do not commit, reset, deploy, or change the user's local
  environment without a direct request.
- Prefer the user's explicitly designated local Mongo database, not Atlas or
  production. Confirm the active database name from safe configuration without
  printing credentials/connection strings. Assume a local DB may contain real,
  non-fixture records; do not dump, quote, export, or include account, journal,
  position, or P&L values in reports.
- Treat the audit as read-only. Do not save settings, clear/purge logs, modify
  credentials, approve/revoke guests, upload/replace data, request manual
  provider polls, run Fresh Pull, inject CAS signals, activate CAS, or place
  broker orders. Do not call paid external APIs merely to test connectivity.
  These require explicit permission for that exact action.
- A local Kite session permits observing connection status and already
  available data. It does not authorize live trades or manual market-data
  refreshes. Avoid changing live-data/poll semantics without explicit admin
  approval.
- Don't restart an already-running service if that would disrupt the owner or
  trigger unrequested external work. Reuse and check existing local services;
  if unavailable, ask before changing their environment or starting a
  potentially stateful integration.

## Audit workflow

1. **Baseline and boundary**
   - Note date/time and repository version.
   - Capture `git status --short` and preserve all pre-existing changes.
   - Identify running frontend/backend endpoints and whether they are the
     intended local processes. Verify local DB isolation using the DB name
     only; never show its URI or secrets.
   - Record auth mode, Kite connectivity/expiry status, and market-open status
     as booleans/status labels only. Never expose tokens, usernames, balances,
     positions, or raw account payloads.
2. **Startup and service health**
   - Check `/ready` and `/api/version`; inspect `/api/status` with credentials
     redacted. Distinguish HTTP readiness from Mongo readiness and broker feed
     freshness.
   - Check browser console/runtime errors and that the expected local page
     mounts.
3. **Walk user journeys read-only**
   - Admin entry and dashboard, public/guest entry states, navigation and
     overflow tabs, desktop/tablet/phone layouts, loading/empty/stale/error
     states, and keyboard/accessibility where feasible.
   - Admin configuration panes, integrations, error-log display, journal
     browsing, Global Markets/ADR screens, CAS status screens, and guest
     access screens. Inspect read-only state only; do not use destructive or
     order-submitting controls.
   - Exercise request/response paths with GETs and safe form validation only.
     Do not submit state-changing forms to “see what happens.”
4. **Trace core data paths**
   - Follow UI → API client → route/auth → service → DB/provider for material
     screens. Verify role boundaries (publisher Kite for OI; guest's own Kite
     for their book; journal admin-only), response shape, settings propagation,
     provider selection, and visible data-freshness cues.
   - Separate calls measured by application telemetry from registry/source
     discovery and from hypothetical capacity projections. Never attribute a
     provider-dashboard total to this app without app-side evidence.
5. **Run automated checks**
   - Run focused tests for confirmed issues, then the full backend suite and
     the frontend Jest suite. Also run frontend lint/build and `git diff
     --check` when relevant.
   - Use the repository's prescribed pytest working directory/options. Record
     exact pass/fail counts. Do not fix unrelated brittle tests during an
     audit unless separately requested.
6. **Verify every suspected issue**
   - Prefer reproducible browser/API behavior or a deterministic test.
   - Record exact screen/route, safe input/setup, expected vs observed behavior,
     source/test references, and confidence.
   - Mark source-only conclusions as source-confirmed, not runtime-reproduced.
     Mark unavailable live integrations as untested; don't infer failure from
     an intentionally closed market, expired session, or absent data.
7. **Produce the report**
   - Create `docs/audits/LOCAL_END_TO_END_AUDIT_YYYY-MM-DD.md` (use the local
     audit date) from the report outline below. Include what passed as well as
     findings and coverage gaps.
   - Findings need a stable ID, severity, status (`open`, `fixed`, `accepted`,
     or `not reproduced`), confidence, impact, exact evidence/reproduction,
     relevant file/symbol links, and validation. Prioritize severity, then
     confidence.
   - Keep user-facing explanations candid: an unavailable flow is not a pass;
     test-fixture flakiness is not automatically a product defect; a projection
     is not observed production usage.
   - Sanitize the report: no credentials, tokens, Mongo URIs, names, financial
     account values, raw account records, or secret-bearing screenshots.
   - Update the audit todo/report artifact if the session uses one. Do not
     modify product code during the audit unless the owner asks to fix findings.

## Report outline

Each dated report should contain:

1. **Executive summary** — version, local environment boundary, date, completion
   status, severity counts, and one-paragraph overall result.
2. **What went well** — checks and flows that worked, with concrete evidence.
3. **Findings** — prioritized table/list with stable IDs and status, followed
   by evidence, repro, impact, and fix/validation detail for each.
4. **Automated validation** — commands, exact counts, failures and whether each
   is product behavior, test-fixture issue, or infrastructure limitation.
5. **Data/integration boundary** — local DB identity without URI, auth mode,
   broker/feed status, provider telemetry caveats, and any live actions not
   performed.
6. **Coverage matrix** — tested, partially tested, untested, and blocked flows.
7. **Follow-up** — ordered fix recommendations, without silently implementing
   them during an audit-only request.

`docs/audits/LOCAL_END_TO_END_AUDIT_2026-09-29.md` is the sanitized example
from the first local run. It preserves the findings and limitations from that
run; it is not a claim that every listed path received a complete live-market
test.
