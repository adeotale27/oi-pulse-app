# OI Pulse — About the Project

OI Pulse is a live NSE Open Interest dashboard for **NIFTY**, **SENSEX**, and **BANKNIFTY** (**V6.09**). It polls Zerodha Kite Connect, stores strike-level OI snapshots in MongoDB, and surfaces change charts, alerts, sell candidates, straddles, and session replay.

Product story (what / why / edge / config): **[README.md](../README.md)**. Versioning: **[VERSIONING.md](./VERSIONING.md)**. Optional desk LLM: **[AI.md](./AI.md)**. Click the logo or **V6.09** in the app for the same About panel.

Stack: **React (CRA/craco) + FastAPI + Motor/MongoDB + Kite Connect**.

---

## Login & access

| Role | How | Token |
|------|-----|-------|
| **Admin** | `POST /api/auth/login` with username/password (`ADMIN_USERNAME` / `ADMIN_PASSWORD` in `backend/.env`) | `X-Admin-Token` (session TTL; optionally expires at market close) |
| **Remember me** | `POST /api/auth/remember-login` with 24h IP-bound device token | Issues a fresh admin session |
| **Guest** | Public access must be ON; guest requests approval via Access Control | `X-Guest-Token` after admin Approve |
| **Blocked IP** | Admin can block/unblock IPs; blocked clients cannot enter as guest | — |

Auth state: `GET /api/auth/state` (public flag, admin/guest flags, pending request count).

Public toggle: `POST /api/auth/public-access` `{ open: true|false }` (admin). Guests are kicked when Public turns off. Access requests: list / approve / reject under `/api/auth/access-requests*`.

---

## Internal API (FastAPI, prefix `/api`)

### Core OI & market
| Method | Path | Notes |
|--------|------|-------|
| GET | `/` | API hello + **product version** |
| GET | `/health` `/ready` `/api/health` | K8s readiness — 200 without Kite/Yahoo |
| GET | `/version` | Public `{ name, version, version_label }` (V5.01 …) |
| GET | `/status` | Mode (`kite`/`offline`), market hours, tracker health, `app_version` |
| GET | `/config` | Enabled indices, lot sizes, thresholds |
| GET | `/settings` / POST `/settings` | Admin settings (enabled indices, alert windows, market close, etc.) |
| GET | `/oi/{index}` | Latest snapshot |
| GET | `/oi/{index}/change` | Current vs N-minutes-ago + multi-window deltas |
| GET | `/history/{index}` | Snapshot timeline for Replay |
| GET | `/expiries/{index}` / POST | Expiry list + selection |
| GET | `/alerts` / DELETE | Reversal alerts (session-scoped; prior days purged at new open) |
| GET | `/tickers` | Index LTP / prev close cards |
| GET | `/tickers/extras` | India VIX, GIFT NIFTY, session windows |
| GET | `/market/status` | Open/close helpers |
| GET | `/vrp/{index}` | Volatility risk premium (EOD-ish) |
| GET | `/straddle/{index}` (+ `/history`) | ATM straddle series |
| GET | `/positions` | Open F&O from Kite (admin) |
| GET | `/desk-outside` | Heavyweight cash movers + news (not OI) |
| GET/POST | `/desk-guide` | Seller coach over that outside tape; optional GPT (see [AI.md](./AI.md)) |
| POST | `/desk-ai` | Desk user: one `desk_ai_show` flag for the whole desk |
| POST | `/admin/refresh-day` | **Fresh Pull** — wipe snapshots, live-pull all **enabled** indices |
| POST | `/admin/upload/constituents` | CSV/XLSX constituents (replaces index bucket on success — see [UPLOAD.md](./UPLOAD.md)) |
| POST | `/admin/upload/events` | Event calendar upload (full replace on success) |
| GET | `/upload/meta` | Last successful upload stamp per category (Nifty / Bank / Sensex / events) |
| GET | `/events/{index}` / `/constituents/{index}` | Stored event/constituent data (+ upload timestamps) |

### Auth
`/auth/login`, `/auth/remember-login`, `/auth/logout`, `/auth/change-password`, `/auth/guest`, `/auth/state`, `/auth/public-access`, `/auth/guests*`, `/auth/access-requests*`, `/auth/blocked-ips*`, `/auth/access-request/{id}`.

### Kite credentials
`POST /credentials`, `GET /credentials/status`, `POST /kite/generate-session`, `GET /kite/vault`, `POST /kite/refresh`, `DELETE /kite/vault`, `POST /mode`, `POST /tracker/start|stop`.

### Telegram
`/telegram/status`, `/telegram/prefs`, `/telegram/test`, `/telegram/huge-shift`, digest preview/send.

### WebSockets
Spot and straddle WS endpoints (see `frontend/src/lib/spotWs.js`, `straddleWs.js`) — default `ws://localhost:8000`.

---

## External services

| Service | Used for |
|---------|----------|
| **Zerodha Kite Connect** | Live option chain / OI, spot, GIFT NIFTY (`NSEIX:GIFT NIFTY`), India VIX, positions |
| **MongoDB** | Snapshots, alerts, sessions, credentials vault, settings |
| **Telegram Bot API** | Optional alert / huge-shift / digest delivery (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) |
| **yfinance** (optional paths) | Auxiliary market data where configured |

No synthetic OI backfill in production Fresh Pull — only real Kite ticks (or empty DB offline).

---

## UI surfaces

- **Header** — LIVE/OFFLINE, tickers, Fresh Pull (admin), Kite API, Public toggle
- **Sidebar** — index chips with last-pull times (stale flash if inactive & >2 min behind), expiries, strike range
- **Main tabs** — OI Change chart, Strike Table, Sell Candidates, Build-up, Positions, Alerts, Holidays
- **Right panel** — Alerts / Suggestions / Activity (hidden on phones; use Alerts tab / FAB)
- **Replay** — scrub last ~3h; huge-shift modal can **Jump to HH:MM** bookmark

See also: [DATA.md](./DATA.md) · [LOCAL_SETUP.md](./LOCAL_SETUP.md)
