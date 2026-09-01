# Changelog

## V9.03 — 2026-09-01

CAS Auto Trade will not treat the frozen live NIFTY print as the 15:20 indicative (that would have locked NO_TRADE before +27 printed). Prepare retries if Kite blips; the engine stays on a 200ms loop when Auto Trade is on even without classic Activate; MARKET BUY still uses Kite `order_type=MARKET` + `market_protection=-1`. Brains path risk stays the short book (calls = upside, puts = downside), not a fake index regime.

## V9.02 — 2026-09-01

CAS **Auto Trade** (separate from the 15:28 sell-both arm): freeze live NIFTY just before 15:20, lock that ATM, poll NSE `GET /api/marketStatus` for Indicative NIFTY 50, and place **one MARKET BUY** of ATM CE or PE if the first sane print is ±15 pts vs freeze. You exit in Positions. Paper by default. Overnight CLOSE leftovers are ignored. Do not run Auto-Trade Live together with classic CAS Live.

## V9.01 — 2026-09-01

Positions **Brains** now scores the live short book instead of a canned heat story. Heat comes from too-close / ITM / near-expiry / concentration / net delta / negative theta — not from `|θ|` or a 15% “danger” band that flagged every typical short. If/then uses your nearest short put and call, not placeholder 24,000 / 24,500. Short calls are upside risk; short puts are downside. Info icons pin a portaled tip and no longer close the Brains or Radar sheet.

## V9.00 — 2026-09-01

Position Brain now reads as a real decision system rather than a generic data dump: the main verdict leads with urgency, confidence, the reason it matters, and the best action to take next; the side panel also explains why the portfolio is heating, how the best and worst positions compare, and where data quality is still limiting the call.

The compact desk tile layout was tightened into a cleaner single-row system, stale withdrawal-copy messaging was hidden behind the future Kite-led data path, and event tiles were tightened so they fit without crowding the dashboard.

## V8.15 — 2026-08-25

Positions tiles stay one line: **Profit booked** (no “today”) shows rupees; % of wallet sits in the hint. Funds available is Kite leftover only — the 72L “total book” (cash + SPAN on hedges) is not shown and is not the % base. Duplicate commodity cash is not added on top of equity.

## V8.14 — 2026-08-25

Day % is **wallet after charges**, not SPAN on a leveraged/hedged book. Wallet is Kite opening cash + collateral (e.g. ~36.25L), never leftover margin + utilised (that was showing ~72L). Example: ₹15L in the account, ₹25L notional via leverage, ₹1,500 booked after ₹200 charges → **0.10%**. A previous leftover+SPAN freeze is replaced on the next snapshot.

## V8.13 — 2026-08-25

Journal and Positions treat trading as a **% of total book**, not leftover cash. Day % is booked P&L ÷ that morning’s total funds (available margin + money already in trades). Weekly and monthly % use the first stored total book of that week/month. Kite Connect has no withdrawal API; estimated in/out is the gap vs the prior close (overnight MTM included). Positions **Profit booked today** shows the same % against total book, never Funds available.

## V8.12 — 2026-08-25

ATM label no longer clips on the OI bars. Inactive indexes (SENSEX) show day move without clicking them. Show OI sits under How to read this. Replay Change auto-plays from the open of the window. Switching timeframes animates the bars. Around ATM defaults to ±5. Admin tools dim the desk behind an emerald-tinted panel. Mobile event tiles stay compact.

## V8.11 — 2026-08-25

App-wide error log: uncaught API exceptions, `logger.exception`, and desk UI crashes go to Mongo `error_logs` (tokens stripped). Admin menu **Error log**. Websocket cancel still closes quietly and does not swallow KeyboardInterrupt.

## V8.10 — 2026-08-25

Straddle and spot websockets treat reload / tab-close `CancelledError` as a normal disconnect instead of an ASGI crash. Ctrl+C while uvicorn is respawning can still print a KeyboardInterrupt — that is the process stopping, not a desk bug.

## V8.09 — 2026-08-25

W/M expiry circles are back on the sidebar. 25 Aug NIFTY still tags **M** (last Tuesday); SENSEX monthly is last Thursday.

## V8.08 — 2026-08-25

Monthly vs weekly expiry uses the exchange calendar (NSE last Tuesday, SENSEX last Thursday) instead of “last date in the list”. 25 Aug 2026 NIFTY is monthly; SENSEX monthly is 27 Aug. Journal no longer lists a contract tape (Excel download still has the book). Closed Kite rows are not re-seeded every poll.

