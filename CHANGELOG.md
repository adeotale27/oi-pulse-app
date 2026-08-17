# Changelog

## V6.36 — 2026-08-17

MCX desk toggle, clearer book tilt, collapsible Your book, guest holiday reminder, tighter event joins.

- Admin **MCX** switch in Index management and Settings. Off = no commodity poll/UI. On = Enable Gold/Crude/etc.; only those names pull OI
- Your book collapses by default; Move above/below the position list. Net Δ says **bullish** or **bearish**, not “one way”
- Guests see a holiday-calendar reminder from **20 Dec** until Admin uploads next year’s NSE circular
- Index Risk join: longer company-name matches; coverage line shows how many Nifty / Bank Nifty / Sensex names hit the events file

## V6.35 — 2026-08-17

Positions phone polish, always-on CALL/PUT, and an uploadable NSE holiday circular.

- Phone insight tiles are a 2-column equal-height grid (no huge P&amp;L / funds cards). Book score sits above the cards; Insights opens on first phone visit
- Position cards always show CALL or PUT beside NRML, even when the name is fully visible
- Admin Upload → **NSE holiday circular** (CSV/XLSX). Years in the file overlay the built-in list. Next Holiday / poll hours use the merge
- Closed-Chrome phone alerts: Telegram is the reliable path (documented on Positions + Telegram prefs). Browser banners still need the tab open

## V6.34 — 2026-08-17

Phone Positions: Today P&L stays in the header; CE/PE sits beside NRML when the name truncates.

- Compact P&L chip on the phone header and sticky index row (admin, or guest when Positions is public)
- Phone position cards show a CE or PE badge next to NRML so the side is visible when the title ends in “…”

## V6.33 — 2026-08-16

The desk is branded **StrikLenz**. The display name is one line in repo-root `APP_NAME`.

- Header, login, About, tab title, PWA name, API `/version`, Telegram session wrap, and current docs use that name
- To rename later: edit `APP_NAME`, rebuild the UI. Do not change Mongo `DB_NAME` or the login token salt

## V6.32 — 2026-08-16

Guest approval is optional. Hosting path is Atlas + one always-on VM (not Vercel for the API).

- Public menu: **Require approval** toggle (default ON). When OFF, a guest full name is stored and they enter immediately; blocked IPs still cannot
- Access Control still lists names. Public OFF still signs guests out
- HOSTING.md: UI/API/DB comparison — Atlas + Linux VM + Caddy; Vercel is not for the Kite poller

## V6.31 — 2026-08-15

Index Impact and Upcoming Index Event Risk show the same upcoming constituent calendar.

- Tile lists every upcoming joined event (not only results / board meetings), sorted by days then weight
- Empty tile opens an in-place list (does not jump tabs). Past-only calendars say the file is dated before today
- `days_remaining` uses IST today. Join still matches symbol then company name; non-constituents stay out
- Sensex tiles use company name. Weight colours match the stated buckets (3%+ high, 1–3% medium, &lt;1% low)

## V6.30 — 2026-08-15

Every index chip always shows last price and change; fewer duplicate quote calls.

- `/tickers` fills SENSEX/BANKNIFTY from last OI snapshot when Kite LTP is missing or zero (NIFTY selected no longer blanks the other chips)
- Quote lookup matches Kite keys with or without the `BSE:` prefix. Snapshots store prev_close / day_open
- One Dashboard `/tickers` fetch is shared with the header and phone ticker (no triple request). Tickers load immediately, including weekend. Spot WS still uses last snapshots (no extra Kite)

## V6.29 — 2026-08-15

Stop last-session OI toasts when NSE is closed; keep info tiles and tabs stable.

- Alerts toast only while NSE cash/F&O is open (`is_market_open`). Closed / weekend last-session change no longer pops toasts
- Next holiday and next event open an in-place dropdown (do not jump to Positions or the first dashboard tab)
- FII/DII and impact tiles fetch as soon as they are on screen, not only after a click
- Straddle and other tabs no longer blank the whole desk (removed page-level lazy Suspense; boot splash uses the desk background)
- Expiry picker uses the last snapshot when the Kite dump is not loaded
- MCX majors are paused: hidden from Index management / settings ticks, stripped from the poll list, Enable rejected

## V6.28 — 2026-08-15

Keep the desk as it was; only Index-management dump stays off auto-preload.

- Info tiles and desktop right panel default on again. VIX/GIFT, tickers, and alerts return shortly after first paint
- Open-index OI, chip-switch OI, FII/DII/impact on tile open, Positions-on-tab stay
- `/expiries` and tracker start no longer call `kite.instruments()`. Search/Sync in Index management still loads names when you ask

## V6.27 — 2026-08-15

Stop kicking users out when the origin is slow; slim the first JS load.

- Cloudflare 520/524/timeout on `/auth/state` no longer treats you as logged out. Session tokens stay; Retry if the desk is busy
- 401 on OI/positions does not wipe the login. Positions/journal/straddle load as separate chunks when you open them
- Dropped unused React Query wrapper and StrictMode double-mount. Auth/state no longer refreshes alert indices on every poll

## V6.26 — 2026-08-15

Stop auto-preload. Load F&O names and extra desk data when you ask for them.

- No Kite F&O dump after token save or tracker start. Index management **Search** or **Sync** fills the name list
- Dashboard only fetches the **open** index OI. Other indices load when you switch to them
- Positions, FII/DII, impact events, Desk AI, VIX/GIFT, tickers wait until that panel is open or well after first paint (was a 520 stampede)

## V6.25 — 2026-08-15

Paint the desk first, then fill data step by step.

