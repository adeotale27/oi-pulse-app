# Desk AI — market intelligence outside the OI chart

The OI Change chart already shows PCR, CE/PE change, and walls. Desk AI must **not** recap that.

It answers: *what could change an options trade that is not visible from OI alone?*

Deterministic code scores:

- **Heavyweight cash** — uploaded Nifty 50 / Bank Nifty / Sensex constituents (Admin → Upload / Impact Risk) quoted via **Kite**, Yahoo if Kite is down. Weight × move = estimated index impact.
- **Breakouts / VWAP / gaps**, **breadth**, **sector** participation
- **News** — public RSS (Google News + ET markets)
- **Corporate calendar** — `nse_events` joined onto those same constituents
- **India VIX** when the poller has it

OpenAI is optional (`OPENAI_API_KEY` on the **server env**, never in git). Without a key you still get the heavyweight + news coach. **Ask AI** is GPT on that same outside tape.

## Who sees what

Configuration is **not** in Alert Settings.

| Control | Where | Who it applies to |
|---------|--------|-------------------|
| **Show Desk AI** | Header **AI** chip (admin) | Admin **and** guests together |
| **Ask AI** | Same header menu | Admin **and** guests together |
| **AI** on Positions | Positions toolbar | Strip on the Positions page |
| **AI** on Radar | Book radar panel only | Intelligence on Radar |

Turning **Show Desk AI** on also turns Radar intelligence on; hide it from the Radar switch if you do not want it there.

## APIs

- `GET /api/desk-outside` — movers, breadth, sectors, events, briefing (cached ~45s)
- `GET/POST /api/desk-guide` — POST attaches outside tape server-side; `skip_llm` when Ask AI is off
