##  Testing Protocol
- Always read and update this file before invoking backend or frontend testing subagents.
- Test BACKEND first using `deep_testing_backend_v2`. Do NOT invoke frontend testing unless the user explicitly asks for it.
- Do NOT edit the "Testing Protocol" section.
- Do NOT fix issues that a testing agent has already fixed.
- Communicate deltas to the testing agent by appending to the appropriate "agent_communication" list below (never remove earlier entries).

## Incorporate User Feedback
- User explicitly asked to keep existing data and NOT run test files or add unnecessary tests.
- User wants: (1) OI Change endpoint to actually show a real N-min delta instead of collapsing to 15-second delta; (2) admin password `[REDACTED_ADMIN_PASSWORD]`; (3) Kite api_key `[REDACTED_KITE_API_KEY]` and access_token `[REDACTED_KITE_ACCESS_TOKEN]` wired up so tracker boots into LIVE mode; (4) OI data for NIFTY, SENSEX, BANKNIFTY all polled every day regardless of which index the user is looking at.

## Task Summary
Fix "OI Change" tab that was showing Call OI change: 0 / Put OI change: 0 in the dashboard and always keeping the amber "History warming up — 0.0 min" banner up. Then add stacked-change bar visualization, custom-threshold change alert toast, and a live warming-up countdown, plus wire up admin login + Kite creds via env vars.

## Backend Changes
1. Restored `/app/backend/.env` and `/app/frontend/.env` (they were missing — backend was crash-looping on `KeyError: 'MONGO_URL'`).
2. Added `ADMIN_PASSWORD=[REDACTED_ADMIN_PASSWORD]`, `KITE_API_KEY`, `KITE_ACCESS_TOKEN` to `backend/.env`.
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

1. `POST /api/auth/login` with `{"username":"Adeotale","password":"[REDACTED_ADMIN_PASSWORD]"}` returns 200 with `is_admin=true` and a `token`.
2. `GET /api/status` returns `mode="kite"` and `has_kite_credentials=true` (Kite bootstrap succeeded from env vars).
3. `GET /api/oi/NIFTY` — returns a snapshot with a non-null `price`, `atm`, `strikes[]`, `pcr`. Same for SENSEX and BANKNIFTY.
4. `GET /api/oi/NIFTY/change?minutes=15` — returns `current`, `previous`, `history_ready`, `available_history_minutes`. Fresh install: `history_ready` may be `false` initially (0 min of history) and should become `true` after ~12+ min. The important check is that `previous.timestamp` is NOT identical or ~15 s away from `current.timestamp` once at least 30 s of history exists — it should progressively drift towards ~15 min old as history accumulates (bug fix verification: sort direction should pick earliest doc in window, not newest).
5. `GET /api/oi/SENSEX/change?minutes=5` and `GET /api/oi/BANKNIFTY/change?minutes=5` also return current + previous shapes.
6. Admin-gated endpoints reject unauthenticated requests with 401 (e.g. `POST /api/settings`).

    - agent: main
      message: |
        FOLLOW-UP #2 — the ingress issue.
        Even after setting a strict `CORS_ORIGIN_REGEX`, the deployed browser login still failed. Root cause:
        the Emergent preview ingress (Cloudflare) injects `Access-Control-Allow-Origin: *` on every response,
        which conflicts with the backend's `Access-Control-Allow-Credentials: true` header (browsers reject
        `*` + credentials). The frontend axios instance was using `withCredentials: true` even though the app
        uses only header-based auth (`X-Admin-Token` / `X-Guest-Token`) — no cookies at all.
        Fix applied:
          - `/app/frontend/src/lib/api.js` — set `withCredentials: false` on the axios instance (still sends
             the X-Admin-Token / X-Guest-Token headers via the request interceptor).
          - `/app/backend/.env` — set `CORS_ORIGINS=*` and removed the regex, so the backend does NOT emit
             `Access-Control-Allow-Credentials: true` and does not clash with the ingress's wildcard.
          - Restarted backend + frontend.
        Verified via playwright: browser POST /api/auth/login now returns 200 with a token, admin_token gets
        stored in sessionStorage, and the app navigates to `/` and renders the live dashboard.
        Please re-verify:
          1. Preflight OPTIONS `/api/auth/login` from the public URL still succeeds (200/204) with
             `Access-Control-Allow-Origin: *` (from ingress) and NO `Access-Control-Allow-Credentials`
             header conflict on the backend response.
          2. POST `/api/auth/login` with correct creds returns 200 + token via the public URL AND localhost.
          3. `GET /api/oi/NIFTY/change?minutes=15` returns valid `current` + `previous` with the sort-fix
             still in place (previous timestamp progressively older for longer timeframes).
          4. All three indices still polling (mongo counts still growing).
          5. Admin-gated endpoints still reject unauthenticated requests.

