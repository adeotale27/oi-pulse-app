# OI Pulse — development

For a first run, follow **[LOCAL_SETUP.md](./LOCAL_SETUP.md)** (venv, yarn, Mongo, `uvicorn`, CRA). This page is the map for changing the system without breaking it.

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
python -m pytest tests/test_universe.py tests/test_fno_symbol.py tests/test_market_hours.py -q

# Frontend unit (Node can run assert files)
node frontend/src/lib/universe.test.js
node frontend/src/lib/journalYearHeat.test.js
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
- [ ] **Enable path** — first Kite dump can exceed 20s; Index management Enable/inspect uses a 90s timeout. Admin configuration ticks must keep extras already enabled (union `known_indices` with `enabled_indices`).
- [ ] **Desk AI** — if the name is MCX and it is the selected index, Desk AI loads that commodity tape; NSE selection keeps the cash heavyweight tape.
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

## Add an API

- New router function in `server.py` (or extract a router if the file is already being touched).
- Preserve old paths. Additive JSON keys only.
- Admin vs public: `Depends(require_admin)` vs existing guest rules.
- Document in [ABOUT.md](./ABOUT.md) if it is user-facing.

## Add a Mongo collection

- Name + indexes in [DATA.md](./DATA.md).
- Optional fields on existing docs; do not rename `index` / `timestamp` on `oi_snapshots`.
- No wipe except existing Fresh Pull.

## Modify an existing feature

1. Find the current path (UI → `/api` → module).
2. Reuse `universe`, `holidays`, payoff helpers.
3. Keep `data-testid`s.
4. Run the nearest tests.

## Add a UI component

- `frontend/src/components/Name.jsx`. Data via props or `api`.
- Index lists: `DESK_IDS` / `normalizeEnabledIndices`, never a new `["NIFTY",…]` literal.
- **Phone in the same PR.** Mirror the control on the phone chrome (sticky bar, Settings gear, bottom nav). Do not leave it in a desktop-only dropdown.
- **Do not grow header / sidebar / sticky panes.** Extra items use the existing slot: `INDEX_CHIP_CAP` (3) then dropdown or horizontal slide. Do not invent a larger window.

## External integration

Kite stays in `oi_service` / `user_kite` / `kite_positions`. Telegram in `notifier.py`. Do not call Kite from the browser for OI.

## Deployment

[HOSTING.md](./HOSTING.md). Set `CREDENTIALS_FERNET_KEY` in production. `ENABLE_DEV_MOCK` must stay false.