## V8.07 — 2026-08-25

NIFTY expiries no longer stick on today’s weekly after the first OI paint. Heavyweight cash quotes retry in chunks (one bad symbol no longer blanks the tape). Browser alerts use a timed service-worker call and a page Notification fallback so they still fire when you are in another tab. Journal shows the stored trade tape (contract, sold/bought, IST clocks, P&L); Excel leads with that sheet.

## V8.06 — 2026-08-24

Desk AI names the shorts: Hold / Cut/define / Roll by tradingsymbol vs the writer tape. Positions radar says which leg to buy back, roll, or hedge. Closed-short win rates from the trade ledger (`GET /api/desk-memory`) feed a Book memory line. Coach explains the top 3 sell-ranker ideas — it does not invent a list. OI alerts add writer-tape actions (do not add the other side). Snapshots stay compact: no tokens or full chains.

## V8.05 — 2026-08-24

Desk AI was collapsing to a session-focus headline. The strip now shows OI tape (writers, PCR, walls), the open book (Δ / Θ / IV), last-30d journal, cash heavyweights, and a **Do / Don't** coach. Overnight hold uses the same stack plus VIX, GIFT, events, and greeks for hold/cut/don't-add lines.

## V8.04 — 2026-08-24

Desk AI matches the OI Change bar: call-writer tape supports **CE shorts**, put-writer tape supports **PE shorts**. Overnight hold now scores NIFTY, SENSEX, and BANKNIFTY (Mon–Tue / Fri NIFTY focus, Wed–Thu SENSEX). Heavyweights are NIFTY + BANKNIFTY cash only. Download trades lives in the journal (popover sits above the modal); it is gone from Positions.

## V8.03 — 2026-08-24

Chrome OS banners when the desk is on another screen: we no longer mark desktop notifications as `silent`, we fire them when the tab is hidden or unfocused, and a tiny service worker (`sw-alerts.js`) uses `showNotification` so Chrome actually paints the sidebar. Turning notifications on sends a test banner. In-app toasts still cover the focused tab.

## V8.02 — 2026-08-24

Desk chrome: trading-terminal focus rings, pointer cursor on controls, denser timeframe pills (JetBrains Mono), crisper header glass, 44px-class tile toggles on phone, and `prefers-reduced-motion` respected globally. Light Swiss desk is unchanged — no OLED restyle.

## V8.01 — 2026-08-24

Partials are stored as their own rows: time, qty exited **this** fill, remaining qty, and realised for that slice (Excel **Partials** sheet). A Friday hold that is scaled out twice on Monday keeps Friday’s entry clock.

## V8.00 — 2026-08-24

Trade ledger: every Positions poll stores open / partial / closed cycles in Mongo (`trade_cycles`). **Download trades** (Positions toolbar + journal) exports an Excel for any From/To filter.

- Entry time is the original fill (or first seen). A Friday hold that is still open on Monday after a new Kite token is the same cycle — not a new purchase.
- Exit time is the flatten fill (or inferred only if the leg vanished while the token was stale).
- Partial exits are extra events on that cycle (second Excel sheet).
- Stale token: we freeze clocks and do not close or reopen trades until Kite is back.

## V7.18 — 2026-08-20

Phone OI Change: strike tile is translucent, only while you hold a bar, and hides as soon as the finger moves or lifts. Strike labels on the X-axis are no longer clipped. Positions: NRML and CALL/PUT stay on one line; less gap after Exited today. Journal From/To dates stack cleanly on phone.

## V7.17 — 2026-08-19

OI Change window keeps exact seconds (10:12:47–10:27:47 for 15 min). Background poller writes every Admin interval for all enabled indices with no browser open — ticks are not snapped to :00/:15/:30.

## V7.16 — 2026-08-19

OI Change Last N mins is now−N through now, sliding every poll. It does not wait to “warm up” 15 minutes after a refresh.

- Baseline is the snapshot at or before now−N (today’s 09:15 floor). 10:29:45 + 15 min → ~10:14:45–10:29:45; next poll at 10:30 → ~10:15–10:30
- Dropped the 80% window warmup that kept the blue “Full compare in …” banner

## V7.15 — 2026-08-19

Poll intervals are read from Admin configuration in Mongo. The straddle chart bucket and “live Ns” label use that saved value (60s stays 60s).

- GET /config and the sampler re-read oi / straddle / positions seconds from `settings` `_id: alerts`
- Saving configuration clears the frontend /config cache so an old 15s payload cannot overwrite 60s
- Positions book default matches the form (30s) until that document loads

