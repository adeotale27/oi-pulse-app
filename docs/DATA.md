# StrikLenz — How Data Is Stored & Manipulated

## Storage (MongoDB)

Primary database name comes from `DB_NAME` (env). Key collections:

| Collection | Purpose |
|------------|---------|
| `oi_snapshots` | Strike-level OI ticks per index/expiry/timestamp (unique compound index) |
| `index_registry` | Admin-enabled underlyings (bootstrap NIFTY/SENSEX/BANKNIFTY). Disable hides from the desk; snapshots stay |
| `kite_underlyings` | Compact search cache from the daily Kite instruments dump |
| `admin_audit` | Admin enable/disable (and similar) with previous/new state |
| `alerts` | Server-side OI reversal / pressure alerts |
| `straddle_samples` | ATM straddle time series |
| `credentials` | Encrypted Kite API key/secret/token vault (`_id: kite`) |
| `settings` | Admin settings, public access flag (`open`, `require_approval`, expiry), password hash, sidebar notes |
| `admin_sessions` | Short-lived admin bearer tokens |
| `admin_remember_devices` | 24h IP-bound remember-me tokens |
| `guest_sessions` | Guest tokens, revoke, IP |
| `guest_ip_names` | Last guest display name per IP |
| `access_requests` | Pending/approved/rejected guest entry requests |
| `blocked_ips` | Hard blocks |
| `trade_journal` | Admin trade journal: one document per IST `date`. Stores booked P&L from **full exits and partial closes** (Kite `realised` on still-open legs), brokerage/`charges_total` (from Kite contract notes, copied into **our** DB only), notes, tags, rating, screenshots. Written on admin `/positions` refresh. Frozen at session close + 5 min (15:45 IST regular; Muhurat uses that day’s close). Weekends and full holidays are not booked unless Kite prints that day. |
| Constituents / events docs | Uploaded calendars & index members (`index_constituents`, `nse_events`) — see [UPLOAD.md](./UPLOAD.md) for CSV columns and replace rules |

Retention: OI / straddle samples default to **96 hours** so Friday’s session survives the weekend and Monday pre-open (`SNAPSHOT_RETENTION_HOURS` / `STRADDLE_RETENTION_HOURS`). Prune also floors at the previous trading day’s open. Weekend / holiday / pre-open APIs resolve `session_anchor_date` (last trading day) for history, straddle, and banners. After configured market close, OI polling stops; **GIFT Nifty** continues on its own schedule.

## Instrument universe

Tracked names live in `backend/universe.py` and `frontend/src/lib/universe.js`. Default poller ids are **NIFTY / SENSEX / BANKNIFTY**. MCX majors **CRUDEOIL, GOLD, SILVER, NATURALGAS** are pollable (ATM = nearest FUT, hours 09:00–23:30 IST) once Admin enables them in Index management. They are not on by default. `/api/config` includes `universe`. See [ADR-001](./decisions/ADR-001-instrument-universe.md) and [ADR-003](./decisions/ADR-003-mcx-majors.md).

---

## Live pipeline

```
Kite Connect ──► OITracker (asyncio poll) ──► oi_snapshots
                      │
                      ├── last_snapshot[index] (in-memory hot cache)
                      ├── alert engine → alerts + Telegram
                      └── /oi/{index}/change reads current vs older snapshot
```

1. **Poll** — While the market is in session (regular hours or Muhurat / special session, or `FORCE_ALWAYS_POLL`), tracker fetches option chain for each **enabled** index and selected expiry. Kite Connect does not expose a holiday/session-open endpoint; hours come from the NSE calendar plus a live quote last_trade_time check.
2. **Normalize** — Snapshot includes spot, ATM, PCR, per-strike CE/PE OI, VIX when available, `timestamp` / `created_at`.
3. **Upsert** — Written to `oi_snapshots` with uniqueness on `(index, expiry, timestamp)`.
4. **On demand** — Boot fetches OI for the **open index** only; other chips load when selected. FII/DII and impact fetch when that tile is opened. Positions poll only on the Positions tab. Index management **Search/Sync** loads the Kite name list — login and `/expiries` do not dump `kite.instruments()`. Auth 520/timeout does not sign you out.

### Change windows

`/oi/{index}/change?minutes=N&also=1,3,5` compares the latest snapshot to the nearest older snapshot ≈ N minutes earlier. Huge-shift monitor watches ATM ± 1 across configured windows.

### Fresh Pull (`POST /admin/refresh-day`)

Admin-only reset of the **OI board** (not Upload / constituents / events):

1. `delete_many({})` on `oi_snapshots` (full wipe — avoids leftover prior-day history).
2. Clear in-memory `last_snapshot`.
3. Resolve `enabled_indices` from settings.
4. **Kite mode:** parallel live `get_snapshot` per enabled index → store.
5. **Offline:** no fake backfill; DB stays empty until credentials/live data exist.
6. Refresh extra tickers (VIX / GIFT).

Refused on weekends/holidays so Friday’s last session is not wiped. Use when today’s chain looks contaminated or you need a clean live tick for every enabled index — not for routine polling (the tracker already polls while NSE is open).

---

## Frontend manipulation

| Concern | Where | Behavior |
|---------|-------|----------|
| Active index / expiry | `Dashboard.jsx` | Drives chart + table; cache hydrated in `oiCacheRef` |
| Timeframe pills | Client | Re-request change window; does not re-fetch Kite |
| Strike filter | Sidebar min/max or ATM ± N | Filters chart series client-side |
| Compact mode | `localStorage.compact` | Default **on** for viewports ≤1280px (more chart, less chrome) |
| Right panel | Hidden on ≤768px | Phones use full-width chart + Alerts tab/FAB |
| Replay | `/history` + scrubber | Optional `jumpToTs` seeks closest snapshot (huge-shift bookmark in `localStorage`) |
| Stale chip | Sidebar | Inactive index with last OI **>120s** old → amber flash |

CSV download builds from the current/previous client snapshots — no extra server round-trip beyond what’s already loaded.

---

## Modes

- **`kite`** — Real broker data; requires vaulted (or env) API key + daily access token.
- **`offline`** — No live Kite; UI may show last stored / historical day; Fresh Pull will not invent OI.

Dev-only mock simulator loads only when `ENABLE_DEV_MOCK=true` (never used for Fresh Pull backfill in production paths).

---

## Auth data flow

- Admin login → insert `admin_sessions` → frontend stores token in `sessionStorage` → axios sends `X-Admin-Token`.
- Remember me → `admin_remember_devices` bound to IP → auto `/auth/remember-login`.
- Guest → access request → admin approve → `guest_sessions` → `X-Guest-Token`; Public OFF revokes guests.

See [ABOUT.md](./ABOUT.md) for endpoint map and [LOCAL_SETUP.md](./LOCAL_SETUP.md) to run locally.
