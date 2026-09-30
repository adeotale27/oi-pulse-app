# StrikLenz — development

For a first run, follow **[LOCAL_SETUP.md](./LOCAL_SETUP.md)** (venv, yarn, Mongo, `uvicorn`, CRA). This page is the map for changing the system without breaking it.

Before making any change, use the canonical
[change maintenance checklist](./CHANGE_CHECKLIST.md). It lists the required
frontend/backend file locations, comment rules, tests, documentation, version
updates, and shipping steps for every AI or human agent.

The Positions phone header keeps the page title, position status, and warning
controls on separate compact rows. Its PositionMeter entry is labeled "PMeter"
on phone widths and retains the full name on larger screens. Keep mobile chrome
within the panel width without changing controls or Positions behavior.

For an app-owner request to audit the full application locally, follow the
read-only [end-to-end audit workflow](./END_TO_END_AUDIT.md) and create a dated,
sanitized report in `docs/audits/`. The first-run example is
[LOCAL_END_TO_END_AUDIT_2026-09-29.md](./audits/LOCAL_END_TO_END_AUDIT_2026-09-29.md).

## Loading and unavailable data

Use the shared `DataLoadingState` for app/auth startup and compact dashboard
panel loading. Keep a panel's last successful data visible during refresh and
label it as updating. Stop the animation after a failed request or an empty
closed-session response, and explain that live data is unavailable rather than
leaving an indefinite loader. Respect the global reduced-motion preference.
These states are presentation-only and must not change the provider or OI poll
cadence.

Market Memory is derived from successful OI snapshots and makes no separate
market-data request. Its card refreshes the summary every 30 seconds while
visible, preserves the last successful result on a read error, and reports the
age of the latest snapshot. Shared visibility is controlled in Admin
configuration → Data collection; relevance is time-weighted over 20 days.
Its six-level shortlist prioritizes up to three historically supported zones
below spot and three above when both sides have qualifying evidence, then fills
unused slots with nearby structures. Distance is `spot - level`: positive means
price is above a level, negative means it is below. Missing-side levels are not
fabricated. Keep its refresh lifecycle separate from the OI poller.

### Positions Risk Management

The Risk Management subpage is an additive, read-only view inside Positions. It
consumes the already-enriched rows from the existing caller-owned `/positions`
book and does not add a Kite request or change the book mapping or poll cadence.
The option Delta, Gamma, Theta, and IV are model-derived from the existing
option LTP, underlying spot, strike, and expiry inputs; they are not Kite
Greek/IV quotes. Scenarios reprice each option at the stressed inputs and
compare the modeled price with the live option quote; they are estimates, not
predictions. Portfolio comparisons use INR impact for a common percentage move
because raw index-point Deltas across different underlyings are not directly
additive.

### PositionMeter Greek and IV conventions

- **Delta:** approximate INR change for a 1% move in each held underlying,
  holding IV and time fixed. The cross-index portfolio sensitivity assumes all held
  underlyings move by the same percentage and direction; it is not a
  correlation forecast.
- **Gamma:** the second-order curvature term, `½ × signed Gamma × underlying
  move²`, shown in INR for the selected percentage shock. Equal up/down moves
  have the same Gamma-only sign. Short Gamma can make losses accelerate as
  Delta changes.
- **Theta:** estimated INR change over one calendar day, holding spot and IV
  fixed. The shared helper caps displayed theta by remaining extrinsic value
  near expiry; it is still theoretical, nonlinear, and not a daily credit.
- **Vega:** estimated INR response per one IV percentage point. PositionMeter
  multiplies this by the selected IV-point shock; signed quantity makes long
  and short Vega point in opposite directions.
- **Implied volatility:** not supplied as a direct Kite quote. It is inferred
  from option LTP, spot, strike, and expiry with the frontend Black–Scholes
  solver (6.5% continuously compounded rate; no dividend input). Quote spread,
  staleness, and model assumptions can distort it. An increase from 20% to
  21% is +1 IV point (100 basis points), not a 1% relative increase.