## V7.14 — 2026-08-19

Straddle (and other) poll intervals follow Admin configuration. 60s is 60s — not silently capped at 15s in the chart or 30s in the sampler.

- Chart REST poll, countdown, sampler, tick cache, and WS use `straddle_poll_interval_seconds`
- Checklist: before hardcoding a number, check whether Admin already has that setting

## V7.13 — 2026-08-19

LIVE rail, straddle, and Positions show countdown to the next poll. Straddle last price sits above the end dot. Past NSE holidays collapse. CALL/PUT chips sit beside NRML when the screen allows.

- Status copy is `next (11s)` instead of `Updated 4s ago` / last-refresh clock
- Straddle premium label is above the last tick (not clipped on the right)
- Events: completed holidays start collapsed
- Positions: NRML + CALL/PUT stack on a tight screen, sit in one row from `sm` up

## V7.12 — 2026-08-19

OI Change paints as soon as a poll lands — any enabled index, no timeframe click.

- Live poll no longer waits on the other indices before the next refresh.
- `/change` takes a newer Mongo tick when in-memory cache is stale (open session included).

## V7.11 — 2026-08-18

Phone status bar shows only the moving indexes (no LAST SESSION, date, or Market Closed). Page titles use the desk mark. Analyze adds ±0.5%. Journal layout fits tablet. Sign out is red. Event tile menus stay short on phone.

- Closed-session rail on phone: ticker only; LAST SESSION / session date / Market Closed stay on tablet and desktop
- Page mark (same as Kite Positions) on Straddle Premium, OI Change, Open Interest, Strike Table, Sell Candidates, Build-up, Alerts, Activity, Events, CAS — not Index Risk
- Analyze spot presets include −0.5% and +0.5%
- Holiday / FII / Events / Impact dropdowns clamp to the viewport so they do not cover the phone chart
- Trade journal is full-screen through tablet (`lg`); compact calendar until desktop; date fields and stats grid align
- Admin Sign out is rose red

## V7.10 — 2026-08-18

Journal money on phone uses short rounded labels (₹47.5k) so calendar tiles fit; desktop still shows exact paisa.

## V7.09 — 2026-08-18

Trade journal stays in sync after close, shows exact rupees, and adds a from–to totals strip. Closed-session rail is LAST SESSION + date + Market Closed at last snapshot.

- Same-day journal P&L can revise after EOD lock (leftover expiry hedges). Opening a day re-snapshots Positions.
- Journal money uses paisa (no ₹2.2k / lakhs rounding). From–to panel: exact booked profit, charges, win %, index filter (NIFTY / SENSEX / BANKNIFTY).
- Slim bar: yellow LAST SESSION, session date, moon **Market Closed at** last snap. Dropped “for the day”, “Closed 15:40”, and “snap 15:40”.
- Index ticker loops: what scrolls off one side comes back on the other.

## V7.08 — 2026-08-18

Book leftover 0.05 expiry hedges after the cash session so Profit booked and the journal match Today P&L.

- After admin market close + 5 minutes, open CE/PE with expiry today (or earlier) at ₹0.05 are marked closed in our book (no Kite order). Zerodha already RMS-squares them; Connect often still shows net qty until T+1.
- Manual **Square leftovers in book** on Positions after close if you want it before 15:45.
- Journal EOD lock uses the same booked total (your ~₹47.5k, not the inflated booked column).
- LAST SESSION rail: yellow pill + date/time, then moon **Markets closed for the day**. Dropped the duplicate “Market closed · OI paused · GIFT/VIX” line.
- India VIX poll window is 09:15–15:40 IST (not after hours).

Kite forum (settlement vs LTP on leftover expiry): realised P&L uses settlement, not lastPrice.


## V7.07 — 2026-08-18

Keep the desk answering while Kite and Mongo catch up. Admin 15s poll / extra indices must not freeze Loading.

- HTTP binds after Mongo ping; index builds and Kite dump run in the background
- OI poller no longer waits on `kite.instruments()`; dump is fire-and-forget
- GET `/oi`, straddle, and VRP use cache until the dump is in memory (no dump on the event loop)
- Dashboard settings poll uses `/config` (no Mongo reload). Admin configuration uses `?reload=1`
- 15s OI interval is floored to 30s until instruments are loaded
- Auth gate fail-opens after 1.5s if `/auth/state` never returns


## V7.06 — 2026-08-18

Unstick the origin: the daily Kite instrument dump no longer runs on the FastAPI event loop.

