# Local end-to-end audit — 2026-09-29

## Executive summary

- **Audited version:** V14.80 during the initial runtime audit; subsequent
  source changes through V14.81 fixed four findings and were validated locally.
- **Environment:** Local frontend/backend and a separately named local Mongo
  database; no production/Atlas database was intentionally queried.
- **Status:** Partial audit. Ten findings were recorded; four are fixed in
  V14.81 and six remain open. Live-market polling and several role-specific
  workflows were unavailable or not exercised.
- **Overall:** Frontend surfaces and selected admin/API behavior were exercised,
  and core tests largely passed. The evidence found a carry-state presentation
  risk, missing aggregate Twelve Data daily-credit protection, settings-save
  hazards, inaccurate poll feedback, permissive ADR thresholds, and UI/access
  clarity issues. This report is a record of that run, not a certification.

## What went well

- Local `/ready` returned HTTP 200 and the dashboard mounted in the browser.
- The local admin-only development bypass was active as configured; the browser
  showed its warning. Auth route dependencies and admin-only journal route
  guards were source-reviewed.
- After a local Kite session was connected, `/api/status` reported the tracker
  running in Kite mode, connected, and without a token issue.
- Dashboard views, overflow navigation, and 390px/842px layouts were exercised.
- Admin configuration panes, Global Markets/ADR controls, API inventory and
  error-log paths were inspected without saving changes.
- Local Mongo was separate from Atlas. The database was not pristine; no
  stored account/position values are included here.
- V14.81 focused tests passed: backend ADR/registry **21 passed**; frontend
  targeted Jest **5 tests passed**. Full frontend Jest was **11 passed**,
  ESLint passed, and production build compiled successfully.

## Findings

### AUD-001 — Carry brief can affirm holdability without live OI evidence

- **Severity/status:** High · open
- **Confidence:** 9/10
- **Evidence:** Without a Kite session, the dashboard showed no OI/feed while
  the carry brief used affirmative “holdable” wording. Missing signals default
  to `CARRY_OK`; missing OI does not block that language.
- **Impact:** A user could mistake an unsupported carry description for
  evidence from a current OI feed.
- **References:** `frontend/src/lib/overnightBrief.js`,
  `frontend/src/lib/carryFocus.js`, `frontend/src/components/OvernightGapBrief.jsx`.
- **Validation:** Reproduced locally in the no-feed state. No scoring or
  protected live-data behavior was changed.

### AUD-002 — OI/Straddle can remain in loading placeholders after unavailable data

- **Severity/status:** Low · open
- **Confidence:** 9/10
- **Evidence:** With no usable snapshot, OI returned 503 and its loading copy
  persisted after 10 seconds; Straddle history failures leave loading metadata.
- **Impact:** The page does not clearly distinguish unavailable data from a
  request still in progress. A separate feed warning reduces, but does not
  eliminate, the ambiguity.
- **References:** `frontend/src/pages/Dashboard.jsx`,
  `frontend/src/components/OIChart.jsx`,
  `frontend/src/components/StraddleChart.jsx`.
- **Validation:** Reproduced in the local no-feed state.

### AUD-003 — Overflow tabs lose selected-tab and panel-label semantics

- **Severity/status:** Medium · open
- **Confidence:** 10/10
- **Evidence:** At 842px, selecting Global Markets from More left no selected
  `role=tab`; the active More button lacked `aria-selected`, and the tabpanel
  referenced an absent trigger ID.
- **Impact:** Assistive technology may not identify the active view or panel
  label.
- **References:** `frontend/src/components/OverflowTabBar.jsx`,
  `frontend/src/pages/Dashboard.jsx`, `frontend/src/components/ui/tabs.jsx`.
- **Validation:** Reproduced in the browser.

### AUD-004 — Local developer warning intercepts mobile dock navigation

