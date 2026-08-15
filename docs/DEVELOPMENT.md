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

**Preferred:** Admin → **Index management** → search Kite → inspect capabilities → Enable. That writes `index_registry` and `enabled_indices`. The existing poller picks it up.

Manual/code path (still valid):

1. Add a row to `backend/universe.py` **and** `frontend/src/lib/universe.js` if it needs a quote hint.
2. Keep `pollable: False` in the static catalog until hours match (MCX).
3. Tests in `test_universe.py` / `test_index_registry.py`.
4. Bump version per [VERSIONING.md](./VERSIONING.md).

Until step 3, the live desk stays NIFTY / SENSEX / BANKNIFTY. Catalog rows are documentation for the next ship.

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

## External integration

Kite stays in `oi_service` / `user_kite` / `kite_positions`. Telegram in `notifier.py`. Do not call Kite from the browser for OI.

## Deployment

[HOSTING.md](./HOSTING.md). Set `CREDENTIALS_FERNET_KEY` in production. `ENABLE_DEV_MOCK` must stay false.
