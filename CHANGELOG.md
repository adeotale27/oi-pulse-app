# Changelog

## V6.15 — 2026-08-15

MCX majors can sit on the OI desk. Kite names are CRUDEOIL, GOLD, SILVER, NATURALGAS (not the minis).

- ATM / header LTP from the **nearest MCX FUT** (rolls; Gold tender drops the front month)
- When a commodity is enabled, OI polls **09:00–23:30 IST** on NSE trading days. Cash indices still close 15:40
- Admin → Index management: Crude / Gold / Silver / Nat. gas shortcuts. Enable is opt-in — default board stays NIFTY / SENSEX / BANKNIFTY
- Publisher Kite needs the commodity segment. Same `get_snapshot` pipeline as the three desk indices

## V6.14 — 2026-08-15

Index Risk is a normal dashboard page again. Admin configuration compiles.

- Index Risk uses the same Public / Admin ticks as OI Change, Straddle, Positions, and the rest (header Public menu still has a shortcut)
- The Index Risk tab always shows summary cards and an empty state when there are no upcoming events (it no longer paints a blank board)
- Admin configuration: restored Alert focus indices JSX (`SettingsModal` parse error on `</section>`)

## V6.13 — 2026-08-15

Analyze chart uses desk colours. Admin can discover and enable more Kite F&O names without a code change.

- Payoff chart: Put `#16A34A`, Call `#DC2626`, now-curve sky-600, expiry slate — same language as OI Change
- `index_registry` bootstraps NIFTY / SENSEX / BANKNIFTY. Admin → Index management searches the Kite dump, inspects CE/PE/OI, enable/disable (history kept)
- Enabled names share the existing OI poller / OI Change / straddle / strike table pipeline
- MCX still only polls during NSE cash hours until a commodity session clock exists

## V6.12 — 2026-08-15

Instrument universe + engineering docs. Live OI board unchanged (NIFTY / SENSEX / BANKNIFTY).

- One catalog (`backend/universe.py`, `frontend/src/lib/universe.js`) so a later market is not another copy-paste of three names
- Crude / Gold / Silver / Natural gas are **catalogued, not polled** (Kite MCX has OI; hours and futures-spot are not wired)
- `/config` adds `universe`. Settings still only tick the three desk indices
- Docs: ENGINEERING_RULES, ARCHITECTURE, DEVELOPMENT, AI_DEVELOPMENT_RULES, ADR-001. Env examples committed

## V6.11 — 2026-08-15

Book Analyze is a payoff studio, not a sparse card.

- Full-screen Analyze: index + spot %, Live P&L, **Add booked P&L**, Chart / Legs on phone
- Payoff chart with current-price and projected-P&L pills, now vs expiry curves, Call/Put OI at ATM, ±1/2 SD
- Legs read like a book: B/S badges, `qty × expiry strike CE/PE`, checkbox, Total footer
- Payoff table plus compact target and date sliders; tap the chart to set the target

## V6.10 — 2026-08-15

Journal holiday names, Book radar copy, overnight tile, Telegram session wrap, Kite login errors, phone sidebar.

- Journal phone cells show the real holiday name (not “Holi”). Muhurat stays Muhurat even on a weekend listing
- Book radar no longer asks to upload constituents when they are already on file
- Overnight risk tile matches the other insight tiles. “Carry shorts” is now **Hold overnight?** / **Overnight**
- Phone sidebar starts below the header so OI Pulse and the version stay visible
- Telegram: readable huge-OI notes; session wrap at **15:15 IST** with next-session calendar. Never the book
- Kite token: paste the whole login URL; checksum vs already-used tokens get a plain-language error
- First OI load paints the open index before the other two

## V6.09 — 2026-08-14

Journal next-month crash, year heatmap index rows, phone brand.

- Opening a month that has an NSE holiday no longer blanks the desk (`object && true` was calling `.replace` on a missing holiday name)
- Year heatmap attributes booked P&L from the option symbol when a stored leg has no `index` (Thursday SENSEX ~21k lands on SENSEX, not only the month total)
- Phone header always shows **OI Pulse** and the version next to the live clock

## V6.08 — 2026-08-14

Journal books partial closes, not only fully squared legs.

- Closing 3 of 13 lots is realised P&L on Kite even while quantity stays open. The journal now stores that `realised` with full exits
- Calendar / heatmap use that booked total (the 8.4k-vs-21k gap was full-exit-only)
- Positions “Profit booked today” uses the same `pnl_today.booked` figure

## V6.07 — 2026-08-14

Muhurat is a live trading session for charts and OI, not a holiday.

- Diwali Laxmi Pujan Muhurat polls Open Interest during the NSE special window (2025: 13:30–14:45 IST)
- Kite has no exchange-open API; a fresh NIFTY/SENSEX last_trade_time also starts polling if the tape is printing
- Journal EOD lock follows that session’s close + 5 minutes. Full holidays stay closed

