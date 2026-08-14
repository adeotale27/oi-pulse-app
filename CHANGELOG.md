# Changelog

## V5.16 — 2026-08-14

Publish/readiness: `/health` `/ready` `/api/health` bind before Mongo/Kite boot. Chrome events extension left this repo.

- Startup schedules `_boot()` in the background so Emergent/k8s probes get 200 as soon as uvicorn listens
- Market Events Chrome extension lives in **https://github.com/adeotale27/Market_Events** (no Kite, no OI Pulse poller)

## V5.15 — 2026-08-14

Desk AI is a first-class strip (not a hidden LLM footnote). Independent Chrome radar for holidays / FII-DII / VIX / results.

- **Desk AI** bar under the header + header **AI** chip; Ask AI bypasses the 5-minute cache
- Positions and carry brief use the same violet AI treatment
- Snapshot can include cash FII/DII nets (clipped)
- Domain shortlist: [`docs/DOMAINS.md`](docs/DOMAINS.md)
- Chrome radar was added here then **moved** to https://github.com/adeotale27/Market_Events in V5.16

## V5.14 — 2026-08-14

Positions desk coach (roll / hedge / hold) plus a publish-safe desk-guide model.

- Positions shows a **Desk coach** strip: which shorts are too close or ITM, and when net Δ needs flattening
- `POST /api/desk-guide` caches **carry** and **positions** separately; `DeskGuideIn` uses `Field(default_factory=list)` so FastAPI 0.110 / Pydantic 2 can import
- Optional LLM still every ~5 minutes when `OPENAI_API_KEY` is set — alerts unchanged

## V5.13 — 2026-08-14

Carry brief is a movable case file (why / why-not / results) plus an optional AI pass.

- Open the brief for **Why carry** vs **Why not**, session OI vs your shorts, and wrapping result/holiday rows (not a 3-line dump)
- Drag it horizontally anywhere on desktop, or snap left / center / right
- Optional LLM: `POST /api/desk-guide` every ~5 minutes when `OPENAI_API_KEY` is set — see [docs/AI.md](docs/AI.md). Alerts are unchanged

## V5.12 — 2026-08-13

Carry brief matches the mint card (no black bar) and fits on a phone without inner scroll.

- Header uses the same green/amber/rose panel as the body
- Phone: one-line index rows, short event names, no nested scrolling

## V5.11 — 2026-08-13


Positions Charges / Privacy tiles match Radar and Journal; carry brief parse error gone.

- Charges and Privacy are the same height as Radar / Journal, with near-black labels (no more washed-out grey)
- OvernightGapBrief declares dock classes once so the frontend builds

## V5.10 — 2026-08-13


Carry brief stays usable on phone and talks like an options seller.

- Phone: moon chip by default; the sheet stays on the dock (no more blank overlay dragged over OI Change / Positions)
- Dark header + a floating Close control; swipe down on the handle to minimize
- Copy is about carrying **short premium**: session OI (which shorts are supported), GIFT, India VIX, holidays, and heavy index-impact only

## V5.09 — 2026-08-13


Journal save actually persists notes; carry brief docks left and can be closed on phone.

- Save journal ignored the click (the mouse event was treated as the day document) — notes, tags, and score now PUT and reload
- Carry brief defaults to the left on desktop; drag the header or use the dock control to move it
- Phone carry brief is height-capped with large Minimize / Close controls so it cannot trap the screen
- Dialogs sit above the carry chip so Save and other modal actions stay clickable

## V5.08 — 2026-08-13

Journal year grid stays in lockstep with the open month; Straddle WS is quiet in production.

- Year heatmap overlays the calendar’s booked month (so today’s book cannot vanish on the year tab)
- Saving a journal day reloads the year recap
- Straddle WebSocket connect/reconnect logs only in development

## V5.07 — 2026-08-13

Production hardening and leftover desk polish. Alerts are unchanged.