- **Severity/status:** Medium · open
- **Confidence:** 10/10
- **Evidence:** At 390px, browser automation found the fixed warning overlay
  intercepted the mobile Pages control; the warning had a higher stacking
  order than the dock.
- **Impact:** The intended mobile UI-testing flow is obstructed while local
  passwordless mode is active.
- **References:** `frontend/src/components/AuthGate.jsx`,
  `frontend/src/components/MobileBottomNav.jsx`.
- **Validation:** Reproduced by browser click interception.

### AUD-005 — Settings read failures allowed fallback defaults to be saved

- **Severity/status:** Medium · fixed in V14.81
- **Confidence:** 10/10
- **Evidence:** Admin Config and Market Intel retained defaults after a failed
  `/settings` read and could submit a settings payload.
- **Impact:** A failed read could overwrite persisted polling, timing,
  visibility, or retention settings.
- **Fix:** Both surfaces now show the load failure and a retry action, and block
  settings saves until the saved settings load. Save handlers also enforce the
  guard.
- **References:** `frontend/src/components/SettingsModal.jsx`,
  `frontend/src/components/MarketIntelAdmin.jsx`,
  `frontend/src/lib/settingsWriteGuard.js`.
- **Validation:** Guard regression test passed in the V14.81 frontend suite.

### AUD-006 — API inventory called discovered providers “Active”

- **Severity/status:** Low · fixed in V14.81
- **Confidence:** 10/10
- **Evidence:** The summary counted all source-discovered providers as active,
  including providers with no request telemetry. A telemetry-free registry
  snapshot had zero requests; this did not prove a provider was configured or
  called.
- **Impact:** Inventory could imply use that was not demonstrated by telemetry.
- **Fix:** Count now reflects providers with telemetry-recorded calls today;
  the UI distinguishes “Tracked providers” from “Called today”.
- **References:** `backend/external_api_registry.py`,
  `frontend/src/components/ApiConfigurationModal.jsx`.
- **Validation:** Backend registry tests passed for zero and non-zero
  telemetry.

### AUD-007 — Manual ADR poll feedback could claim success after rejection

- **Severity/status:** Medium · fixed in V14.81
- **Confidence:** 10/10
- **Evidence:** The client ignored a 200 response body and always showed
  “Poll queued”, including when the poll returned `ok=false`.
- **Impact:** Operators could miss disabled/rate-limited polls or confuse
  market-closed skips with a fetched result.
- **Fix:** The UI distinguishes failure, market-closed skip, and completed
  polls with counts.
- **References:** `frontend/src/components/AdrAdminModal.jsx`,
  `frontend/src/lib/adrAdmin.js`.
- **Validation:** Frontend helper tests cover rejected, closed, and successful
  poll responses.

### AUD-008 — ADR thresholds accepted invalid negative values

- **Severity/status:** Medium · fixed in V14.81
- **Confidence:** 10/10
- **Evidence:** Runtime check showed `large_move({"change_percent": 0}, -0.1)`
  returned true.
- **Impact:** A negative threshold could classify unchanged quotes as large
  moves and cause noisy alerts.
- **Fix:** UI and API reject non-finite/non-positive thresholds; alert logic
  ignores invalid persisted values.
- **References:** `frontend/src/components/AdrAdminModal.jsx`,
  `backend/adr_api.py`, `backend/adr.py`.
- **Validation:** Backend tests cover threshold bounds and zero-change
  behavior; frontend validation tests passed.

### AUD-009 — Twelve Data cadence did not cap aggregate daily credits

- **Severity/status:** High · open
- **Confidence:** 10/10 that there is no aggregate cap; account usage
  attribution confidence is low
- **Evidence:** User-provided Twelve Data dashboard screenshot showed
  **1,333 / 800** API credits used, minute average **1 / 8**, maximum **3 / 8**.
  This is account-wide usage, not proof those requests came from StrikLenz.
  Separately, a schedule-based capacity projection was 2,514 weekday credits
  if all defaults were enabled; the seven default FX instruments alone
  projected 1,008/day. These are capacity projections, not observed app calls.
