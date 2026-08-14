# Desk AI — market intelligence outside the OI chart

The OI Change chart already shows PCR, CE/PE change, and walls. Desk AI must **not** recap that.

It answers: *what could change an options trade that is not visible from OI alone?*

Deterministic code scores:

- **Heavyweight cash** — uploaded Nifty 50 / Bank Nifty / Sensex constituents (Admin → Upload / Impact Risk) quoted via **Kite**, Yahoo if Kite is down. Weight × move = estimated index impact.
- **Breakouts / VWAP / gaps**, **breadth**, **sector** participation
- **News** — public RSS (Google News + ET markets)
- **Corporate calendar** — `nse_events` joined onto those same constituents
- **India VIX** when the poller has it

OpenAI is optional (`OPENAI_API_KEY` on the **server env**, never in git). Without a key you still get the heavyweight + news coach.

## Who sees what

Desk AI is **open for the whole desk** (admin and guests share one switch). It is **off** until someone turns it on from the header **AI** chip.

| Control | Where | Who it applies to |
|---------|--------|-------------------|
| **On / Off** | Header AI chip only | Everyone — one flag |
| **Open in side panel** | Header AI menu (desktop) | Full tape in the right panel |
| **Phone popup** | Tap the AI chip | Full tape in a sheet; close returns to the chart |
| **Book radar intelligence** | Radar panel tick | Radar only — not the Kite positions book |

There is no chart strip and no Desk AI section in Admin configuration.

## APIs

- `GET /api/desk-outside` — movers, breadth, sectors, events, briefing (cached ~45s)
- `GET/POST /api/desk-guide` — POST attaches outside tape server-side
- `POST /api/desk-ai` — any signed-in desk user can flip `desk_ai_show` (Radar ticks stay admin-only)
