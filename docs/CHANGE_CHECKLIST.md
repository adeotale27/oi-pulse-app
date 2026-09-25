# StrikLenz AI Change, Dependency, and Risk Management Checklist

This is the canonical checklist for every human, AI, or agent change. Read it
before editing code and complete the applicable steps before shipping.

No change is complete until the applicable code, dependency, data-safety,
testing, documentation, and release checks below are recorded by the AI tool
performing the work. This is the single source of truth; do not create a
parallel checklist.

## 1. Read the required contracts first

- [ ] Read [`AGENTS.md`](../AGENTS.md).
- [ ] Read [`README.md`](../README.md).
- [ ] Read [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md).
- [ ] Read [`docs/ENGINEERING_RULES.md`](./ENGINEERING_RULES.md).
- [ ] Read [`docs/AI_DEVELOPMENT_RULES.md`](./AI_DEVELOPMENT_RULES.md).
- [ ] Read [`docs/VERSIONING.md`](./VERSIONING.md).
- [ ] Read the relevant domain contract:
  - [`docs/DATA.md`](./DATA.md) for Mongo/OI data.
  - [`docs/ABOUT.md`](./ABOUT.md) for API/auth behavior.
  - [`docs/CAS_AUTO_TRADE_15_20.md`](./CAS_AUTO_TRADE_15_20.md) for CAS.
  - [`docs/DEVELOPMENT.md`](./DEVELOPMENT.md) for UI, API, and index work.

## 2. Establish scope before editing

- [ ] Identify the user-visible behavior and its complete path:
  UI component/page → frontend lib/API → FastAPI route → backend service →
  Mongo/Kite/external provider.
- [ ] Search for existing helpers, settings, tests, comments, and callers before
  adding new code.
- [ ] Confirm whether the change touches protected live data. Without explicit
  administrator approval for that exact behavior, do not change Positions, OI,
  OI Change, Open Interest, strike/expiry math, Straddle, CAS, snapshot
  freshness/order, broker-book mapping, or polling semantics.
- [ ] Preserve existing route paths, response keys, auth ownership, test ids,
  and guest/admin boundaries.

## 3. Code comments and change explanations

- [ ] Add a concise comment for major or non-obvious behavior in both frontend
  and backend code: lifecycle transitions, market-hour gates, stale-data rules,
  auth boundaries, provider fallbacks, data precedence, or safety guards.
- [ ] Do not add comments that merely restate the code. Explain **why**, the
  invariant being protected, or the external contract being followed.
- [ ] When changing commented code, inspect every nearby comment and update it
  if it no longer describes the implementation, timing, setting, fallback, or
  safety behavior.
- [ ] When a behavior is important enough to require a comment, also update the
  relevant human/AI contract listed in this checklist.
- [ ] Keep comments free of secrets, access tokens, personal data, and temporary
  debugging output.

## 4. Package, dependency, and supply-chain risk management

Use this section for every change to `frontend/package.json`, `frontend/yarn.lock`,
backend dependency manifests, Python lockfiles, build tooling, plugins, or
transitive dependency resolutions. A package update is a code change even when
application files are untouched.

- [ ] Record the package name, old version, new version, reason, direct
  dependents, and whether the change is a patch, minor, or major update.
- [ ] Inspect release notes, breaking changes, deprecations, supported runtime
  versions, license, and known security advisories before updating.
- [ ] Review the lockfile diff and transitive dependency changes; reject
  unexpected registry, script, native-binary, or broad transitive changes.
- [ ] Check install scripts and post-install behavior. Never execute an
  untrusted package or paste credentials into package tooling.
- [ ] Check secrets, auth, Kite, MongoDB, OI, Positions, Straddle, CAS, and
  broker/payment boundaries for changed behavior or newly reachable code.
- [ ] Run the package manager's immutable/frozen install when available, then
  run focused tests, the complete applicable test suite, lint, compilation,
  production build, and `git diff --check`.
- [ ] Compare bundle size, startup behavior, API behavior, and runtime warnings
  before and after the update where applicable.
- [ ] Define rollback steps: restore the manifest and lockfile together, rerun
  validation, and document any required data/cache migration.
- [ ] Update `CHANGELOG.md`, version files, and this checklist/contracts when
  the dependency changes an invariant, supported runtime, security posture, or
  operational procedure.

## 5. Frontend change files

Use the applicable files below; do not invent parallel configuration or helper
locations.