## agent_communication:
    - agent: main
      message: |
        FOLLOW-UP #4 — user reported four related issues:
          (a) "Same Call/Put OI change values across different timeframes"
          (b) "Timeframe switch is slow"
          (c) "Chart refreshes every second"
          (d) "Show OI OFF should render only the shift (delta), not the sensibull-style stacked base"
        Root causes:
          (a) When history_ready=false the API correctly falls back to the earliest snapshot, but the frontend
              rendered the summary without any hint that the number is approximate. If two different timeframes
              both fall back to the same earliest-available snapshot, the numbers ARE identical — this is
              expected but was confusing. Fixed: when `historyReady=false` the CE and PE change numbers now
              render with a leading "≈" and reduced opacity, plus a tooltip explaining "Approximate — only
              X.X min of history".
          (b) `useQuiescentAwarePolling` only fires its callback on FIRST mount; changing timeframe / index /
              expiry did NOT trigger an immediate refetch, so users had to wait up to `pollMs` (15 s) for the
              new window's data. Fixed by adding a dedicated useEffect that watches `[timeframe, activeIndex,
              selectedExpiry]` and calls `loadOI()` immediately on any of those changes.
          (c) The 1-second warming-up-countdown tick was re-rendering the whole Dashboard, and OIChart was
              not memoised → recharts re-animated bars every 1 s. Fixed by wrapping OIChart in React.memo AND
              setting `isAnimationActive={false}` on all Bar elements so the chart only visually updates when
              current/previous data changes.
          (d) Reverted the "Show OI OFF" render path to signed-delta-only bars (positive up = increase,
              negative down = decrease) with a ReferenceLine y=0 baseline. Legend now reads: "OI change in
              selected timeframe · bars above zero = increase · below zero = decrease". Show OI ON still
              renders absolute OI grouped bars as before.
        Playwright browser verification confirms:
          - Clicking Last 1 min → CE +8.07L, PE -65.6K
          - Clicking Last 5 mins → CE +13.36L, PE -1.81L
          - Clicking Last 10 mins → CE +21.31L, PE +18.20L
          - Exactly 3 `/api/oi/NIFTY/change` calls fired (one per timeframe click, no wasteful re-polling)
          - Show OI OFF renders signed-delta bars with y=0 baseline (Put OI change / Call OI change legend)
          - Show OI ON renders absolute Put/Call OI bars (Absolute OI bars legend)
          - No visible re-animation between poll cycles
        Please re-verify (backend only, no code changes):
          1. `/api/oi/NIFTY/change?minutes=1`, `?minutes=5`, `?minutes=10`, `?minutes=15` — return DIFFERENT
             `previous.timestamp` values that get progressively older, so long as there's enough history.
             When history is shorter than the requested lookback, `history_ready` is `false` and
             `available_history_minutes` reports the actual available window.
          2. All previous checks (login, X-Admin-Token, all 3 indices polling, no CORS regression) still pass.

    - agent: main
      message: |
        FOLLOW-UP #3 — user reported: "instead of oi change its showing Open Interest chart". Root cause: the
        `showOI` state on Dashboard defaulted to `true`, making the OI Change tab open in absolute-OI mode
        (visually identical to the Open Interest tab). User wants it to open in the CHANGE view — stacked
        solid base + striped Increase / outlined Decrease overlays — matching the last two Sensibull
        reference images.
        Fix: `pages/Dashboard.jsx` — `useState(true)` → `useState(false)` for `showOI`. Toggle still works
        so users can flip to absolute-OI view if they want.
        User also asked to keep `X-Admin-Token` login flow intact. Confirming: it is untouched. The axios
        request interceptor still attaches `X-Admin-Token: <token>` to every request from
        sessionStorage/localStorage — no cookies involved. `withCredentials: false` only disables cookie
        transmission (which we never used); custom headers are unaffected. Works identically on preview
        and production.
        Playwright browser verification confirms:
          - Login POST /api/auth/login returns 200 with token
          - Token is stored in sessionStorage under `oi_admin_token`
          - Dashboard opens with OI Change tab active
          - Chart renders in CHANGE view by default (data-testid `switch-show-oi` state = `unchecked`)
          - Legend reads: "Solid = previous OI · Striped = increase · Outline = decrease · Put OI · Increase · Decrease · Call OI · Increase · Decrease"
          - Custom Change Alert Toast fired for NIFTY: "PE OI ▼ 11.08% in 15 mins"
        Please re-verify (backend only):
          1. Login flow (public URL + localhost) still returns 200 + token.
          2. Subsequent authed requests using the returned token in `X-Admin-Token` header succeed against admin-gated endpoints.
          3. OI Change endpoint sort-fix still in place; all 3 indices still polling and stored.
          4. No regression on `/api/status`, `/api/oi/{idx}`, `/api/oi/{idx}/change`, `/api/history/{idx}`.

    - agent: main
      message: |
        Backend now boots into LIVE Kite mode via env-var bootstrap in oi_tracker.load_credentials.
        Admin password is `[REDACTED_ADMIN_PASSWORD]` (username `Adeotale`).
        DB is being populated with oi_snapshots for NIFTY, SENSEX and BANKNIFTY concurrently every poll cycle.
        Please verify the endpoints listed above. DO NOT create any file-based tests inside /app/tests unless absolutely necessary — the user explicitly asked us not to add test files.

    - agent: main
      message: |
        FOLLOW-UP: user reported Login failing in the deployed preview UI with browser console CORS errors:
          "Access-Control-Allow-Origin header must not be the wildcard '*' when request's credentials mode is 'include'".
        Root cause: `/app/frontend/src/lib/api.js` creates the axios instance with `withCredentials: true`, but backend was reading `CORS_ORIGINS=*` from env — the browser rejects wildcard + credentials.
        Fix: `/app/backend/.env` now sets an empty `CORS_ORIGINS` and a `CORS_ORIGIN_REGEX` that matches any `*.emergentagent.com` preview subdomain plus `localhost` / `127.0.0.1`. Backend restarted.
        Please retest:
          1. Preflight OPTIONS `/api/auth/login` from `Origin: https://40650f96-1793-4424-b793-cbea46487c6f.preview.emergentagent.com` returns 200 with `Access-Control-Allow-Origin` echoed back to that exact origin and `Access-Control-Allow-Credentials: true`.
          2. Actual `POST /api/auth/login` with the correct body and that Origin header returns 200 + valid token, and the response likewise carries the specific-origin `Access-Control-Allow-Origin` (not `*`).
          3. Preflight/POST from a bogus origin like `https://evil.example.com` is rejected (no CORS headers, so the browser will block it).
          4. Also re-verify remaining items 3–7 from the earlier list (status, all 3 OI indices live, /change endpoint sort fix, MongoDB snapshot growth, admin-gated auth, /history).

    - agent: main
      message: |
        EFFICIENCY / UNBREAKABLE PASS (branch cursor/oi-efficiency-unbreakable-82e9):
        - /oi/{idx}/change no longer does inline Kite fetches (single-flight background refresh only).
        - Lookback clamped to today's session open — stops previous-day OI leaking into Change-in-OI.
        - GET never mutates tracker.selected_expiry; also=1,3,5 batches huge-shift windows.
        - Guest auto-revoke on public-access expiry; guest requires public_access.open.
        - Frontend: request-gen on loadOI, expiry gate on index switch, spot WS no longer overwrites
          OI timestamp, huge-shift consumes also_windows (no 3× duplicate polls).
        Unit tests for /change windows + also-batch pass. Please re-verify backend:
          1. GET /api/oi/NIFTY/change?minutes=15&also=1,3,5 returns also_windows without hitting Kite
             (tracker poller remains sole writer; data_status.is_live reflects market+age).
          2. Full-day / long windows never return previous.timestamp from a prior trade date.
          3. Guest token after public-access expire → is_guest=false on /auth/state.
          4. All 3 indices still polled by background tracker.