- Open-index OI loads immediately (no wait on expiry list). Other indices, VIX/GIFT, tickers, alerts, Today P&L, and sidebar note follow with short delays
- Dropped duplicate boot calls: prefetch-all expiries, second OI fetch when the expiry picker catches up, stacked `/auth/state` on mount
- Re-checked V6.24 origin cuts: token save still background-only, `/expiries` still no Kite dump, `/ws/spot` still snapshot-only, PostHog still gone

## V6.24 — 2026-08-15

Cut origin load after Kite login; drop PostHog; sequential OI warm-cache.

- `sc.ecombullet.com/api/dashboard/totalusers` is **not** this app (other tab / extension / Emergent). Production Axios 520/524 on `aaisnamkeen.com/api/...` **is** this desk behind Cloudflare when origin is slow
- Publisher token save no longer dumps Kite instruments or polls on that request — F&O dump + expiry seed run in the background
- `GET /expiries/{index}` no longer reloads the full instrument dump; `/ws/spot` uses last OI snapshot (no per-second Kite LTP)
- Dashboard fetches the open index first; other names one-at-a-time and skip if cached < ~3 minutes. Overnight brief biases are sequential too
- Removed PostHog snippet + CSP hosts (session recording was extra browser/network load)

## V6.23 — 2026-08-15

Fix desk crash: `INDEX_STEP is not defined`.

- Restore Sidebar imports (`INDEX_STEP`, `INDEX_SHORT`, `usesIndexOverflow`) and TickerStrip `INDEX_CHIP_CAP` dropped in V6.21

## V6.22 — 2026-08-15

F&O Index-management dump loads itself after every publisher token.

- Saving a Kite access token (credentials / daily login) reloads instruments and writes `kite_underlyings` in the background — no manual `preload_fno.py`
- Same cache refresh on tracker start and the first IST poll of the day. The CLI remains optional for ops

## V6.21 — 2026-08-15

Gold/MCX quotes stay on that name; Enable is one click; Analyze blue/green.

- Selecting GOLD no longer paints NIFTY’s print on the GOLD chip/sidebar. Live ticker and Kite LTP win; OI snapshot price is used only when `current.index` matches
- Spot websocket quotes every enabled name in its own session hours (nearest MCX FUT) instead of a full NIFTY chain poll
- Index management: Enable / Disable on the row (no Inspect gate). Daily `backend/preload_fno.py` refreshes the Kite F&O dump
- Journal / position heatmap: GOLD / CRUDE / SILVER / NG get named rows when booked; Others stays for FINNIFTY and stocks
- Desk AI Gold news follows the selected commodity even if the enabled-list check lagged
- Header ticker scrollbar hidden; drag / mouse to slide. Analyze close on the right; now-curve blue, expiry green

## V6.20 — 2026-08-15

Enable extras end-to-end, Desk AI per selected MCX name, Analyze emerald chrome.

- Index management Enable: 90s timeout, FastAPI error text (not a blank “Enable failed”), session_group on the registry row. Kite MCX CE/PE labelled `MCX` (not `MCX-OPT`) still load the chain
- Admin configuration tracked-index ticks include extras already on; saving no longer drops GOLD
- Header / sidebar / phone picker still use `INDEX_CHIP_CAP` = 3; enabled names appear there after Enable
- Desk AI: `GET /desk-outside?index=` — Gold selected → Gold news/fut; NIFTY selected → existing cash heavyweight tape
- Analyze tabs, header, now-curve: emerald like Journal (put/call OI bars stay green/red)

## V6.19 — 2026-08-15

Extra indices fit the existing phone and desktop chrome. Checklist requires phone in the same PR.

- Phone index row stays a 3-slot grid. Four or more names (Gold, Crude, …) use a dropdown in those slots plus the active quote chip — header and sidebar width/height unchanged
- Header still slides; sidebar still drops down after three chips (`INDEX_CHIP_CAP`)
- Live ticker on the phone includes every enabled name. Index management stays the same dialog size (scroll inside)
- DEVELOPMENT.md: phone + do not grow header/sidebar, for every new index and every new desk UI

## V6.18 — 2026-08-15

Index management works on the phone.

- Admin Settings (gear) on phone and tablet now has **Index management** next to Admin configuration — same search / inspect / enable as desktop
- The add-index sheet is full-screen on small screens with larger tap targets. Discover more from Admin configuration closes that modal first so the sheet is usable

## V6.17 — 2026-08-15

Journal Others, per-commodity poll hours, and a ship-to-main checklist.

- Positions still lists every Kite net/day leg (Gold, Crude, FINNIFTY, stocks). Those books land in the admin journal; the year heatmap always has an **Others** row
- Each catalog name has a `session_group`. NSE stops polling at 15:40; MCX non-agri (GOLD, SILVER, CRUDEOIL, NATURALGAS) polls 09:00–23:30 IST in US DST and until 23:55 otherwise. Select agri 21:00 / other agri 17:00 when those names are added
- Journal freeze waits for the latest enabled close + 5 minutes so evening commodity exits are not dropped
- Checklist in DEVELOPMENT.md: hours, poll, Positions, journal Others, tests, **merge to main**

## V6.16 — 2026-08-15

Kite login link works again. Extra indices do not crowd the sidebar or header.

- Credentials modal: `safeHttpUrl` was missing — “Could not open Kite login” on the request_token link. Login is a real link when the key is vaulted
- Sidebar: three indices stay as chips; more than three uses a dropdown so expiry / ATM layout does not shift
- Header tickers: more than three slide horizontally (drag / scroll), slightly tighter tiles

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