The main market-impact view uses plain-language scenarios and full option
repricing. Additional whole-book estimates are tucked under a collapsed
advanced section so the default page can focus on the seller's expiry groups.
PositionMeter's compact summary uses the existing `/positions` `pnl_today`
broker total for Today's P&L (booked plus open MTM). "Premium captured" is
open-short quantity × multiplier × (average entry price − latest positive option LTP);
its percentage is weighted against the total entry premium. It is an entry-to-
current mark, not today's booked profit, and is not an executable exit quote.
It is before brokerage and other costs.
"Premium left to decay" sums remaining extrinsic value on open short options;
it excludes hedge costs and is neither net package profit nor a guarantee.
Both totals are withheld if any relevant short leg lacks required inputs.
PositionMeter sorts the full open book by package alert urgency first while
keeping legs together, then prioritizes sold legs near the existing Positions
adjustment band. The alert names the option and its reason. Strike coverage
compares only equal index, expiry, strike, and option type; this is a quantity
offset, not a broker-defined strategy or a guarantee of protection. The
Positions feed has no per-option quote timestamp, so freshness shows the age of
the last Positions read and explicitly discloses that missing quote time.
The "Check now" list includes only sold legs with a package warning, missing
risk data, or the existing near-strike adjustment flag; it shows same-index,
same-expiry, same-strike, same-option-type bought quantity as a comparison,
not as proof of a strategy or guaranteed cover. The extra expiry attention
label requires both the existing Positions expiry-day flag and near-strike
flag, so expiry by itself does not create this check-now cue. This does not
change the package risk calculations.
PositionMeter also displays the existing Positions daily booked-loss guard
(caution / stop-adds / defend at the configured wallet percentages) and its
available-funds "crumbs" check (<0.5% of wallet). These are existing controls,
not new PositionMeter limits; missing inputs are shown as unavailable. Open
MTM is not substituted for the guard's booked-after-charges P&L.
Position
alerts are evaluated on a same-index, same-expiry package: every leg in that
bucket is repriced together, so bought options can offset sold-option stress.
The positions feed does not provide a strategy identifier, so this bucket is a
transparent risk grouping, not proof that every leg belongs to one intended
trade. The default list keeps those buckets together and orders strikes from
low to high, with CE and PE legs visible at each strike. The seller package
view summarizes combined open P&L, INR Delta per 1% move, net Theta per day,
net Gamma impact for the selected shock, current close value of sold options,
and full-repricing scenario P&L. Its strike table keeps CE and PE sell/buy
quantities separate and shows the net Delta and Gamma contribution at each
strike; quantities already include lots and are not multiplied by lot size
again. By default, only the expiry summary, open P&L, net Delta, and net Theta
are shown. Strike details and scenario estimates are collapsed until requested.

Bought options are labeled **Hedge leg** and are not independently assigned
High/Watch solely because their premium may decay. Alert status is assigned to
the sold legs based on the combined package outcome. A package with missing
required market inputs is marked unavailable as a whole rather than
understating its risk. Near-expiry short Gamma can trigger Watch only when the
net package Gamma is short and material. These labels are alerts, not
maximum-loss estimates; short-option losses may exceed the current premium by
a large amount.

The risk thresholds and shock sizes are user-adjustable and stored in the
current browser. Watch starts when the worse modeled loss from the configured
up/down underlying and IV shocks plus one day reaches the Watch percentage of
the package's current sold-option value. High alert uses the configured
critical percentage. An adverse recent IV move can also reach these limits
when a recent IV change is available for every leg in the package. “Within
limits” means these tests didn't reach a threshold; it is not a safety
guarantee. IV is implied volatility, shown as a percentage; an IV move from
20% to 21% is +1 IV point, not a 1% option-price change. IV change compares two
recent successful Positions reads in the current browser session; the
existing feed does not provide option quote timestamps or durable option-IV
history. Missing Greeks, unsupported instruments, failed reads, and aged book
responses, as well as an unavailable option expiry needed to group a hedge, are
displayed as unavailable rather than zero exposure.