- Phone quotes stay fresh (ticker LTP, not a one-shot seed); one `/tickers` poll shared with the marquee
- Heatmap tap jumps to the visible position card on phone
- Sidebar dimmer sits above the dock; Kite login URLs must be http(s)
- Journal screenshots require real image bytes; login rate limits; CSP / no-store API
- Desk error boundary so a UI throw does not blank the board

## V5.06 — 2026-08-13

Production polish: mobile quotes, side drawer, journal focus, heatmap, load.

- Phone index tiles show LTP, points, and today’s % for NIFTY / SENSEX / BANKNIFTY (no “tap”, ATM, or last-session row)
- Sidebar opens from the left again (not a bottom sheet)
- Right panel dropdown includes **OI Change** (delta bars)
- Position heatmap is the **open** book of the **active index**, with strike CE/PE labels — closed SENSEX legs no longer linger
- Journal: tap a day and the calendar / weekly recap step aside; the date chip sits under the month title with notes on the right; tap the chip to restore the month
- Year heatmap actually loads (and falls back to the current month if the year payload is empty)
- Spot ticks merge instead of replacing other indices

## V5.05 — 2026-08-13

Trade journal calendar is readable on phone.

- Compact 7-day grid (date + booked P&L only) instead of overflowing desktop cards
- Month booked strip + weekly recap on phone; tap a day for full notes / charges
- Year heatmap on phone is a month list (booked by index), not a squeezed table
- Calendar figures stay booked/exited P&L (never open MTM)

## V5.04 — 2026-08-13

Desk polish: About notes split by role, mobile dock/sidebar, carry brief, straddle.

- Logo / version About: guests see UI and desk behaviour only; admin also sees APIs, k8s, Mongo
- Phone dock labels match dashboard tabs (OI Change, Index Risk, Strike Table); clearer icons; Pages picker
- Mobile sidebar is a curved sheet — tap the dimmed area to close
- Open Interest on phone includes strikes above & below ATM
- Index bar uses three tiles plus ATM / expiry instead of one empty dropdown
- Straddle chart on phone is shorter, no overlapping legend
- Carry brief from 14:00 IST through next open; slide to the right edge for moon-only

## V5.03 — 2026-08-13

Index Risk, journal after-charges, and heatmaps now use booked (exited) data only.

- Admin **Last successful upload** / Index Event Risk only appears when there are upcoming events or a stale/missing CSV
- Journal **after charges** uses Kite contract-note totals when present; no longer treats missing charges as ₹0 (so booked equals after-charges)
- Year heatmap, calendar, and position heatmap ignore open NIFTY MTM — only exited P&L is stored and shown

## V5.02 — 2026-08-13

Backend crashed on import (nginx `connection refused` to :8001, k8s never Ready).

FastAPI 0.110 treats `GET /positions(request: Optional[Request] = None)` as a Pydantic
response field. Signature is now `request: Request` like the other desk routes.
Removing unused Emergent pip packages did not cause this — the traceback is this route.

## V5.01 — 2026-08-13

K8s publish was timing out at readiness (build OK, pod never Ready).

- Stop blocking boot on Kite `instruments()` dump, `profile()`, and Yahoo VIX/GIFT fetches
- `/health`, `/ready`, `/api/health` return 200 as soon as uvicorn listens
- Slim `requirements.txt`: drop unused stripe, emergentintegrations, pytest, twisted/autobahn pins, APScheduler, JWT/passlib, aiohttp
- Lazy-import pandas (event uploads only) so the API process is not huge at start

## V5.00 — 2026-08-13

Baseline of the live NSE OI desk.

- NIFTY / SENSEX / BANKNIFTY open-interest polling via publisher Kite token
- Admin vs guest desks with independent **Public / Admin** page ticks
- Guest Connect Zerodha for their own positions (charts stay on publisher OI)
- Trade journal (admin) with booked P&L stored in Mongo
- Alerts, huge-shift popups, Index Risk, CAS expiry, straddles, sell candidates
- In-app **About** on logo / version click
- Product README + versioning so new AI/sessions start from **V5**
- Publish fix: drop broken Emergent visual-edits tarball; CRA build no longer treats warnings as errors
