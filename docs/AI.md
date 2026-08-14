# Desk AI — outside the OI chart

The OI Change chart already shows PCR, CE/PE change, and walls. Desk AI must **not** recap that.

It adds what you cannot see on that chart:

- **Heavyweight cash** — top-weight Nifty 50 / Bank Nifty / Sensex names (from your uploaded constituents) quoted live via **Kite**, Yahoo if Kite is down. Only names that are actually moving vs previous close.
- **News** — public market RSS (Google News + ET markets). Headlines, not a full terminal.
- **Calendar** — index results / holidays already in Pulse
- **Your shorts** — ITM / too-close only

HOLD / ROLL / CUT is about those outside facts vs the book. Alerts stay rule-based. GPT is optional (`OPENAI_API_KEY` on the **server**, never in git). **Ask AI** uses GPT; otherwise the same outside tape is a rules coach.

Upload constituents under Admin → Upload or the heavyweight tape stays empty.

## Who sees the bar

Alert Settings: **Desk AI (Admin)** / **Desk AI (Public)**.

## APIs

- `GET /api/desk-outside` — movers + news (cached ~45s)
- `GET/POST /api/desk-guide` — POST attaches outside tape server-side