Further reading on option mechanics (definitions and general educational
material; not Indian contract specifications or trade recommendations):
[OIC Greeks overview](https://www.optionseducation.org/advancedconcepts/understanding-options-greeks),
[Delta](https://www.optionseducation.org/advancedconcepts/delta),
[Gamma](https://www.optionseducation.org/advancedconcepts/gamma),
[Theta](https://www.optionseducation.org/advancedconcepts/theta),
[Vega](https://www.optionseducation.org/advancedconcepts/vega), and
[OIC glossary](https://www.optionseducation.org/referencelibrary/optionsglossary?filter=I).

The maintenance page should remain vertically scrollable on short phone
viewports; desktop can retain its fixed-screen composition. Validate the
maintenance shell at a narrow phone width and short viewport height.

## Prerequisites

Python 3.11+, Node 18+ / Yarn 1.x, MongoDB 6+, optional Kite API key + daily token.

## Environment

Copy examples (real files are gitignored):

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

Documented keys: [LOCAL_SETUP.md](./LOCAL_SETUP.md). Never put Kite secrets in git or `REACT_APP_*`.

## Commands

```bash
# API
cd backend && source .venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --reload --host 0.0.0.0 --port 8000

# UI
cd frontend && yarn install && yarn start

# Tests (from backend/)
# Tests (from backend/)
python -m pytest tests/test_universe.py tests/test_fno_symbol.py tests/test_expiry_kind.py tests/test_trade_ledger.py tests/test_market_hours.py tests/test_event_risk.py tests/test_holiday_calendar.py tests/test_guest_access.py tests/test_app_brand.py tests/test_oi_change_lookback.py tests/test_cas_auto_trade.py -q

# Frontend unit (standalone Node assertion files; run individually or via the
# repository's frontend test harness, not as a Jest glob)
node frontend/src/lib/universe.test.js
node frontend/src/lib/expiryKind.test.js
node frontend/src/lib/dataTruth.test.js
node frontend/src/lib/appVersion.test.js
node frontend/src/lib/optionSide.test.js
node frontend/src/lib/indexEventRisk.test.js
node frontend/src/lib/holidays.test.js
node frontend/src/lib/holidayReminder.test.js
node frontend/src/lib/journalYearHeat.test.js
node frontend/src/lib/journalPct.test.js
node frontend/src/lib/capitalGuard.test.js
node frontend/src/lib/positionsBrain.test.js
node frontend/src/lib/positionsRisk.test.js
node frontend/src/lib/positionHedge.test.js
node frontend/src/lib/marketIntel.test.js
node frontend/src/lib/tickerRegime.test.js
node frontend/src/lib/positionsColumns.test.js
node frontend/src/lib/adr.test.js
```

Health: `http://localhost:8000/api/status`. UI talks to `REACT_APP_BACKEND_URL`.

## Lint / format / build

Frontend: `yarn build` (CRA). ESLint is present; do not mass-reformat unrelated files. Backend: follow existing style; no Black mandate in-repo.

## Debugging

- Tracker not polling: `/api/status` mode `offline` vs `kite`; market hours; token expiry.
- Empty chain: instruments dump name/segment mismatch (`universe.kite_name` + `segment`).
- Guest book empty: they must Connect Zerodha; publisher token is not used.

## Add an underlying

**Preferred:** Admin → **Index management** (desktop Admin menu, or phone/tablet Settings gear) → search Kite → Enable / Disable. That writes `index_registry` and `enabled_indices`. The existing poller picks it up.

Daily F&O dump for Index management is **not** auto-run after token save. Search or Sync in Index management loads the Kite name list on demand. Optional CLI: `cd backend && python preload_fno.py`.

### Checklist (required for every new index, stock, or commodity)

Copy this into the PR. Do not ship with boxes unchecked.

- [ ] **Session hours researched** — NSE index/stock F&O vs MCX group (non-agri 09:00–23:30 IST in US DST / 23:55 US standard; select agri 21:00; other agri 17:00). Put `session_group` on the catalog row (`nse` / `mcx_non_agri` / `mcx_select_agri` / `mcx_agri`).
- [ ] **Poll only in those hours** — `index_in_session(id)` must skip the name outside its window. The loop stays alive if *any* enabled name is open (NIFTY must not keep polling after 15:40 just because Gold is live).
- [ ] **Positions** — Kite `positions()` is the full book. Do not filter to NIFTY/SENSEX/BANKNIFTY. New names must appear as legs.
- [ ] **Trade journal** — those legs snapshot into the admin journal. Enabled MCX majors (GOLD, CRUDEOIL, …) have their own year-heatmap row. FINNIFTY / stocks / minis stay in `booked_index_pnl.OTHER`.
- [ ] **Year heatmap** — Trade Journal year view lists desk + enabled MCX majors, plus an **Others** row.
- [ ] **Phone + existing chrome** — ship the same control on phone. Fit extra names into the **existing** header / sidebar / sticky index row (`INDEX_CHIP_CAP` = 3: dropdown or slide, do not grow those panes). The phone index picker must be able to select the new name so its OI loads. Do not invent a larger window.
- [ ] **Enable path** — first Kite dump can exceed 20s; Index management Enable/inspect uses a 90s timeout. Admin lists use Index-management-enabled names (`known_indices`); Tracked indices only control polling (`enabled_indices`). Kite `lot_size` fills chart-signal lots on sync/Enable.
- [ ] **Desk AI** — if the name is MCX and it is the selected index, Desk AI loads that commodity tape; NSE selection keeps the cash heavyweight tape.
- [ ] **Admin config first** — before hardcoding an interval or similar, check SettingsModal / `DEFAULT_SETTINGS`. Use the saved value end to end.
- [ ] Catalog lockstep: `backend/universe.py` **and** `frontend/src/lib/universe.js` (quote hint, `session_group`, `pollable`).
- [ ] Tests: hours (DST vs standard if MCX), symbol prefix, journal OTHER, universe catalog.
- [ ] Version lockstep per [VERSIONING.md](./VERSIONING.md).
- [ ] **Merge the PR to `main`.** Finished work does not sit on a feature branch.

Manual/code path (still valid):

1. Add a row to `backend/universe.py` **and** `frontend/src/lib/universe.js` if it needs a quote hint.
2. MCX majors (CRUDEOIL / GOLD / SILVER / NATURALGAS) are catalogued but **paused on the live desk** (`MCX_DESK_AVAILABLE`). Do not Enable them until that flag is restored.
3. Tests in `test_universe.py` / `test_index_registry.py` / `test_market_hours.py` / `test_trade_journal.py`.
4. Bump version per [VERSIONING.md](./VERSIONING.md).
5. Open a PR and **merge to main**.

Until Enable, the live desk stays NIFTY / SENSEX / BANKNIFTY. Catalog rows are documentation for the next ship.

## Ship / merge to main

Every finished change: bump version → PR → **merge to `main`**. Do not leave work only on `cursor/…` branches. This is also in [ENGINEERING_RULES.md](./ENGINEERING_RULES.md) and [AGENTS.md](../AGENTS.md).

Public vs desk book: guests never see publisher positions, journal, or header Today P&L. Public Positions (if ticked) is the guest’s own Kite login only. `/config` stays secret-free; `/status` strips `kite_user_id` for non-admin.

## Add an API

- New router function in `server.py` (or extract a router if the file is already being touched).
- Preserve old paths. Additive JSON keys only.
- Admin vs public: `Depends(require_admin)` vs existing guest rules.
- Document in [ABOUT.md](./ABOUT.md) if it is user-facing.
- **API Configuration is automatic:** add the provider URL in its backend module and the running source inventory will include it in Admin → API Configuration. Add its hostname metadata in `backend/external_api_registry.py` when it is a new provider, and use the shared HTTP telemetry wrapper; never create a separate hand-maintained API-settings list.

## Add a Mongo collection

- Name + indexes in [DATA.md](./DATA.md).
- Optional fields on existing docs; do not rename `index` / `timestamp` on `oi_snapshots`.
- No wipe except existing Fresh Pull.

## Modify an existing feature

1. Find the current path (UI → `/api` → module).
2. Reuse `universe`, `holidays`, payoff helpers.
3. Keep `data-testid`s.
4. Run the nearest tests.
5. **Admin configuration first.** For any interval, hours, threshold, page tick, or other tunable: search `DEFAULT_SETTINGS` / SettingsModal / `POST /settings` before hardcoding. Wire UI, sampler, REST, WS, and countdowns to the saved value (clamp only to the allowed range, never a tighter secret cap).

## Protected live-data checklist

The following are production-critical and must not be changed as part of UI polish,
configuration cleanup, or unrelated maintenance:

- [ ] **No OI behavior change** — do not alter Open Interest, OI Change, strike
  calculations, expiry selection, snapshot ordering, freshness rules, or polling
  semantics without explicit admin approval for that specific change.
- [ ] **No Positions behavior change** — do not alter broker-book retrieval,
  position mapping, P&L, guest/admin token ownership, or position-derived risk
  calculations without explicit admin approval.
- [ ] **No Straddle behavior change** — do not alter ATM selection, premium
  calculation, samples, CAS logic, or trade signals without explicit admin approval.
- [ ] **No market-data contract change** — preserve existing API paths, response
  keys, Kite ownership, and stored snapshot fields.
- [ ] **Safe scope confirmed** — UI labels, layout, accessibility, loading states,
  and explicitly requested admin-configurable values are the only default-safe
  changes. If a requested fix crosses this boundary, stop and ask before editing.

## Add a UI component

- `frontend/src/components/Name.jsx`. Data via props or `api`.
- Index lists: `DESK_IDS` / `normalizeEnabledIndices`, never a new `["NIFTY",…]` literal.
- **Phone in the same PR.** Mirror the control on the phone chrome (sticky bar, Settings gear, bottom nav). Do not leave it in a desktop-only dropdown.
- **Do not grow header / sidebar / sticky panes.** Extra items use the existing slot: `INDEX_CHIP_CAP` (3) then dropdown or horizontal slide. Do not invent a larger window.

## External integration

Kite stays in `oi_service` / `user_kite` / `kite_positions`. Telegram in `notifier.py`. Do not call Kite from the browser for OI.

## CAS Auto Trade (15:20)

Operator runbook (clocks, Live vs Paper, first-print rules, CE/PE math): [CAS_AUTO_TRADE_15_20.md](./CAS_AUTO_TRADE_15_20.md). Do not rewrite `CasPanel.jsx` / `cas_bridge.py` “for cleanliness.”

## Deployment

[HOSTING.md](./HOSTING.md). Set `CREDENTIALS_FERNET_KEY` in production. `ENABLE_DEV_MOCK` must stay false.