- **Impact:** Per-instrument 10-minute pacing can still exceed the account's
  daily allowance when enough instruments/ADRs are enabled.
- **References:** `backend/adr.py`, `backend/global_markets.py`,
  `docs/decisions/ADR-011-indian-adrs.md`.
- **Validation:** Source/schedule review. No extra provider calls or daily
  quota policy were applied during this audit.

### AUD-010 — `/ready` can remain green after Mongo startup failure

- **Severity/status:** Medium · open
- **Confidence:** 9/10
- **Evidence:** `/ready` aliases an immediate process health route. Mongo boot
  runs in a one-shot background task; on connection failure it logs and exits
  without retry while `/ready` still returns 200.
- **Impact:** An orchestrator using `/ready` alone could treat an unusable
  backend as ready.
- **References:** `backend/server.py` health handlers and `_boot`.
- **Validation:** Source-confirmed; failure behavior was not induced against
  the user's local DB or production orchestrator.

## Automated validation

The initial full backend run was **348 passed / 1 failed (349 total)**. After
V14.81 fixes it was **355 passed / 1 failed (356 total)**. The same failure
occurred both times:

- `tests/test_global_markets.py::test_global_market_session_gates_closed_venues`
- The fixture uses a fixed historical datetime for `instrument_session_open`,
  then calls `normalize(nasdaq, None)`, which uses the actual current clock and
  reports `UNKNOWN` during a live session instead of expected `CLOSED`.
- This is a time-dependent test fixture failure, not established evidence of a
  production session-gating defect. It remains unfixed.

V14.81 frontend full suite: **5 suites / 11 tests passed**; ESLint and
production build passed. `git diff --check` passed at the time of the run.

## Data and integration boundary

- Backend process was configured to use a local isolated Mongo DB, not Atlas.
- Admin bypass was loopback-only and enabled for local testing.
- Kite tracker status showed connected in Kite mode and no reported token
  issue. At the observed time (01:09 IST), markets were closed, no successful
  poll was present, and `GET /api/oi/NIFTY` returned 503 “No data yet”.
- No live-market OI refresh, manual provider poll, Fresh Pull, settings save,
  CAS action, or broker order was performed.
- The user screenshot's Twelve Data usage cannot identify caller/source; app
  registry entries likewise do not prove provider calls.

## Coverage matrix

| Area | Coverage | Notes |
|---|---|---|
| Startup/readiness/auth entry | Tested | Local endpoints and bypass state |
| Dashboard/navigation/responsive | Partial | Main views, overflow, selected mobile/tablet states |
| Admin settings/integrations | Partial | Read-only screens and selected failures/source paths |
| ADR/provider controls | Source + focused tests | No manual provider request |
| Journal/admin route guard | Source reviewed | Journal UI/screenshot CRUD not fully exercised |
| Guest onboarding/approval | Untested end to end | Access-control state not mutated |
| CAS/auto-trade | Untested operator flow | No inject/activation/order action |
| Live OI/Kite polling | Blocked by closed market at test time | Connected status alone is not a live-feed validation |
| Deployment proxy/CORS | Untested | Local browser only |
| Full test suites | Tested | One known current-clock-dependent backend test fails |

## Follow-up

1. Fix AUD-001 with explicit “unknown/no live OI” wording when evidence is
   unavailable.
2. Add an aggregate Twelve Data daily-credit guard after the owner chooses the
   desired safety reserve and behavior at the cap; do not infer account usage
   from the provider dashboard alone.
3. Fix AUD-003 and AUD-004 accessibility/mobile navigation.
4. Decide whether `/ready` should include Mongo readiness and add controlled
   retry/health semantics.
5. Complete guest/journal/CAS read-only flows and repeat Kite-dependent checks
   during a market session, with no live orders or state-changing actions.
