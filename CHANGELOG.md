# Changelog

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
