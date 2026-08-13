# Changelog

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