- Poller `ensure_instruments_fresh` loads instruments in a thread (was blocking every `/api/*` for 20s+)
- `/oi/.../change` Mongo lookbacks are wait_for 3s; first snapshot read is 2s
- Default Axios timeout 12s; `/expiries` 8s; one shared `/config` for Dashboard + clocks
- Index-events tile waits 8s after paint so it is not in the boot stampede

## V7.05 — 2026-08-18

Stop the dark “Loading…” screen when the origin hangs (preview /auth/state 0-byte stall).

- Auth gate fetches `/auth/state` first with a 2.8s cap; Remember-me runs after paint
- `/auth/state` returns immediately if Mongo is not up; settings/session reads are time-capped
- Kite `positions()` / `quote()` on GET `/positions` wait at most 10s / 8s so they cannot pin the worker forever

## V7.04 — 2026-08-18

Positions tiles are a horizontal scroller again. Booked P&L includes Kite Booked on still-open partials.

- Insight tiles row scrolls sideways (not a 2×4 wrap)
- Kite Connect often puts the whole MTM in `unrealised` with `realised` at 0; we no longer treat that as Booked ₹0
- Open legs that were bought/sold today use matched buy/sell for Booked, same as the Kite Booked column
- Unbooked = Total P&L − Booked (Kite Unbooked)

## V7.03 — 2026-08-18

Restore the full huge-OI-shift card and match Kite Booked / Unbooked / Total P&L.

- Big OI move modal again shows ATM, spot, time, Δ Call/Put OI per strike, and larger tiles (not three tiny chips)
- Positions insight tiles wrap in a 2×4 grid with readable numbers
- Profit booked today uses Kite `realised` (or kite P&L minus unrealised), not buy/sell averages or live LTP
- Today P&L hint is Unbooked + Booked, the same split as Kite Positions

## V7.02 — 2026-08-18

Quiet the false Bank Nifty toast, keep booked profit still, and use the pulse mark on the home screen.

- Disabled indices on the quote strip no longer toast on hover (scrolling was firing “BANK NIFTY is on the quote strip…”)
- Positions “too close” strip only shows when shorts are actually inside the warn band
- Profit booked today no longer moves with live LTP (closed cash only)
- Kite Positions uses the pulse mark; home-screen icon is the same pulse, sharper, with a very thin white rim
- GET `/config` and the OI poller no longer wait on Mongo; a stuck DB cannot freeze every `/api/*` call
- First OI `/change` is one lookback (20s budget); 1/3/5 windows fill 2.5s later so the rest of the desk is not queued behind it

## V7.01 — 2026-08-18

Admin configuration reads the saved Mongo document every time you open it; Positions auto-refresh uses that value.

- Opening Admin configuration always reloads settings from the database (not a stale API-worker copy that still showed 30s)
- Positions auto-refresh (seconds) is saved and applied to the live book poller and header P&L
- OI / straddle / pages / hours / desk flags apply from the same saved document

## V7.00 — 2026-08-18

Desk V7: one OI toast with the full read, a visible LIVE pulse, and a cleaner phone header.

- OI toasts keep **Puts adding — bullish** and add Put/Call selling plus PE/CE crores on the same card
- LIVE tile pulse is emerald (readable on the white badge)
- Phone status rail hides **Market open · Updated Ns** so VIX/GIFT/indices keep the row
- Header uses Outfit; ticker labels are a bit larger and less mono
- First OI fetch still includes 1/3/5 windows so huge-shift can fire on the first tick
- Sell / decay ideas stay live until **market close IST on expiry day** (not ~4h before close)
- Position heatmap uses desk green/red fills; P&L border (not a red ring on every “too close” tile)
- Side-panel OI Change uses the same OI-on/off chart as the main tab
- Header Today P&L and Positions Today P&L share one book snapshot (they no longer drift by a few tens of rupees)
- Open live legs keep GET /positions running on every dashboard page while the cash session is live

## V6.45 — 2026-08-18

Desk paints in seconds: auth no longer blocks on a jammed API, and startup loads the active index first.

- Returning admin/guest sessions skip the full-screen Loading wait and refresh auth in the background
- First OI pull is the open tab only (other indices + huge-shift windows fill a few seconds later)
- Alerts, tickers, VIX extras, VRP, and settings no longer fire at the same instant as the first chart
- `/oi/.../change` lookbacks run in parallel with a 4s Mongo cap so one slow query cannot stall the origin
- Alert beep `data:` audio is allowed by CSP (`media-src`)
- Positions **Funds available** is Kite Available margin (`equity.net` ≈ cash + collateral), not the debit Available cash figure

