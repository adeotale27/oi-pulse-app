/**
 * In-app version notes. Guests see `user` only (what changed on the desk).
 * Admins also see `admin` (ops, APIs, storage). Keep in lockstep with CHANGELOG.md.
 */
export const RELEASE_NOTES = [
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
      "Alerts poll every 15s in session unless the Alerts view is open (8s)",
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
