# OI Pulse

**Version: V6.20** — see [`VERSION`](VERSION), [`CHANGELOG.md`](CHANGELOG.md), [`docs/VERSIONING.md`](docs/VERSIONING.md).

OI Pulse is a live **NSE open-interest desk** for **NIFTY**, **SENSEX**, and **BANKNIFTY**. It is built for option sellers and OI readers who need strike-level conviction during the cash session — not a generic charting terminal.

Stack: **React (CRA/craco) + FastAPI + MongoDB + Zerodha Kite Connect**.

---

## What it does

The publisher Kite token polls the option chain on a cadence you set (15 / 30 / 60s). Every tick is stored in Mongo. The desk then shows:

| Surface | Why it is there |
|---------|-----------------|
| **OI Change** | Call vs Put OI delta vs a chosen lookback (1m … session) |
| **Open Interest** | Strike bars, writer-defense map, last-pull truth |
| **Strike Table** | Compact CE/PE grid with optional gamma / institution chips |
| **Sell Candidates** | Strikes the desk treats as writer-friendly |
| **Build-up** | Fresh OI adding vs covering |
| **Positions** | Live F&O book (admin publisher token, or guest’s own Kite) |
| **Alerts / Activity** | Server reversal alerts + session tape |
| **Events / Index Risk** | Calendar + event-risk tile (upload stamps stay admin-only) |
| **Straddle** | ATM straddle premium path |
| **CAS Expiry** | Cash-settled expiry helper (activate/live is admin) |
| **Trade journal** | Admin-only: booked P&L, notes, rating, month calendar |

Guests never share the publisher positions token. If **Positions** is ticked Public, they **Connect Zerodha** for *their* book. Charts always stay on the publisher OI feed.

---

## How it works

```
Zerodha Kite (publisher) ──► OITracker poll ──► Mongo oi_snapshots
                                      │
                                      ├── alerts + optional Telegram
                                      ├── ATM straddle samples
                                      └── FastAPI /api/oi/{index}/change
                                               │
React desk  ◄── /api/config + /api/settings ──┘
   Admin: all ticked Admin pages + journal
   Guest: only ticked Public pages + own Kite book
```

1. **Market hours** (default 09:15–15:40 IST, CAS-era index F&O) gate OI polling. GIFT Nifty keeps its own sessions.
2. **Change windows** compare the latest snapshot to one ~N minutes earlier (never yesterday’s session).
3. **Fresh Pull** (admin) wipes today’s OI board and takes one live tick per enabled index.
4. **Auth**: admin password session (`X-Admin-Token`); optional public gate + guest approval (`X-Guest-Token`).

Details: [docs/DATA.md](docs/DATA.md) · APIs: [docs/ABOUT.md](docs/ABOUT.md).

---

## Edge for users

- **Own poll, own thresholds** — not a delayed vendor OI widget.
- **Huge-shift popup** on ATM ± 1 when institutions dump OI in a short window.
- **Writer defense / gamma wall / institutional detector** on the strikes that actually matter.
- **Two desks, one feed** — publisher OI for everyone; each user can still connect their own Kite book.
- **Public / Admin page ticks** in Admin configuration so you hide noise from guests *or* from yourself.
- **Weekend / holiday carry brief** so Friday’s board is not thrown away.
- **Journal that stores booked P&L in Mongo**, not only in the browser.

---

## How it is configured

| Knob | Where |
|------|--------|
| Tracked indices, alert focus, poll seconds, market close | **Admin configuration** (gear) |
| **Public vs Admin pages** (two ticks per tile) | Admin configuration → Public / Admin dashboard pages |
| Site-wide guest access ON/OFF | Header **Public** switch |
| Extra guest pages (Positions, Sell Candidates, Index Risk) | Public icon menu (same flags as settings) |
| Publisher Kite key / daily token | **Kite API** |
| Guest Kite | Positions → Connect Zerodha |
| Sounds, local OI thresholds (huge shift, velocity, lots) | Settings (saved in the browser) |
| Constituents / event CSV | Admin upload — stamps stay admin-only |

---

## Quick start

```bash
# Backend
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# backend/.env → MONGO_URL, DB_NAME, ADMIN_USERNAME, ADMIN_PASSWORD
uvicorn server:app --reload --port 8000

# Frontend
cd frontend && yarn install
echo 'REACT_APP_BACKEND_URL=http://localhost:8000' > .env.local
yarn start
```

Full env: [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md). Leaving Emergent / Oracle Cloud / GoDaddy DNS: [docs/HOSTING.md](docs/HOSTING.md). Optional LLM over OI + positions: [docs/AI.md](docs/AI.md). Domain shortlist: [docs/DOMAINS.md](docs/DOMAINS.md).

The **Market Events Chrome extension** is **not** in this app. It lives in [adeotale27/Market_Events](https://github.com/adeotale27/Market_Events). A Pulse-only copy of that tree is on orphan branch `cursor/market-events-1bf9` (do not merge it into `main`).

In the app, click the **logo** or **V5.00** to open the same product story.

---

## Versioning (for every update and every new AI)

Start from **V5**. 

- Each shipped fix/polish: **V5.01, V5.02, …**
- A whole new feature area: **V6.00**

Update `VERSION`, `CHANGELOG.md`, `frontend/src/lib/appVersion.js`, and `backend/app_version.py` together. See [docs/VERSIONING.md](docs/VERSIONING.md) and [AGENTS.md](AGENTS.md).
