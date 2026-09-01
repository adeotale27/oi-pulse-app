/**
 * In-app version notes. Guests see `user` only (what changed on the desk).
 * Admins also see `admin` (ops, APIs, storage). Keep in lockstep with CHANGELOG.md.
 */
export const RELEASE_NOTES = [
  {
    version: "9.13",
    date: "2026-09-02",
    user: [
      "Journal calendar no longer shows the same booked loss on today as yesterday after midnight. Today stays empty until the session actually books something.",
    ],
    admin: [
      "trade_journal writes session_anchor_date (pre-open = last session). Auto clones of the previous day’s booked/exits/win counts are purged.",
    ],
  },
  {
    version: "9.12",
    date: "2026-09-02",
    user: [
      "15:20 Paper: NSE live print updates in the cards as scrape arrives; fire print is separate. Header index tiles show a small regime chip. Day OI bias bar is cleaner.",
    ],
    admin: [
      "Egress IP lookup caches misses (CAS status was waiting on ipify). Auto Trade still probes NSE after EXECUTED for display only.",
    ],
  },
  {
    version: "9.11",
    date: "2026-09-02",
    user: [
      "On 15:20 Auto Trade, Paper now fills the strip under the cards: NSE scrape errors, why a print was skipped, and after a fire — when, how, order id, and latency.",
    ],
    admin: [
      "NSE JSON is probed from 09:15 IST on Paper/Live (5s), 250ms in the 15:20 window. Snapshot adds nse_skip_why, nse_last_*, how, fired_at.",
    ],
  },
  {
    version: "9.10",
    date: "2026-09-01",
    user: [
      "CAS Auto Trade Paper now follows the live 15:20 path without a real Zerodha buy, so you can watch the cash session before turning Live on.",
    ],
    admin: [
      "Paper MARKET BUY skips Kite connect (dry-run only). Inject before 15:20 IST stores last_rehearsal and leaves today’s status free for the real NSE print.",
    ],
  },
  {
    version: "9.09",
    date: "2026-09-01",
    user: [
      "Index regime is clearer: Ranging means the day is chopping (range bigger than the net move), Quiet means almost nothing moved. CAS has two desks on one page — 15:20 Auto Trade (pick lots, buy one ATM) vs 15:28 expiry sells.",
    ],
    admin: [
      "auto_trade_lots is independent of classic CAS lots (1–50). tickerRegime.js classifies from net% and high–low span; tips include the why line.",
    ],
  },
  {
    version: "9.08",
    date: "2026-09-01",
    user: [
      "CAS Auto Trade at 15:20 is documented for the desk: one ATM buy from the first indicative vs frozen NIFTY; you still exit in Positions.",
    ],
    admin: [
      "Read docs/CAS_AUTO_TRADE_15_20.md before Live: clocks, Live mutex with classic CAS, in-memory settings, first-print rules, and the 1 Sep 2026 +27 example.",
    ],
  },
  {
    version: "9.07",
    date: "2026-09-01",
    user: [
      "After the cash market close the board no longer hammers OI and expiry APIs, so the page should not flicker overnight.",
    ],
    admin: [
      "isMarketQuiescent uses IST open/close when /status is missing. Failed expiry fetches keep the last list. /credentials waits for the OI tracker instead of NoneType set_credentials. CAS /cas/status is 60s after hours.",
    ],
  },
  {
    version: "9.06",
    date: "2026-09-01",
    user: [
      "CAS Auto Trade can still take the first 15:20 print when the live NIFTY field has not updated yet, as long as the indicative close field has a real 15:20 clock.",
    ],
    admin: [
      "extract_indicative_hits walks indexLast then closingValue; closingValue without a stamp is skipped. /api/errors uses credentials omit and same-origin sendBeacon only.",
    ],
  },
  {
    version: "9.05",
    date: "2026-09-01",
    user: [
      "CAS Expiry opens again. Market-regime info on the index chips is next to the quote, not nested inside it.",
    ],
    admin: [
      "TickerStrip: InfoTip is a sibling of the index <button>. CasPanel restores the IST countdown clock state.",
    ],
  },
  {
    version: "9.04",
    date: "2026-09-01",
    user: [
      "CAS Expiry page loads again (broken JSX after Auto Trade). Index regime chips ignore a blank LTP instead of calling it a crash.",
    ],
    admin: [
      "Ticker regime lives in tickerRegime.js with tests. Desk AI still maps CE OI lead → call writers / short-call hold; PE OI lead → put writers / short-put hold.",
    ],
  },
  {
    version: "9.03",
    date: "2026-09-01",
    user: [
      "CAS Auto Trade waits for a real 15:20 indicative, not the stuck live NIFTY print, before buying one ATM call or put.",
      "Brains path risk is still from your short calls vs short puts — it is not the header’s index regime chip.",
    ],
    admin: [
      "Engine attaches on API boot; Auto Trade polls ~200ms without classic Activate. Prepare retries until cutoff; a rejected live order is not resent.",
    ],
  },
  {
    version: "9.02",
    date: "2026-09-01",
    user: [
      "CAS Auto Trade can buy one ATM NIFTY call or put off the first 15:20 indicative vs the frozen live index. You still exit yourself in Positions. The old 15:28 sell-both CAS is unchanged.",
    ],
    admin: [
      "NSE JSON is GET /api/marketStatus (indicativenifty50), cookie warmup like FII/DII — not a CSV and not HTML scrape. Default ±15 pts. Inject is Paper/Debug only. Live Auto-Trade cannot be on with classic CAS Live.",
    ],
  },
  {
    version: "9.01",
    date: "2026-09-01",
    user: [
      "Brains now names the stressed short, scores heat from the real book (too close, ITM, expiry, delta, concentration), and writes if/then off your nearest put and call strikes.",
      "Info icons on Brains stay open to read; they no longer slam the side panel shut.",
    ],
    admin: [
      "positionsBrain.js is the decision helper; PositionsBrainPanel is the sheet. Old v1 tile order is discarded for a six-section v2 layout.",
    ],
  },
  {
    version: "9.00",
    date: "2026-09-01",
    user: [
      "Brains launches as the live decision layer: Master Brain, Market Regime Engine, edge/risk/capital deployment, do-not-touch watchlist, adjustment-cost logic, overnight summary, and desk AI priorities.",
      "The brain button now shows a Brain icon and is labeled Brains. The panel keeps the decision flow visible without turning the desk into a generic raw-data dump.",
    ],
    admin: [
      "V9 release adds the practical decision engine: regime detection, risk interpretation, capital sizing logic, and a persistent tile order for the Brains panel.",
    ],
  },
  {
    version: "8.12",
    date: "2026-08-30",
    user: [
      "Brain controls are now visually clearer and better prioritized, with a clear read on portfolio heat, action, and when to de-risk.",
    ],
    admin: [
      "Position Brain now keeps a stable tile order and stronger decision grouping for risk-first review.",
    ],
  },
  {
    version: "8.11",
    date: "2026-08-28",
    user: [
      "The desk adds clearer decision-state blocks so the user can understand edge, risk, and deployment without reading raw metrics.",
    ],
    admin: [
      "UI decision blocks are normalized and separated from the raw overviews for cleaner desk workflows.",
    ],
  },
  {
    version: "8.10",
    date: "2026-08-27",
    user: [
      "Regression polish on the Positions page reduces noise and keeps the active decision layer in front of the book details.",
    ],
    admin: [
      "Compacted tile ordering and panel sequencing improve the desk workflow without disturbing the underlying data model.",
    ],
  },
  {
    version: "8.09",
    date: "2026-08-26",
    user: [
      "Reduced tile clutter and tightened the desk layout to keep the most relevant decisions visible in one place.",
    ],
    admin: [
      "Compact row and panel adjustments standardize the dashboard without disrupting the risk logic underneath.",
    ],
  },
  {
    version: "8.08",
    date: "2026-08-25",
    user: [
      "The alert and tile layout feel cleaner on the desk without losing the actual signal quality or book information.",
    ],
    admin: [
      "Compact layout standardization improves the density and readability of the dashboard and position workbench.",
    ],
  },
  {
    version: "8.07",
    date: "2026-08-24",
    user: [
      "The decision layer now keeps focus on portfolio heat and trade quality instead of raw data overload.",
    ],
    admin: [
      "The desk now prioritizes the decision narrative over generic chart noise in the key risk surfaces.",
    ],
  },
  {
    version: "8.06",
    date: "2026-08-23",
    user: [
      "Radar and Brain stay synchronized so the desk reads like a single intelligence flow instead of separate tools.",
    ],
    admin: [
      "Sidebar architecture is aligned between the Radar and Brains interaction patterns for a consistent desk model.",
    ],
  },
  {
    version: "8.05",
    date: "2026-08-22",
    user: [
      "The desk adds a more actionable read of the current book, with risk and action presented before raw details.",
    ],
    admin: [
      "Action-first risk panels are introduced to summarize exposure and recommended next moves.",
    ],
  },
  {
    version: "8.04",
    date: "2026-08-21",
    user: [
      "A tighter right-panel layout makes the desk easier to scan and operate while still preserving the same data depth.",
    ],
    admin: [
      "The right-side panel structure is standardized for more predictable navigation and reduced visual noise.",
    ],
  },
  {
    version: "8.03",
    date: "2026-08-21",
    user: [
      "Position insight tiles are made more compact and easier to use without losing context for the live desk.",
    ],
    admin: [
      "Tile compactness and spacing are standardized so the desk reads consistently across pages.",
    ],
  },
  {
    version: "8.02",
    date: "2026-08-20",
    user: [
      "The desk starts using more compact, action-oriented tiles across the main workbench and position views.",
    ],
    admin: [
      "Compact view components are unified across the dashboard and positions lanes for consistency.",
    ],
  },
  {
    version: "8.01",
    date: "2026-08-20",
    user: [
      "The Brains concept is refined into a more direct portfolio decision surface, with a dedicated right-side panel and stronger action hierarchy.",
    ],
    admin: [
      "The side-panel architecture is normalized so the Brain experience behaves like an extension of the existing Radar model.",
    ],
  },
  {
    version: "8.00",
    date: "2026-08-19",
    user: [
      "The portfolio workbench gets a more decision-first interface with Brain, risk framing, and a tighter right-panel experience.",
    ],
    admin: [
      "This release delivers the first full portfolio-intelligence pass: Brain panel, interactive controls, and a cleaner desk decision flow.",
    ],
  },
  {
    version: "7.18",
    date: "2026-08-20",
    user: [
      "On the phone OI Change chart, the strike tile is see-through and only stays while you hold a bar — it closes when you move or lift. Strike prices along the bottom are fully visible. Positions: NRML sits on the same line as CALL/PUT, and Exited today sits closer to Insights. Journal From/To dates are separate full-width fields on phone.",
    ],
    admin: [
      "OIChart compact tooltip is press-hold only (touch/pen). Positions mobile cards dropped the extra pb-16 spacer. Journal period dates are stacked on small screens.",
    ],
  },
  {
    version: "7.17",
    date: "2026-08-19",
    user: [
      "Last 15 mins uses the exact clock, including seconds (10:12:47 to 10:27:47), and updates on every poll. The desk keeps recording OI in the background while you are not on the site.",
    ],
    admin: [
      "OI tracker sleeps the remaining poll interval after each cycle (no clock-boundary snap). Window labels show hours:minutes:seconds. Poller + watchdog still run at process start for every enabled index in session.",
    ],
  },
  {
    version: "7.16",
    date: "2026-08-19",
    user: [
      "Last 15 mins (or 5, 10, …) is the last 15 minutes from the current tick, updated on every poll. You should not see a warming-up countdown when the session already has that history.",
    ],
    admin: [
      "_find_previous_snapshot looks at or before now−N (session-open floor). history_ready is true when that baseline exists. oi_change_lookback.pick_baseline_ts.",
    ],
  },
  {
    version: "7.15",
    date: "2026-08-19",
    user: [
      "Straddle chart speed matches Admin configuration. If you set 60 seconds, the chart and the live label both show 60s.",
    ],
    admin: [
      "GET /config and the straddle sampler overlay poll seconds from Mongo settings. Chart bucket = straddle_poll_interval_seconds. oi-settings-saved invalidates fetchConfig cache.",
    ],
  },
  {
    version: "7.14",
    date: "2026-08-19",
    user: [
      "Straddle refresh follows the interval you pick in Admin configuration (15 / 30 / 60 / 120 seconds), including the live 15s label on the chart.",
    ],
    admin: [
      "Removed the 15s UI cap and 30s sampler cap on straddle_poll_interval_seconds. clamp_straddle_poll_seconds / clampConfiguredPollMs only enforce 5–120s. DEVELOPMENT.md: check Admin config before hardcoding.",
    ],
  },
  {
    version: "7.13",
    date: "2026-08-19",
    user: [
      "The green LIVE line counts down to the next update. Straddle last price sits above the dot. Past holidays on Events fold away. CALL and PUT sit beside NRML when there is room, under it on a small screen.",
    ],
    admin: [
      "nextRefreshInSeconds in dataTruth; DeskStatusRail ticks every 1s. Straddle ReferenceDot label is SVG text above the last point. HolidaysTab completed toggle default closed. ProductSidePair uses sm row / default column.",
    ],
  },
  {
    version: "7.12",
    date: "2026-08-19",
    user: [
      "OI Change updates as soon as new data is polled. You should not need to switch 5 min / 15 min to see the move — NIFTY, SENSEX, BANKNIFTY, or any index you enable.",
    ],
    admin: [
      "Dashboard loadOI no longer awaits background indices. GET /oi/{idx}/change prefers a newer Mongo snapshot when last_snapshot is older than 25s, including while the market is open.",
    ],
  },
  {
    version: "7.11",
    date: "2026-08-18",
    user: [
      "On the phone the top bar is just the moving indexes — LAST SESSION, the date, and Market Closed stay on larger screens. Dashboard pages show the desk mark beside the title (not Index Risk). Analyze can jump ±0.5%. Sign out is red. Journal lines up on tablet. Event tiles open a shorter list on the phone.",
    ],
    admin: [
      "DeskStatusRail hides badge/as-of/market-closed below md. PageBrandTitle on OI/straddle/alerts/activity/events/CAS. Portaled info-tile menus clamp width and max-height. Journal chrome uses lg for the desktop calendar.",
    ],
  },
  {
    version: "7.10",
    date: "2026-08-18",
    user: [
      "On the phone, journal P&L uses short rounded figures so the calendar fits; on desktop you still see exact rupees and paisa.",
    ],
    admin: [
      "journalMoney: compactPnl on <md, exactPnl on desktop. Tooltip on tiles still has the exact amount.",
    ],
  },
  {
    version: "7.09",
    date: "2026-08-18",
    user: [
      "Trade journal stays current after close and shows exact rupees (no rounded lakhs). Pick from–to dates and an index to see booked profit, charges, and win %. Closed bar: LAST SESSION, the date, then Market Closed at the last snapshot — indexes keep looping.",
    ],
    admin: [
      "Locked journal rows revise booked P&L on the same IST day. GET /journal/{day} re-snapshots Positions. GET /journal/period?from&to&index.",
    ],
  },
  {
    version: "7.08",
    date: "2026-08-18",
    user: [
      "Expiry-day 0.05 hedges you keep for margin are booked after close (Zerodha already squares them). Profit booked and the journal then match Today P&L. Closed session bar: LAST SESSION + date/time, then Markets closed for the day — no duplicate market-closed sentence.",
    ],
    admin: [
      "settle_expiry_floor_hedges after close+5m or ?settle_expiry=1. Journal lock reads that booked total. VIX window 09:15–15:40 IST.",
    ],
  },
  {
    version: "7.07",
    date: "2026-08-18",
    user: [
      "The desk opens even while live data is still warming up. If the API is slow you get Retry in about a second instead of a stuck black Loading screen.",
    ],
    admin: [
      "Startup yields after Mongo ping; Kite dump is not awaited in the poller. GET /settings Mongo reload is ?reload=1 (Admin configuration). Dashboard uses /config. 15s OI poll floors to 30s until instruments load.",
    ],
  },
  {
    version: "7.06",
    date: "2026-08-18",
    user: [
      "The desk no longer freezes while NIFTY expiries load. Charts and tiles keep working when Kite’s instrument list is refreshing in the background.",
    ],
    admin: [
      "ensure_instruments_fresh uses asyncio.to_thread for kite.instruments(). GET /change Mongo is wait_for. Shared fetchConfig. Default HTTP timeout 12s.",
    ],
  },
  {
    version: "7.05",
    date: "2026-08-18",
    user: [
      "If the live API is stuck, the desk no longer sits on a black Loading screen. You get Retry instead of waiting forever.",
    ],
    admin: [
      "AuthGate races /auth/state at 2.8s. GET /auth/state skips Mongo when db is None; find_one is wait_for 2s. GET /positions caps kite.positions at 10s and kite.quote at 8s.",
    ],
  },
  {
    version: "7.04",
    date: "2026-08-18",
    user: [
      "Positions tiles are the sideways scroller again. Profit booked today includes Kite Booked on legs you only partly closed (not just fully exited). Unbooked is Total minus Booked, like Kite.",
    ],
    admin: [
      "When API realised=0 and unrealised equals pnl, booked falls through to matched buy/sell. pnl_today.unbooked = total − booked, not sum of the unrealised field.",
    ],
  },
  {
    version: "7.03",
    date: "2026-08-18",
    user: [
      "Huge OI shift again shows ATM, spot, time, and the contributing strikes. Positions tiles are larger. Profit booked today matches Kite Booked (not a mix of exited MTM and live LTP). Today P&L shows Unbooked and Booked like Kite.",
    ],
    admin: [
      "booked_pnl prefers Kite realised, then kite pnl minus unrealised. GET /positions pnl_today.booked/unbooked/total is taken before quote MTM. Quote LTP still updates open-leg P&L in the table without rewriting booked.",
    ],
  },
  {
    version: "7.02",
    date: "2026-08-18",
    user: [
      "The Bank Nifty quote-strip toast no longer pops up while you scroll. Profit booked today stays still on refresh. Straddle chart is taller without the Straddle Price pill. The Positions heading and the phone home-screen icon use the pulse mark with a very thin white border.",
    ],
    admin: [
      "GET /config does not reload Mongo. OI poller does not find_one settings every tick. First /change has no also= lookbacks. CSP allows Cloudflare insights. Settings reload is wait_for 2.5s.",
    ],
  },
  {
    version: "7.01",
    date: "2026-08-18",
    user: [
      "Admin Positions auto-refresh is saved and used on the desk. Opening configuration shows the value from the database.",
    ],
    admin: [
      "GET /settings and /config re-read Mongo so multi-worker memory cannot keep a default 30s. Positions poll uses positions_poll_interval_seconds (min 5s) while the cash session is live.",
    ],
  },
  {
    version: "7.00",
    date: "2026-08-18",
    user: [
      "One OI toast with Puts adding — bullish, Put selling increase, the old pressure line, and PE/CE crores. LIVE pulse is green on the white tile. Phone no longer shows Market open / Updated on the top rail. Header type is Outfit. Sell ideas stay on until expiry-day close. Heatmap matches desk green/red. Side OI Change matches the main chart. Header and Positions Today P&L stay on the same number; the book keeps polling on other tabs while the market is open and you have live legs.",
    ],
    admin: [
      "V7.00 major bump (desk chrome + toast copy). First /change for the open index still includes 1/3/5 lookbacks. Header and Positions share one GET /positions feed; live legs poll every 5s on any page during the cash session.",
    ],
  },
  {
    version: "6.45",
    date: "2026-08-18",
    user: [
      "The desk opens from a saved session instead of sitting on Loading for a minute. The chart you are on fills first; other indices catch up a few seconds later. Funds available matches Kite Available margin (not the negative cash line).",
    ],
    admin: [
      "AuthGate no longer waits 3×8s on /auth/state. /change lookbacks gather in parallel with maxTimeMS so Mongo cannot pin the origin. CSP allows data: alert beeps. Funds tile uses kite.margins equity.net (Available margin).",
    ],
  },
  {
    version: "6.44",
    date: "2026-08-18",
    user: [
      "Positions Refresh pulls a full live book. OI last pulled sits under the chart. LIVE is a white tile. Straddle numbers no longer clip. Green Settings is on the far right. Admin tools close when you tap outside.",
    ],
    admin: [
      "Admin tools: configuration through CSV sit above Public; Sign out stays last. Disabled-index toast no longer mentions Index management.",
    ],
  },
  {
    version: "6.43",
    date: "2026-08-18",
    user: [
      "OI Change and Open Interest start at ±5 strikes. Phone charts are tighter. Alerts close with one tap; wording is shorter (Puts/Calls adding). Tap the desk once so alert sounds can play on iPhone.",
    ],
    admin: [
      "Huge-shift no longer stacks toasts under a Radix dialog. iOS uses an HTMLAudio beep because Web Audio stays silent in Silent Mode.",
    ],
  },
  {
    version: "6.42",
    date: "2026-08-18",
    user: [
      "Live P&L on open legs follows quote LTP. Open Interest stays centered when panes are closed (same as OI Change). Hovering a disabled index shows a toast. Home Screen icon matches the rounded in-app mark.",
    ],
    admin: [
      "GET /positions quotes open instruments and marks MTM with the official Kite value formula. Disabled ticker tiles toast instead of cursor-not-allowed.",
    ],
  },
  {
    version: "6.41",
    date: "2026-08-18",
    user: [
      "Charges match Zerodha (₹20 per order, not per fill). LIVE + Market open sit together on the left. Positions Refresh pulls a fresh book. Disabled BNF stays clear, just not clickable.",
    ],
    admin: [
      "Virtual contract note collapses fills by order_id. Positions poll for the whole cash session. PWA standalone asks once to enable notifications.",
    ],
  },
  {
    version: "6.40",
    date: "2026-08-18",
    user: [
      "Kite login returns to striklenz.com. Desk alert sounds play again. Notifications can be turned off. Alerts from another tab collapse to one summary. The top LIVE bar stays one slim scrolling row. Home-screen icon is full green (no white frame) and the in-app mark pulses.",
    ],
    admin: [
      "Kite Connect redirect URL: https://striklenz.com/kite-callback. Saving Admin configuration applies pages immediately and no longer re-seeds expiries unless enabled indices changed. Disabled indices are not clickable in the header ticker.",
    ],
  },
  {
    version: "6.39",
    date: "2026-08-17",
    user: [
      "If Kite is in overnight maintenance, Positions says so (not a blank zero book). Phone bias bar is shorter; tabs tuck away when you scroll. Friday/Monday holidays show Long weekend on the tile.",
    ],
    admin: [
      "Empty /positions before 7:00 IST plus bulletin/API flags set maintenance. Do not clear that flag on an empty book.",
    ],
  },
  {
    version: "6.38",
    date: "2026-08-17",
    user: [
      "LIVE bar scrolls all enabled indices (same as phone). Switching index keeps OI fresh. Positions keep updating in other tabs only while you have live legs.",
    ],
    admin: [
      "OI poller: max 2 concurrent snapshots so turning MCX on cannot stampede Kite/CPU.",
    ],
  },
  {
    version: "6.37",
    date: "2026-08-17",
    user: [
      "Today P&L stays in the header only. Position insight tiles swipe sideways again. Your book can sit above the list, after Live, or below — drag it or use the placement menu.",
      "Closed-Chrome phone alerts: open Alerts and use Telegram. OI Change’s percent alert is a small bell on the ATM row.",
    ],
    admin: [
      "GOLD / SILVER / CRUDEOIL Kite names stay majors (not GOLDM / CRUDEOILM). Snapshot ATM follows listed MCX strikes so Gold OI does not 503 on a 100-pt catalog step.",
    ],
  },
  {
    version: "6.36",
    date: "2026-08-17",
    user: [
      "Your book is collapsible and can sit above or below the position list. Net Δ now says bullish or bearish.",
      "From 20 December, a reminder asks for next year’s NSE holiday list until the admin uploads it.",
    ],
    admin: [
      "Index management and Settings: MCX master toggle. Off = no commodity data. On = Enable each name to poll only that chain.",
      "Index Risk shows how many constituent names matched the NSE events file, plus close-misses.",
    ],
  },
  {
    version: "6.35",
    date: "2026-08-17",
    user: [
      "Position cards always show CALL or PUT next to NRML. Phone insight tiles are smaller and the same size. Book score sits above the list.",
      "When Chrome is closed on a phone, use Telegram for alerts — in-page banners only work while this tab is open.",
    ],
    admin: [
      "Upload → NSE holiday circular (DATE, NAME, optional SESSION/OPEN/CLOSE). Years in the file replace that year’s built-in holidays. GET /holidays.",
    ],
  },
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
