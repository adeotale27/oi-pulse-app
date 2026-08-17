/**
 * In-app version notes. Guests see `user` only (what changed on the desk).
 * Admins also see `admin` (ops, APIs, storage). Keep in lockstep with CHANGELOG.md.
 */
export const RELEASE_NOTES = [
  {
    version: "6.34",
    date: "2026-08-17",
    user: [
      "On a phone, Today P&L stays in the header. Position cards show CE or PE next to NRML so the side is still clear when the name is cut off.",
    ],
    admin: [
      "Header P&L also shows for guests when Positions is a public page. Same /positions total as desktop.",
    ],
  },
  {
    version: "6.33",
    date: "2026-08-16",
    user: [
      "The desk is now StrikLenz — same OI board, new name on the header, login, and About.",
    ],
    admin: [
      "Display name is repo-root APP_NAME (one line). Rebuild the UI after changing it. Mongo DB name and Kite vault stay as they are.",
    ],
  },
  {
    version: "6.32",
    date: "2026-08-16",
    user: [
      "If the desk is open without an approval queue, enter your full name and you are in. The admin still records who you are.",
    ],
    admin: [
      "Public ▸ Require approval (default on). Off = name saved + guest session immediately. Blocked IPs stay blocked. Recommended host: MongoDB Atlas + one always-on VM; do not put the poller on Vercel.",
    ],
  },
  {
    version: "6.31",
    date: "2026-08-15",
    user: [
      "Index Impact lists every upcoming constituent event (results, board meetings, dividends, AGMs). An empty tile opens on the tile instead of changing page. If the calendar is already past, the tile says so.",
    ],
    admin: [
      "Event days use IST. Re-upload the NSE 1-month calendar when Index Risk is empty but last upload is old. Weight stripes: 3%+ high, 1–3% medium, under 1% low.",
    ],
  },
  {
    version: "6.30",
    date: "2026-08-15",
    user: [
      "NIFTY / SENSEX / BANKNIFTY chips on phone always show last price and day’s change, even when another index is selected or the market is closed.",
    ],
    admin: [
      "/tickers merges Kite LTP with last snapshot per name. Header and mobile share one ticker fetch. Spot WS may push last-session prints on the weekend (still no Kite quote).",
    ],
  },
  {
    version: "6.29",
    date: "2026-08-15",
    user: [
      "Closed-market OI no longer fires toasts. Holiday and event tiles open a list on the tile. FII/DII fills without a click. Switching to Straddle (and other pages) no longer flashes a black screen.",
    ],
    admin: [
      "MCX majors are paused off the desk (no Enable shortcuts, no poll). NSE-only hours gate backend alert eval. /expiries falls back to last snapshot.",
    ],
  },
  {
    version: "6.28",
    date: "2026-08-15",
    user: [
      "Holiday / FII tiles and the alerts side panel are back on first open. Chart still loads the index you have selected; extra names wait until you switch or Search in Index management.",
    ],
    admin: [
      "kite.instruments() is not run for /expiries or tracker start. Index management Search/Sync remains the dump. Desk chrome defaults restored.",
    ],
  },
  {
    version: "6.27",
    date: "2026-08-15",
    user: [
      "If the desk is slow to start you stay signed in — you are not thrown to login. The first screen is lighter; Positions and journal load when you open them.",
    ],
    admin: [
      "AuthGate keeps tokens on 520/timeout. Axios only clears session on real auth 401s. Dashboard/code-split heavy tabs. /auth/state skips alert-index refresh.",
    ],
  },
  {
    version: "6.26",
    date: "2026-08-15",
    user: [
      "The board no longer preloads everything at once. Open an index, a tile, or Index management Search when you need that data.",
    ],
    admin: [
      "F&O dump is on Search/Sync only. Positions tab no longer polls while hidden. FII/DII and impact tiles fetch on open.",
    ],
  },
  {
    version: "6.25",
    date: "2026-08-15",
    user: [
      "The board opens faster: the chart fills first, then the other indices and extras catch up in the background.",
    ],
    admin: [
      "Progressive boot: OI without waiting on /expiries; staggered extras/alerts/tickers/positions; AuthGate shares auth state so Header/Dashboard do not all hit /auth/state at t=0.",
    ],
  },
  {
    version: "6.24",
    date: "2026-08-15",
    user: [
      "Desk is lighter after Kite login — charts should stop hanging on Cloudflare 520/524. Analytics script (PostHog) is gone.",
    ],
    admin: [
      "Token save schedules the F&O dump in the background (no inline instruments + poll). /expiries does not dump Kite. Spot WS is last snapshot only. Background indices sequential + 3min cache. sc.ecombullet.com is not ours; aaisnamkeen.com 520/524 is origin timeout.",
    ],
  },
  {
    version: "6.23",
    date: "2026-08-15",
    user: [
      "Desk loads again after the Gold-price fix — sidebar index chips no longer crash.",
    ],
    admin: [
      "Sidebar/TickerStrip universe imports restored (INDEX_STEP / INDEX_CHIP_CAP).",
    ],
  },
  {
    version: "6.22",
    date: "2026-08-15",
    user: [
      "Adding or refreshing the publisher Kite token now loads the F&O name list for Index management by itself.",
    ],
    admin: [
      "kite_underlyings syncs after set_credentials, on tracker start, and first IST poll. preload_fno.py is optional.",
    ],
  },
  {
    version: "6.21",
    date: "2026-08-15",
    user: [
      "Gold (and other extras) keep their own price when you select them. Index management is Enable or Disable — one tap. Analyze close is on the right; payoff lines are blue (now) and green (expiry). Header tickers slide without a scrollbar.",
    ],
    admin: [
      "Spot WS uses per-index hours + Kite LTP (nearest FUT for MCX). Daily preload_fno.py fills kite_underlyings. Journal heatmap names MCX majors; Others is FINNIFTY/stocks. Desk AI commodity news follows the selected index.",
    ],
  },
  {
    version: "6.20",
    date: "2026-08-15",
    user: [
      "Enable Gold / Crude (and other extras) from Index management without a silent timeout. Charts and Desk AI follow the index you pick. Analyze uses the same emerald chrome as the journal.",
    ],
    admin: [
      "Enable waits up to 90s for the Kite dump and returns the real error. Admin configuration ticks keep extra names (do not drop GOLD on save). Desk AI ?index= for MCX when that name is selected; NSE stays the cash tape. MCX option rows match even if Kite labels them MCX not MCX-OPT.",
    ],
  },
  {
    version: "6.19",
    date: "2026-08-15",
    user: [
      "If Gold or extra names are on the desk, the phone index row stays the same size: pick the name from the dropdown in that row. Header and sidebar do not get bigger.",
    ],
    admin: [
      "INDEX_CHIP_CAP = 3. Phone sticky switcher dropdown when more than three. Checklist: phone in the same PR; do not grow header/sidebar. Index management dialog keeps its original size.",
    ],
  },
  {
    version: "6.18",
    date: "2026-08-15",
    user: [
      "Admin can add Gold / Crude / extra indices from the phone: Settings → Index management.",
    ],
    admin: [
      "Phone and tablet admin tools include Index management. The sheet is full-screen on small screens. Discover more from Admin configuration closes settings first.",
    ],
  },
  {
    version: "6.17",
    date: "2026-08-15",
    user: [
      "Trades outside NIFTY / SENSEX / BANKNIFTY (Gold, Crude, other names) stay on Positions and show as Others on the journal year heatmap. Commodity OI, when enabled, polls in that contract’s own hours.",
    ],
    admin: [
      "session_group on the catalog (nse vs MCX non-agri / select agri / agri). Journal lock follows the latest enabled close. DEVELOPMENT.md checklist: hours, poll, Positions, Others, merge to main.",
    ],
  },
  {
    version: "6.16",
    date: "2026-08-15",
    user: [
      "Kite login from credentials works again. If Gold / Crude / more names are on the desk, the sidebar becomes a dropdown and the header tickers slide instead of crowding.",
    ],
    admin: [
      "CredentialsModal imported safeHttpUrl (ReferenceError was the toast). Index switcher: ≤3 chips, >3 select. Header ticker drag-scroll when more than three quotes.",
    ],
  },
  {
    version: "6.15",
    date: "2026-08-15",
    user: [
      "Crude oil, Gold, Silver, and Natural gas can join the OI board when the desk enables them. Same charts as NIFTY — price comes from the nearest MCX future.",
    ],
    admin: [
      "Index management: Kite names CRUDEOIL / GOLD / SILVER / NATURALGAS (not CRUDEOILM / GOLDM / SILVERM / NATGASMINI). Enable is opt-in. Evening poll 09:00–23:30 IST. Commodity segment required on the publisher Kite login.",
    ],
  },
  {
    version: "6.14",
    date: "2026-08-15",
    user: [
      "Index Risk shows the event board even when nothing is upcoming. Hide the tab with the same Public / Admin ticks as the other dashboard pages.",
    ],
    admin: [
      "Admin configuration compiles again (Alert focus indices JSX). Index Risk Public/Admin ticks work like every other page. Upload stamps stay admin-only.",
    ],
  },
  {
    version: "6.13",
    date: "2026-08-15",
    user: [
      "Analyze payoff colours match the OI desk (green puts, red calls, sky now-curve). NIFTY / SENSEX / BANKNIFTY unchanged.",
    ],
    admin: [
      "Admin menu → Index management: search Kite F&O names, inspect options/OI, enable. Same poller as the three desk indices. Disable hides the ticker and keeps Mongo history.",
    ],
  },
  {
    version: "6.12",
    date: "2026-08-15",
    user: [
      "Same NIFTY / SENSEX / BANKNIFTY desk. The app is now wired so another market can be added from one catalog — Crude / Gold / Silver / gas are listed for later, not on the ticker yet.",
    ],
    admin: [
      "universe.py / universe.js own desk ids. GET /config.universe is additive. MCX pollable=false until MCX hours + nearest FUT spot. Engineering docs + ADR-001.",
    ],
  },
  {
    version: "6.11",
    date: "2026-08-15",
    user: [
      "Analyze is a payoff studio: legs beside the chart, OI overlay, SD bands, projected P&L, and target/date sliders. On a phone, Chart and Legs are tabs. Add booked P&L if you want closed legs on the curve.",
    ],
    admin: [
      "PositionsAnalyzeModal layout only — computeIndexPayoff math unchanged. Booked offset is closed-leg realised, not a second MTM.",
    ],
  },
  {
    version: "6.10",
    date: "2026-08-15",
    user: [
      "Journal holidays show their real names (not “Holi”). Overnight hold wording is no longer “carry shorts”. Phone sidebar stays under the OI Pulse header. Telegram session wrap at 15:15 IST — never your book.",
    ],
    admin: [
      "Book radar copy respects uploaded constituents. Kite request_token can be pasted as a full URL; checksum vs used-token errors are separate. OI first-load paints the active index first. Telegram digest moved from market close to 15:15 IST.",
    ],
  },
  {
    version: "6.09",
    date: "2026-08-14",
    user: [
      "Journal no longer crashes when you open a month that has a holiday. Year heatmap puts each index’s booked P&L on its own row (e.g. Thursday SENSEX on August). Phone header shows OI Pulse and the version.",
    ],
    admin: [
      "Holiday cells must keep the holiday object — `obj && true` is boolean true in JS. Heatmap infers index from tradingsymbol when leg.index is missing; remainder goes to Other.",
    ],
  },
  {
    version: "6.08",
    date: "2026-08-14",
    user: [
      "Trade journal now books partial closes (e.g. 3 lots out of 13), not only fully exited legs. Calendar P&L matches Positions booked today.",
    ],
    admin: [
      "Journal snapshot sums Kite realised on still-open rows plus flat exits. GET /positions pnl_today.booked is that total.",
    ],
  },
  {
    version: "6.07",
    date: "2026-08-14",
    user: [
      "Diwali Muhurat is a live session on the OI charts, not a holiday. The desk polls that window; a full holiday still stays on last session.",
    ],
    admin: [
      "Kite has no session-open API. OI poll uses NSE Muhurat hours plus a fresh quote last_trade_time. is_trading_day includes special sessions.",
    ],
  },
  {
    version: "6.06",
    date: "2026-08-14",
    user: [
      "Journal skips weekends and full holidays. Diwali Muhurat (and any day the market actually prints) is a trading day. Friday stays until the next open.",
    ],
    admin: [
      "Journal session ≠ OI is_trading_day: Muhurat books at 20:00 IST. Live fills/quotes on a listed holiday still snapshot. OI poll unchanged.",
    ],
  },
  {
    version: "6.05",
    date: "2026-08-14",
    user: [
      "Journal does not book Saturday/Sunday. Friday’s P&L stays until Monday. Carry brief Desk AI (toggle on the card) only shows overnight impact news, not the full tape.",
    ],
    admin: [
      "Weekend/holiday auto journal snapshots are deleted on journal load and skipped on Positions poll. Carry /desk-guide skips LLM and uses carry_outside.",
    ],
  },
  {
    version: "6.04",
    date: "2026-08-14",
    user: [
      "Carry brief AI is its own short overnight note (toggle on the card, off on phones). Desk AI and Radar are different tapes. On Radar, move intel tiles up or down.",
    ],
    admin: [
      "POST /desk-ai accepts desk_ai_carry. desk-guide surfaces carry / desk / positions no longer share one prompt.",
    ],
  },
  {
    version: "6.03",
    date: "2026-08-14",
    user: [
      "Desk AI is one on/off for everyone. On a phone the AI chip opens a popup with the tape; close to get back to the chart. Desktop still uses the side panel.",
    ],
    admin: [
      "Alert settings is now Admin configuration. Desk AI is only on the header chip (POST /desk-ai). Ask AI / chart strip options are gone.",
    ],
  },
  {
    version: "6.02",
    date: "2026-08-14",
    user: [
      "Desk AI stays off until an admin turns it on. The tape is short tiles you can drag to swap. On Positions it only appears inside Radar.",
    ],
    admin: [
      "Alert Settings: Show Desk AI, Ask AI, Book radar. Header AI chip still works on phone (icon). Phone header no longer wraps off-screen.",
    ],
  },
  {
    version: "6.01",
    date: "2026-08-14",
    user: [
      "Desk AI is a slim strip above the chart (tap More, drag to resize). The full tape is in the right panel so OI tiles stay readable. Phone header now has the AI chip.",
    ],
    admin: [
      "Header AI on mobile: Show Desk AI, Ask AI, and slim-strip-on-chart. Side panel picker includes Desk AI.",
    ],
  },
  {
    version: "6.00",
    date: "2026-08-14",
    user: [
      "Desk AI is now a market-intelligence strip: heavyweight cash, breadth, and news that the OI chart cannot show — plus buyer vs seller implications",
    ],
    admin: [
      "Header AI chip turns Show Desk AI and Ask AI on/off for you and guests together. Positions and Radar have their own AI ticks. Constituents still come from Impact Risk uploads. OPENAI_API_KEY stays on the server.",
    ],
  },
  {
    version: "5.19",
    date: "2026-08-14",
    user: [
      "Desk AI now shows what the OI chart cannot: moving Nifty/Bank/Sensex heavyweights and market news, plus what that means for your shorts",
    ],
    admin: [
      "GET /desk-outside. Upload constituents or the heavyweight tape stays empty. GPT still optional via OPENAI_API_KEY on the server",
    ],
  },
  {
    version: "5.18",
    date: "2026-08-14",
    user: [
      "Desk AI now coaches off live OI (spot, PCR, CE vs PE change) — not only FII/DII. Ask AI for GPT when a key is set.",
    ],
    admin: [
      "Alert Settings: Desk AI (Admin) and Desk AI (Public) ticks. POST /desk-guide accepts oi tape; rules no longer freeze for 5 minutes",
    ],
  },
  {
    version: "5.17",
    date: "2026-08-14",
    user: [
      "Phone Positions: tap Live / Exited today to expand the book; Columns opens a sheet above the dock (does not vanish on the first tap)",
    ],
    admin: [],
  },
  {
    version: "5.16",
    date: "2026-08-14",
    user: [
      "Desk AI unchanged from V5.15",
    ],
    admin: [
      "/health /ready /api/health return 200 before Mongo/Kite finish booting (publish readiness)",
      "Chrome Market Events extension moved to its own GitHub repo (no Kite)",
    ],
  },
  {
    version: "5.15",
    date: "2026-08-14",
    user: [
      "Desk AI sits under the header: live GPT when a key is set, otherwise the same rule coach — Ask AI to refresh",
      "Positions and the carry brief highlight the same AI coach",
    ],
    admin: [
      "Set OPENAI_API_KEY on the API host (never in git). POST /api/desk-guide accepts force + fii nets",
      "Chrome Market Events extension is a separate GitHub repo (no Kite / no Pulse poller)",
    ],
  },
  {
    version: "5.14",
    date: "2026-08-14",
    user: [
      "Positions desk coach: which shorts to roll, hedge, or hold (too close / ITM / net Δ)",
      "Carry brief desk guide shows even without an OpenAI key (rules), and AI when a key is set",
    ],
    admin: [
      "Desk-guide body uses Pydantic Field(default_factory) so k8s import cannot fail on mutable list defaults",
      "POST /api/desk-guide caches carry vs positions separately; clipped adjust.legs only (no Kite tokens)",
    ],
  },
  {
    version: "5.13",
    date: "2026-08-14",
    user: [
      "Carry brief opens as a full case: why to carry vs why not, results and holidays without cutting them off, plus your shorts vs session OI",
      "On desktop, drag the brief left / middle / right (or use the align buttons)",
    ],
    admin: [
      "Optional desk LLM: OPENAI_API_KEY + POST /api/desk-guide (clipped snapshot, 5-minute floor). See docs/AI.md",
    ],
  },
  {
    version: "5.12",
    date: "2026-08-13",
    user: [
      "Carry brief no longer has a black header; on phone it is a short card you can read without scrolling inside it",
    ],
    admin: [],
  },
  {
    version: "5.11",
    date: "2026-08-13",
    user: [
      "Positions Charges and Privacy tiles are larger, with dark text so they read like Radar / Journal / Analyze",
    ],
    admin: [
      "OvernightGapBrief dock classes are declared once (frontend parse error)",
    ],
  },
  {
    version: "5.10",
    date: "2026-08-13",
    user: [
      "Carry brief on phone is a moon chip; open it and Close / swipe-down always work (it no longer covers the chart)",
      "Brief is written for carrying short premium: session OI support, GIFT, VIX, holidays, heavy index-impact",
    ],
    admin: [
      "Phone ignores old drag-to-top positions; desktop still docks left and can be moved",
    ],
  },
  {
    version: "5.09",
    date: "2026-08-13",
    user: [
      "Trade journal Save stores notes, tags, and day score (it was ignoring the click)",
      "Carry brief sits on the left on desktop; drag or tap the dock control to move it",
      "On phone, Minimize / Close stay on screen so the carry brief cannot trap you",
    ],
    admin: [
      "Journal PUT reloads the day after save; dialogs sit above the carry overlay",
    ],
  },
  {
    version: "5.08",
    date: "2026-08-13",
    user: [
      "Year heatmap shows the same booked month you see on Calendar (including today)",
    ],
    admin: [
      "Year recap reloads after a journal save; Straddle WS connect logs are dev-only",
    ],
  },
  {
    version: "5.07",
    date: "2026-08-13",
    user: [
      "Phone index prices keep updating; heatmap tap jumps to the position on phone",
      "If a screen errors, Reload desk brings the board back instead of a blank page",
    ],
    admin: [
      "Login / remember-me capped at 8 POSTs per minute per IP; change-password is rate-limited",
      "Journal screenshots require matching image magic bytes; API routes are no-store",
      "New admin passwords use PBKDF2 600k iterations (existing hashes still verify at 120k)",
      "Security headers: CSP, COOP, X-Permitted-Cross-Domain-Policies",
    ],
  },
  {
    version: "5.06",
    date: "2026-08-13",
    user: [
      "Phone index tiles show live price, points, and today’s % for all three indices",
      "Sidebar slides in from the left again",
      "Position heatmap is open legs of the index you are on — readable strike labels, no exited SENSEX leftovers",
      "Tap a journal day: calendar steps aside, date chip under the month, notes on the right; tap the chip to go back",
      "Year heatmap fills from stored booked days",
      "Right panel can show OI Change",
    ],
    admin: [
      "Year heatmap fetches GET /journal/year/{year} when the journal opens",
      "Spot WebSocket merges prices so inactive indices keep LTP; /tickers hydrates prev-close",
    ],
  },
  {
    version: "5.05",
    date: "2026-08-13",
    user: [
      "Trade journal calendar on phone is a compact month grid — date and booked P&L, tap a day for the rest",
    ],
    admin: [
      "Journal calendar/year views still use booked (exited) P&L only",
    ],
  },
  {
    version: "5.04",
    date: "2026-08-13",
    user: [
      "Mobile dock uses dashboard names (OI Change, Index Risk, Strike Table) and clearer icons",
      "Phone sidebar is a curved sheet — tap outside it to close",
      "Open Interest on phone includes strikes above & below ATM",
      "Straddle chart on phone is shorter and less cramped",
      "Index bar on phone shows NIFTY / SENSEX / BANKNIFTY as three tiles (spot on the active one)",
      "Carry brief from 2:00 PM IST until next market open; slide it to the right edge for a moon icon only",
    ],
    admin: [
      "About / version click shows full changelog (APIs, k8s, Mongo) for admin; guests only see desk/UI notes",
      "Carry brief window is 14:00 IST on a trading day through the next session open (weekends included)",
    ],
  },
  {
    version: "5.03",
    date: "2026-08-13",
    user: [
      "Index Risk stays hidden when there is nothing upcoming and uploads are fresh",
      "Trade journal after-charges uses real brokerage when it is available",
      "Heatmaps use exited (booked) P&L only — open NIFTY marks are not stored as history",
    ],
    admin: [
      "Journal snapshot fetches Kite virtual contract-note charges when the day doc has none",
      "Year heatmap never falls back to live index_pnl (open MTM)",
    ],
  },
  {
    version: "5.02",
    date: "2026-08-13",
    user: [
      "Desk stays up — Positions / health no longer take the whole app down",
    ],
    admin: [
      "GET /positions Request typing crashed FastAPI 0.110 on import (nginx connection refused to :8001)",
    ],
  },
  {
    version: "5.01",
    date: "2026-08-13",
    user: [
      "Faster start — the board comes up without waiting on a full instrument dump",
    ],
    admin: [
      "Boot no longer blocks on Kite instruments / Yahoo; /health is ready when uvicorn listens",
      "Slimmer Python image (unused pip packages dropped)",
    ],
  },
  {
    version: "5.00",
    date: "2026-08-13",
    user: [
      "Live NIFTY / SENSEX / BANKNIFTY open-interest desk",
      "Positions, straddles, Index Risk, alerts, and sell candidates on one board",
      "Guests can Connect Zerodha for their own book; charts stay on the house OI feed",
    ],
    admin: [
      "Publisher Kite token owns OI; journal is admin-only; Public / Admin page ticks in Settings",
    ],
  },
];