- UI pages/routes: `frontend/src/pages/<Feature>.jsx`
- UI components: `frontend/src/components/<Feature>.jsx`
- Shared domain logic: `frontend/src/lib/<feature>.js`
- Shared hooks/lifecycle: `frontend/src/hooks/<feature>.js`
- API calls/auth headers: `frontend/src/lib/api.js`
- App routes/bootstrap: `frontend/src/App.js`, `frontend/src/index.js`
- Global styles: `frontend/src/index.css`, `frontend/src/App.css`
- Feature styles: `frontend/src/styles/<feature>.css`
- Frontend tests: `frontend/src/lib/<feature>.test.js` for standalone logic,
  or a Jest test beside the React feature when component behavior is required.
- Frontend version metadata: `frontend/src/lib/appVersion.js`,
  `frontend/package.json`.

Frontend checklist:

- [ ] Test normal, empty, loading, error, stale, permission, mobile, tablet,
  desktop, and retry states where applicable.
- [ ] Test keyboard/focus/accessibility behavior for interactive UI.
- [ ] Test settings persistence and the effect on every consumer.
- [ ] Test both guest and admin visibility/permission behavior.
- [ ] Verify no mobile layout regression and no new header/sidebar growth.
- [ ] Run the correct test runner for the test type; do not treat standalone
  Node assertion files as Jest suites.

## 6. Backend change files

- HTTP routes/auth: `backend/server.py` or the existing domain API module
- OI polling/snapshots: `backend/oi_tracker.py`, `backend/oi_service.py`,
  `backend/oi_lookup.py`
- Market timing/holidays: `backend/market_hours.py`,
  `backend/holiday_calendar.py`
- Positions/P&L: `backend/kite_positions.py`, `backend/trade_ledger.py`
- Universe/index registry: `backend/universe.py`,
  `backend/index_registry.py`
- External providers/telemetry: the relevant `backend/<service>.py`,
  `backend/external_api_registry.py`, `backend/external_api_telemetry.py`
- Backend tests: `backend/tests/test_<feature>.py`
- Backend version metadata: `backend/app_version.py`

Backend checklist:

- [ ] Test valid, empty, malformed, boundary, unauthorized, forbidden, timeout,
  provider-failure, database-failure, retry, and idempotency cases where
  applicable.
- [ ] Test timezone, holiday, market-open/close, stale/live, and cross-session
  boundaries for time-sensitive behavior.
- [ ] Test response shape and backward compatibility, not only status code.
- [ ] Test secret ownership: publisher Kite owns OI; guest Kite owns guest
  books; journal remains admin-only.
- [ ] Test duplicate calls, concurrent refreshes, and repeated writes where the
  operation can be retried.
- [ ] Use structured logging and explicit errors; never silently return a
  success-shaped fallback.

## 7. Documentation and release files

- [ ] Update the closest domain document when behavior, architecture, API,
  settings, data, or operational runbook changes:
  `docs/ARCHITECTURE.md`, `docs/ABOUT.md`, `docs/DATA.md`,
  `docs/DEVELOPMENT.md`, `docs/LOCAL_SETUP.md`, `docs/HOSTING.md`,
  `docs/CAS_AUTO_TRADE_15_20.md`, or a new `docs/decisions/ADR-NNN-*.md`.
- [ ] Update [`CHANGELOG.md`](../CHANGELOG.md) with the user-visible change.
- [ ] Bump all version files together:
  `VERSION`, `frontend/src/lib/appVersion.js`,
  `frontend/package.json`, and `backend/app_version.py`.
- [ ] Update comments in code and the checklist/contracts when the change
  alters an invariant or operating rule.

## 8. Verification and shipping

- [ ] Run the nearest focused backend tests.
- [ ] Run the nearest focused frontend test(s) with the correct runner.
- [ ] Run backend compilation/type/syntax checks for changed Python files.
- [ ] Run the frontend production build.
- [ ] Run `git diff --check`.
- [ ] Inspect the final diff for unrelated files, stale comments, secrets, and
  accidental protected-data changes.
- [ ] Open a PR and merge the finished change to `main`.

## 9. Canonical files for future agents

At minimum, every agent must inspect:

1. `AGENTS.md`
2. `docs/CHANGE_CHECKLIST.md` (this file)
3. `docs/AI_DEVELOPMENT_RULES.md`
4. `docs/ENGINEERING_RULES.md`
5. `docs/VERSIONING.md`
6. `README.md`
7. The relevant domain document and nearest tests
