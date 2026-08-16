# StrikLenz - NSE Open Interest Tracker

## Original Problem Statement
Web app that fetches NSE Open Interest data for NIFTY and SENSEX every 15 seconds via Zerodha KiteConnect, shows a grouped bar chart per option strike (Put OI green + Call OI red, current vs previous), provides all timeframe filters (1m/3m/5m/10m/15m/30m/1h/2h/3h/Full Day), and pops up alerts + sound + browser push notifications when a huge OI reversal is detected. Light-theme dashboard.

## User Choices
- Data source: Zerodha KiteConnect (with automatic Demo fallback when no credentials)
- Indices: NIFTY + SENSEX
- Alerts: In-app toast (Sonner) + audio beep pattern (Web Audio) + browser desktop push notifications
- Timeframes: 1m, 3m, 5m, 10m, 15m, 30m, 1h, 2h, 3h, Full Day
- Theme: Light (Swiss/high-contrast, Outfit + JetBrains Mono)

## Architecture
- **Backend**: FastAPI + Motor (async Mongo). Background asyncio task polls every 15s and stores snapshots in `oi_snapshots`. Alert engine compares vs snapshot ~3 minutes old; triggers on ≥15% CE or PE OI change with 2-minute cooldown per index.
- **Data sources**:
  - `KiteService` - real Zerodha broker via `kiteconnect` SDK
  - `MockService` - realistic random-walk simulator that also occasionally spikes to trigger alerts
- **Frontend**: React + Recharts. Grouped bar chart, sidebar filters, timeframe pills, alerts panel, credentials modal.

## Implemented (2026-02-07)
- Backend endpoints: `/api/status`, `/api/config`, `/api/oi/{index}`, `/api/oi/{index}/change`, `/api/history/{index}`, `/api/alerts` (GET/DELETE), `/api/mode`, `/api/credentials`, `/api/credentials/status`, `/api/tracker/start`, `/api/tracker/stop`
- Background OI polling every 15s, snapshot storage & 6-hour retention
- OI reversal alert engine with cooldown & direction classification (bullish/bearish pressure)
- Dashboard UI with NIFTY/SENSEX switcher, sidebar filters, live Recharts bar chart
- Timeframe pills for change window (compares current vs snapshot N minutes ago)
- Alerts side panel with toast + sound + browser Notification API push
- Kite credentials modal (secure UI to save api_key + access_token daily)
- Demo mode enabled by default so the app is fully functional out of the box
- Strike table view + Open Interest tab (absolute) + Alerts tab

## Iteration 2 (2026-02-07) - P1 features
- BANKNIFTY added as third index (NIFTY / SENSEX / BANK toggle in sidebar)
- Multi-expiry: `/api/expiries/{index}` + `POST /api/expiries/{index}` + `?expiry=` query param on `/api/oi` and `/api/oi/change`. Sidebar shows the 4 nearest weekly expiries; user picks one and the chart / table update in place.
- Downloadable CSV of the current OI snapshot (with prev + change columns) via header button
- Configurable alert thresholds: `GET/POST /api/settings` with `threshold_pct`, `compare_minutes`, `cooldown_seconds`, `enabled_indices`. Settings modal in header (gear icon) with sliders + checklist.
- Replay change timeline scrubber: uses `/api/history` to load last 3 hours of snapshots; slider + play/pause auto-plays through OI evolution and uses the scrubbed frame as the "previous" bar overlay.

## Backlog (P1)
- Multi-expiry checklist (currently only nearest expiry)
- Add BANKNIFTY index toggle
- "Replay change" mode - scrub timeline through the day
- Downloadable CSV of strike snapshots
- Configurable alert thresholds (% & cooldown) in UI

## Backlog (P2)
- WebSocket streaming from backend to frontend (currently polling)
- User accounts + saved watchlists
- Historical replay over past 7 days
- Kite login flow (request_token -> access_token) inside the app
