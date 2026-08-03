##  Testing Protocol
- Always read and update this file before invoking backend or frontend testing subagents.
- Test BACKEND first using `deep_testing_backend_v2`. Do NOT invoke frontend testing unless the user explicitly asks for it.
- Do NOT edit the "Testing Protocol" section.
- Do NOT fix issues that a testing agent has already fixed.
- Communicate deltas to the testing agent by appending to the appropriate "agent_communication" list below (never remove earlier entries).

## Incorporate User Feedback
- User explicitly asked to keep existing data and NOT run test files or add unnecessary tests.
- User wants: (1) OI Change endpoint to actually show a real N-min delta instead of collapsing to 15-second delta; (2) admin password `MasterApp@123`; (3) Kite api_key `79m7qb0mj6bzh9f8` and access_token `rI4mAFkMKYnrNUnhfCF6wT64HToY8GNj` wired up so tracker boots into LIVE mode; (4) OI data for NIFTY, SENSEX, BANKNIFTY all polled every day regardless of which index the user is looking at.

## Task Summary
Fix "OI Change" tab that was showing Call OI change: 0 / Put OI change: 0 in the dashboard and always keeping the amber "History warming up — 0.0 min" banner up. Then add stacked-change bar visualization, custom-threshold change alert toast, and a live warming-up countdown, plus wire up admin login + Kite creds via env vars.

## Backend Changes
1. Restored `/app/backend/.env` and `/app/frontend/.env` (they were missing — backend was crash-looping on `KeyError: 'MONGO_URL'`).
2. Added `ADMIN_PASSWORD=MasterApp@123`, `KITE_API_KEY`, `KITE_ACCESS_TOKEN` to `backend/.env`.
3. `oi_tracker.load_credentials()` — added env-var bootstrap: if the `credentials` collection has no Kite entry, seed it (encrypted) from `KITE_API_KEY` + `KITE_ACCESS_TOKEN` env vars, then initialize KiteService and switch to LIVE mode.
4. `/api/oi/{index}/change` endpoint (`server.py` line ~753) — changed the baseline-snapshot MongoDB sort from `("timestamp", -1)` to `("timestamp", 1)`. This picks the EARLIEST snapshot inside `[N-min-ago, now)` instead of the newest one, so a "15 min change" is truly ~15 min old instead of ~15 s old.
5. Installed missing kiteconnect runtime deps: `twisted`, `pyOpenSSL`, `pytz`, `autobahn[twisted]==19.11.2`, `service_identity`. Appended to `backend/requirements.txt`.
6. Confirmed (no code change needed) that `DEFAULT_SETTINGS.enabled_indices = ["NIFTY", "SENSEX", "BANKNIFTY"]` and `_poll_once` iterates every enabled index concurrently, upserting each snapshot into `oi_snapshots` idempotently on `(index, timestamp, expiry)`.

## Frontend Changes
1. `components/OIChart.jsx` — when `showOI=false` the chart now renders THREE stacked bars per side:
   - solid `pe_base = min(pe_now, pe_prev)` / `ce_base` — solid coloured segment for OI that stayed
   - striped `pe_up = max(0, delta)` / `ce_up` — diagonal-striped SVG-pattern segment for OI increase
   - outlined `pe_down = max(0, -delta)` / `ce_down` — hollow bordered segment for OI decrease
2. `pages/Dashboard.jsx`:
   - `changeSummary` now also carries `basePE`, `baseCE`, `pePct`, `cePct` (percentage delta vs the baseline snapshot).
   - Added a new custom-threshold "Change Alert" toast that fires when `max(|cePct|, |pePct|)` ≥ user-configurable `changeAlertPct` (default 5 %), with its own cooldown. Threshold is persisted in `localStorage` under key `oiChangeAlertPct`.
   - Warming-Up Banner now shows a live ticking countdown (`data-testid="warming-countdown"`) that decrements every second until the true N-min compare unlocks. Also embeds an inline input (`data-testid="change-alert-threshold"`) so the user can adjust the alert %.

## What To Test (Backend Only)
Please verify these endpoints/behaviors against a running backend:

1. `POST /api/auth/login` with `{"username":"Adeotale","password":"MasterApp@123"}` returns 200 with `is_admin=true` and a `token`.
2. `GET /api/status` returns `mode="kite"` and `has_kite_credentials=true` (Kite bootstrap succeeded from env vars).
3. `GET /api/oi/NIFTY` — returns a snapshot with a non-null `price`, `atm`, `strikes[]`, `pcr`. Same for SENSEX and BANKNIFTY.
4. `GET /api/oi/NIFTY/change?minutes=15` — returns `current`, `previous`, `history_ready`, `available_history_minutes`. Fresh install: `history_ready` may be `false` initially (0 min of history) and should become `true` after ~12+ min. The important check is that `previous.timestamp` is NOT identical or ~15 s away from `current.timestamp` once at least 30 s of history exists — it should progressively drift towards ~15 min old as history accumulates (bug fix verification: sort direction should pick earliest doc in window, not newest).
5. `GET /api/oi/SENSEX/change?minutes=5` and `GET /api/oi/BANKNIFTY/change?minutes=5` also return current + previous shapes.
6. Admin-gated endpoints reject unauthenticated requests with 401 (e.g. `POST /api/settings`).

## agent_communication:
    - agent: main
      message: |
        Backend now boots into LIVE Kite mode via env-var bootstrap in oi_tracker.load_credentials.
        Admin password is `MasterApp@123` (username `Adeotale`).
        DB is being populated with oi_snapshots for NIFTY, SENSEX and BANKNIFTY concurrently every poll cycle.
        Please verify the endpoints listed above. DO NOT create any file-based tests inside /app/tests unless absolutely necessary — the user explicitly asked us not to add test files.
