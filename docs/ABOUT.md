# StrikLenz — About the Project

StrikLenz is a live NSE Open Interest dashboard for **NIFTY**, **SENSEX**, and **BANKNIFTY**. It polls Zerodha Kite Connect, stores strike-level OI snapshots in MongoDB, and surfaces change charts, alerts, sell candidates, straddles, and session replay.

Product story (what / why / edge / config): **[README.md](../README.md)**. Versioning: **[VERSIONING.md](./VERSIONING.md)**. Optional desk LLM: **[AI.md](./AI.md)**. Click the logo or version label in the app for the same About panel.

Stack: **React (CRA/craco) + FastAPI + Motor/MongoDB + Kite Connect**.

---

## Login & access

| Role | How | Token |
|------|-----|-------|
| **Admin** | `POST /api/auth/login` with username/password (`ADMIN_USERNAME` / `ADMIN_PASSWORD` in `backend/.env`) | `X-Admin-Token` (session TTL; optionally expires at market close) |
| **Remember me** | `POST /api/auth/remember-login` with 24h IP-bound device token | Issues a fresh admin session |
| **Guest** | Public access ON; full name required. If **Require approval** is ON (default), Access Control must approve every new access request. A lost/expired token requires a fresh request; an IP address or display name never restores access. If approval is OFF, a guest session is minted immediately | `X-Guest-Token` |
| **Blocked IP** | Admin can block/unblock IPs; blocked clients cannot enter as guest | — |

Auth state: `GET /api/auth/state` (public flag, admin/guest flags, pending request count, and public walkthrough availability).

Public toggle: `POST /api/auth/public-access` `{ open: true|false, require_approval?: bool }` (admin). `require_approval` defaults **true** when unset. Guests are kicked when Public turns off. Access requests: list / approve / reject under `/api/auth/access-requests*`.

### Public product walkthrough

The frontend route **`/sitewalkthrough`** (including case variants) is an anonymous, public preview of the
real Dashboard UI. A route-scoped Axios adapter supplies fictional sample data
and contains all dashboard writes in memory; only the public `/auth/state`
availability check reaches the backend. It never connects to Kite or reads
real account/database data. CAS and every admin-only surface, including the
trade journal, remain unavailable. The route can be enabled or disabled in
the header **Admin Settings → Site walkthrough** toggle. Demo changes reset on
refresh and are never broker orders, guest data, or saved records. Index quotes,
OI, options, and straddles evolve together from a deterministic fictional clock
during regular NSE sessions (09:15–15:30 IST, weekdays excluding full
holidays); published special-session hours are followed when scheduled.
Fictional Desk AI cash/news/breadth data and stable-cadence strike alerts are
available in the preview and are explicitly labelled as samples. Outside
trading hours market values remain at the prior session close. When the toggle
is off, `/sitewalkthrough` displays the branded maintenance screen without
requesting market data. The availability toggle is persisted with dashboard
settings and is returned by the public auth-state endpoint used by the route.
Enabling site-wide maintenance also turns the walkthrough off; returning the
main site to live leaves the walkthrough disabled until an admin explicitly
turns it back on.

---

## Internal API (FastAPI, prefix `/api`)

