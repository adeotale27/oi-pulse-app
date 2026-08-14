/**
 * In-app version notes. Guests see `user` only (what changed on the desk).
 * Admins also see `admin` (ops, APIs, storage). Keep in lockstep with CHANGELOG.md.
 */
export const RELEASE_NOTES = [
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