## V6.06 — 2026-08-14

Journal books weekends and full holidays as closed, and treats live special sessions as trading days.

- Weekends and full NSE holidays (Republic Day, Holi, Balipratipada, …) do not get a new journal date; last session stays until the next open
- Diwali Laxmi Pujan **Muhurat** is a journal session (calendar shows Muhurat, EOD lock 20:00 IST). OI poll still treats it as a holiday
- If Kite prints fills or index last-trade on a closed calendar day, that day is booked as a live session

## V6.05 — 2026-08-14

Journal weekends are not trading days. Carry Desk AI is overnight impact only.

- Positions poll no longer writes Saturday/Sunday (or holiday) journal rows. Friday stays until the next session
- Auto weekend/holiday journal docs are purged; calendar and weekly recap ignore them
- Carry brief **Desk AI** toggle stays; the box only lists next-session impact (heavyweights that can gap the index, HIGH events, relevant news) — not the full WHAT/WHY/BUYER dump

## V6.04 — 2026-08-14

Carry brief, Desk AI, and Radar no longer share one coach dump. Radar tiles move up/down.

- Carry brief has its own **AI** toggle (desktop). Off on phones for now. Coach is overnight-only (why carry / VIX / GIFT), not the cash tape
- Desk AI panel stays heavyweights + news; Radar stays book risk vs cash
- Radar intel tiles: up/down arrows (and drag) with a separate saved order

## V6.03 — 2026-08-14

Desk AI is one on/off for the whole desk. Phone opens a popup; desktop keeps the side panel.

- Header AI: one switch + Open in side panel (Ask AI / slim strip / Jump to strip removed)
- Guests can turn it on the same as admin (`POST /desk-ai`)
- Phone: AI chip opens a full-tape popup; close returns to the chart (no strip on the grid)
- Desk AI removed from Admin configuration (renamed from Alert settings)

## V6.02 — 2026-08-14

Desk AI is off until you turn it on. The tape is readable tiles, Radar-only on Positions, and the phone header no longer overflows.

- Alert Settings: Show Desk AI, Ask AI, Book radar intelligence
- Header AI chip still flips the same Show/Ask on the desk (icon-only on phone)
- Intelligence is one sentence + swapable tiles (heavyweights, breadth, news, calendar, what to do)
- Positions book has no AI strip — Radar has the tick, resizable
- Phone header: compact clock, icon AI chip, Today P&L off that row

## V6.01 — 2026-08-14

Desk AI no longer eats the OI grid. Config works on the phone.

- Chart keeps a **collapsed one-line strip** (More + drag to resize). Full tape is a **Desk AI** view in the right panel
- Header **AI** chip is on phone and desktop: Show / Ask / slim-strip-on-chart
- Tiles and OI chart stay the main surface

## V6.00 — 2026-08-14

Market intelligence desk: what OI alone cannot see (heavyweights, breadth, news, event risk).

- Uses the **same constituent files** already uploaded under Impact Risk / Admin → Upload (weightage included)
- Kite last prices; Yahoo fallback. OpenAI key still optional, server env only
- Header **AI** chip: Show Desk AI + Ask AI for admin **and** guests together (not Alert Settings)
- Positions toolbar **AI** tick; Radar panel **AI** tick (on when you turn Desk AI on)
- Coach format: WHAT / WHY / OPTION BUYER / OPTION SELLER / WATCH NEXT

## V5.19 — 2026-08-14

Desk AI is **outside the OI chart**: heavyweight cash movers + news, not a PCR recap.

- Quotes top-weight Nifty / Bank / Sensex names (uploaded constituents) via Kite or Yahoo
- Pulls market headlines (public RSS)
- Coach tells you which heavyweight is dragging the index and what that means for sold CE vs PE

## V5.18 — 2026-08-14

Desk AI reads the live OI tape (not just yesterday’s FII print). Admin ticks who sees the bar.

- Coach uses PCR, CE/PE OI change, walls, VIX, GIFT, shorts, calendar; FII/DII labelled T+1
- Rules rewrite every tick; GPT only on Ask AI / ~5 min cache
- Alert Settings: **Desk AI (Admin)** / **Desk AI (Public)**

## V5.17 — 2026-08-14

Phone Positions: Live / Exited toggles actually show the book; Columns menu is a portaled sheet.

- Mobile was never rendering exited cards after the Exited chip
- Duplicate Live/Exited blocks on phone could swallow the same tap (toggle twice = stays closed)
- Columns no longer clip inside the toolbar — fixed sheet above the phone dock; outside-tap guard so iOS does not close it on the opening tap

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
