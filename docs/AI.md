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

Configuration is in **Alert Settings** and on the header **AI** chip. It is **off** until you turn it on.

| Control | Where | Who it applies to |
|---------|--------|-------------------|
| **Show Desk AI** | Alert Settings **and** header AI chip | Admin **and** guests together |
| **Ask AI** | Same | Admin **and** guests together |
| **Slim strip on chart** | Header AI chip (this device) | Collapsed one-line strip above the OI grid |
| **Desk AI** | Right-panel picker | Full tape |
| **Book radar intelligence** | Alert Settings **and** Radar panel tick | Radar only — not the Kite positions book |

Turning **Show Desk AI** on also turns Radar intelligence on; hide it from the Radar switch if you do not want it there.

## APIs

- `GET /api/desk-outside` — movers, breadth, sectors, events, briefing (cached ~45s)
- `GET/POST /api/desk-guide` — POST attaches outside tape server-side; `skip_llm` when Ask AI is off