## V6.44 — 2026-08-18

Positions Refresh fetches a full book; desk charts stay centered; admin tools reorder.

- Refresh on Positions always pulls the latest book (polls stay quiet once the table is on screen)
- OI last pulled sits under the OI card; bias, tabs, and Events share the same centered width as the charts
- LIVE is a white tile; ticker has a gap after Market open / Updated
- Straddle stats wrap instead of clipping; green Settings sits at the far right
- Admin tools: config through CSV above Public; Sign out last; click outside closes
- Disabled-index toast says Bank Nifty (not BNF) and drops the Index management line

## V6.43 — 2026-08-18

Phone OI charts default to ±5 strikes; alerts close and sound on iOS.

- OI Change and Open Interest default to ATM ±5 (phone and desktop); phone chart is shorter with upright strike labels
- One toast at a time, below the header; huge-shift uses a short closable card (not a toast stuck under a dialog)
- OI Change toasts use short copy (Puts/Calls adding or up/down %)
- Phone alert sound: keep Web Audio unlocked on tap; iOS plays an HTML beep (Silent Mode still mutes unless the ringer is on)

## V6.42 — 2026-08-18

Open-leg P&L marks to live quotes; OI + Open Interest stay centered when panes close.

- Positions re-quote open F&O LTPs and recompute MTM (Kite `positions().pnl` was lagging)
- Open Interest uses the same max-width card as OI Change when both side panes are closed
- Disabled BNF hover toasts instead of the forbidden cursor
- Long weekend: Friday holiday (Fri–Sun) and Monday holiday (Sat–Mon)
- Phone / Home Screen icon is the rounded desk mark, not a hard full square

## V6.41 — 2026-08-18

Brokerage counted per order; LIVE status sits next to the pill; Positions refresh.

- Day charges use one Kite contract-note row per executed order (split fills were each billed ₹20)
- LIVE rail: pulsing dot + LIVE, then Market open / Updated, then the ticker
- Positions poll every interval during the session; Refresh is never stuck disabled
- Disabled index tiles stay full colour, not clickable, hover explains they are off the desk
- Home Screen: prompt to enable notifications; icon is `any` (no maskable cutout glow)
- OI Change wash is lighter and the card is centered when both side panes are closed

## V6.40 — 2026-08-18

Kite callback on striklenz.com; desk sounds; slim status; full-bleed icon.

- Kite login bounce ignores retired aaisnamkeen.com and completes on striklenz.com (`/kite-callback` is not behind AuthGate)
- Notifications can be turned **off**; alert sounds unlock Web Audio (missing `playForAlert` import was silencing them)
- Background tab: one summary toast instead of a pile; huge-shift modals do not stack 7–8 deep
- Always one slim top status rail (scrolls); MARKETS LIVE no longer duplicates in the header; disabled indices are not clickable in the header
- Admin configuration applies on save immediately (no expiry re-seed unless enabled indices changed)
- Home-screen icon is full-bleed green with a pulse glow on the in-app mark

## V6.39 — 2026-08-17

Show Kite overnight maintenance on Positions; slimmer phone chrome.

- Empty Kite book before 7:00 IST keeps the maintenance banner (same idea as Kite’s toaster)
- Next Holiday tile flags Fri/Mon holidays as a long weekend (extra theta)
- Phone: shorter day-bias bar; tabs/Events hide on scroll; selected index stays as a slim price chip
- Home Screen icon uses opaque 512 + dark splash so iOS adds less white padding

## V6.38 — 2026-08-17

MCX poll load cap; keep OI and live Positions warm in the background; LIVE ticker on desktop.

- Poller runs at most 2 Kite snapshots at once (MCX on no longer floods CPU)
- OI `/change` warms every enabled index after the active one so Sensex is not stale on switch
- Positions keep polling in other tabs only while there are live (non-zero qty) legs
- LIVE rail marquee shows all enabled indices on desktop too

## V6.37 — 2026-08-17

Phone chrome and Positions layout; MCX Gold quotes use the listed strike grid.

- Sticky index row no longer repeats Today P&amp;L (header chip stays)
- Positions: insight tiles swipe left/right again; Columns is a compact popover; closed-Chrome alert copy lives on Alerts / Telegram
- Your book can be dragged (or placed) above the list, after Live, or below the list — kept in this browser
- OI Change “Alert on ≥ %” is a small bell on the ATM strip
- GOLD / SILVER / CRUDEOIL quotes skip minis; snapshot ATM uses listed MCX strikes (not a wrong catalog step)

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
