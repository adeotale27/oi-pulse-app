# ADR-001 — Instrument universe

## Context

The desk polls three index option chains (NIFTY, SENSEX, BANKNIFTY). Those ids were copied in the tracker, FastAPI validation, Dashboard, settings, Telegram, journal heatmap, and strike steps. Adding Crude / Gold / Silver / Natural Gas (or any stock) would otherwise mean another scatter of literals — and those products are **not** the same as NSE cash-session indices.

## Problem

Hardcoded triples block safe extension. A naïve “add GOLD to INDICES” would poll MCX names on NSE hours, use a missing spot quote, and fail ATM rounding.

## Decision

1. Single catalog: `backend/universe.py` + `frontend/src/lib/universe.js`.
2. **Desk / pollable** ids stay the three cash indices. `INDEX_CONFIG` is generated from that set.
3. MCX majors live in the catalog with `pollable: True` and `quote_kind: mcx_fut`. They join the live board only after Admin Enable ([ADR-003](./ADR-003-mcx-majors.md)).
4. `/config` exposes additive `universe` for agents and future Admin UI; settings still only tick desk ids.
5. F&O symbol parser name list is generated (longest first) so book legs on FINNIFTY / CRUDEOIL still parse when possible.

## Alternatives considered

- Keep copying `["NIFTY","SENSEX","BANKNIFTY"]` — cheap now, hostile to every later market.
- Enable MCX immediately in `INDEX_CONFIG` — would break hours, spot, and quote_symbol (`MCX:GOLD…FUT` rolls).
- Per-exchange microservices — far too large; one poller + catalog is enough.

## Consequences

- New market = catalog row, then hours + spot, then `pollable: True`.
- Live behavior of V6.11 OI board is unchanged.
- Agents must not treat catalog presence as “ship it on the ticker”.