### Core OI & market
| Method | Path | Notes |
|--------|------|-------|
| GET | `/` | API hello + **product version** |
| GET | `/health` `/ready` `/api/health` | K8s readiness — 200 without Kite/Yahoo |
| GET | `/version` | Public `{ name, version, version_label }` for the current product release |
| GET | `/status` | Mode (`kite`/`offline`), market hours, tracker health, `app_version` |
| GET | `/admin/indices` `/search` `/inspect` | Admin: registry + Kite discovery |
| POST | `/admin/indices/sync` `{name}/enable` `{name}/disable` | Admin: dump refresh + toggle (keeps history) |
| GET | `/settings` / POST `/settings` | Admin settings (enabled indices, alert windows, market close, etc.) |
| GET | `/oi/{index}` | Latest snapshot |
| GET | `/oi/{index}/change` | Current vs N-minutes-ago + multi-window deltas |
| GET | `/history/{index}` | Snapshot timeline for Replay |
| GET | `/expiries/{index}` / POST | Expiry list + selection |
| GET | `/alerts` / DELETE | Reversal alerts (session-scoped; prior days purged at new open) |
| GET | `/tickers` | Index LTP / prev close cards |
| GET | `/tickers/extras` | India VIX, GIFT NIFTY, session windows |
| GET | `/market/status` | Open/close helpers |
| GET | `/market/fii-dii` | Cached NSE FII/DII cash (after 19:31 IST warm) |
| GET | `/cas/status` | Classic CAS + Auto Trade snapshot (guests: reduced) |
| POST | `/cas/settings` | Admin: classic CAS + Auto Trade times/thresholds/mode |
| POST | `/cas/auto-trade/inject` | Admin Paper: fake first indicative (rehearsal before 15:20). Runbook: [CAS_AUTO_TRADE_15_20.md](./CAS_AUTO_TRADE_15_20.md) |
| GET | `/vrp/{index}` | Volatility risk premium (EOD-ish) |
| GET | `/straddle/{index}` (+ `/history`) | ATM straddle series |
| GET | `/positions` | Open F&O from Kite (admin publisher book / guest own book), with `pnl_today` broker totals. Anonymous 401. Header Today P&L is admin-only. Positions and PositionMeter share this response and poller; PositionMeter derives open-short premium capture, decay runway, and strike-level hedge quantity from enriched rows. The feed does not include per-option quote timestamps or strategy IDs. Risk scenarios are client-side estimates and add no broker request. |
| GET | `/trades/export` | Excel of stored cycles (`from`/`to` IST dates, optional `index`). Desk user. Entry + exit clocks; second sheet is fills/partials. |
| GET | `/trades/archive/range` `/trades/archive/export` | Admin: count or download owned closed cycles for exact inclusive `from`/`to` Exit Dates as gzip NDJSON. Future dates are rejected. |
| POST | `/trades/archive/compact` | Admin: after download, SHA-256 verified removal of only raw events/fills for detailed cycles in the same inclusive date range. |
| POST | `/trades/archive/delete` | Admin: after download, SHA-256 verified permanent deletion of owned closed cycles in the same inclusive date range. Open/partial and guest cycles are excluded. |
| GET | `/desk-outside` | Heavyweight cash movers + news. Pass `?index=` when the selected name is an enabled MCX contract |
| GET/POST | `/desk-guide` | Seller coach over that outside tape; optional GPT (see [AI.md](./AI.md)) |
| POST | `/desk-ai` | Desk user: one `desk_ai_show` flag for the whole desk |
| GET/POST/DELETE | `/desk-ai/providers` | Admin: vaulted OpenAI-compatible Desk AI keys |
| GET | `/market-intel` | Ranked clustered events (desk user). Query `filter=` |
| GET | `/market-memory/{index}` | Recent price-level interaction summary derived from stored OI snapshots (desk user) |
| GET/POST | `/market-intel/prefs` | Per-user page/popup prefs; public feeds and the page default to 60-second refresh, with default popup thresholds of 75 impact / 30 India relevance |
| GET | `/market-intel/popup` POST `/market-intel/popup/ack` | In-app high-impact popup (up to 12 unseen clusters). The default includes high-impact India-relevant events plus a critical global-event override. Desk-wide popup tick off → empty for everyone; ingest is independent. Admin always receives items when the desk tick is on. |
| GET/POST/DELETE | `/market-intel/sources` | Admin sources; `.../test` and `.../fetch` |
| POST | `/market-intel/cleanup` | Admin retention cleanup now |
| GET | `/market-intel/templates` | public-apis News/Finance catalog + RSS templates |
| POST | `/admin/refresh-day` | **Fresh Pull** — wipe snapshots, live-pull all **enabled** indices |
| POST | `/admin/upload/constituents` | CSV/XLSX constituents (replaces index bucket on success — see [UPLOAD.md](./UPLOAD.md)) |
| POST | `/admin/upload/events` | Event calendar upload (full replace on success) |
| POST | `/admin/upload/holidays` | NSE holiday circular (year overlay on success) |
| GET | `/holidays` | Uploaded holiday rows (`source` upload or builtin) |
| GET | `/upload/meta` | Last successful upload stamp per category (Nifty / Bank / Sensex / events / holidays) |
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
| **Telegram Bot API** | Optional alert / huge-shift / digest delivery. Token/chat from Admin → Admin configuration (Fernet vault) or `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` env fallback. |
| **yfinance** (optional paths) | Auxiliary market data where configured |
| **Google Fonts** | Inter in `index.html` (only browser third-party on the desk) |

Admin → API Configuration's **Called today** metric counts integrations with telemetry-recorded requests since local midnight. Source-discovered providers remain listed even when not configured or used; the metric does not predict future calls.

The browser talks only to **this origin** (`/api`, `/ws`). Production is **https://striklenz.com**. Failed calls to `https://striklenz.com/api/...` **are this app** behind Cloudflare when origin is slow (520/524). `aaisnamkeen.com` is a retired host — Kite redirects must not land there. `sc.ecombullet.com` is **not** in this repo.

No synthetic OI backfill in production Fresh Pull — only real Kite ticks (or empty DB offline).

---

## UI surfaces

- **Header** — LIVE/OFFLINE, tickers, Fresh Pull (admin), Kite API, Public toggle. Today P&L is **admin-only** (never on the public header).
- **Sidebar** — index chips with last-pull times (stale flash if inactive & >2 min behind), expiries, strike range
- **Main tabs** — OI Change chart, Strike Table, Sell Candidates, Build-up, Positions, Alerts, Holidays
- **Right panel** — Alerts / Suggestions / Activity (hidden on phones; use Alerts tab / FAB)
- **Replay** — scrub last ~3h; huge-shift modal can **Jump to HH:MM** bookmark

See also: [DATA.md](./DATA.md) · [LOCAL_SETUP.md](./LOCAL_SETUP.md)
