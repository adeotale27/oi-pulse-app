# ADR-004 — Per-underlying poll hours

## Context

ADR-003 turned the OI poller into one evening clock whenever any MCX name was enabled: NIFTY kept polling after 15:40. MCX circular MCX/TRD/068/2026 (US DST) splits commodity closes: non-agri 23:30 IST (DST) / 23:55 (standard); select agri 21:00; other agri 17:00. Index/stock F&O still close 15:40.

Journal heatmap only rendered NIFTY / SENSEX / BANKNIFTY. Kite positions already return GOLD, Crude, FINNIFTY, stocks — those must stay on Positions and book into journal **Others**.

## Decision

1. Catalog `session_group`: `nse` | `mcx_non_agri` | `mcx_select_agri` | `mcx_agri`.
2. `_poll_once` fetches only names `index_in_session`. `oi_session_open` is true if **any** enabled id is in session.
3. Journal EOD lock uses the **latest** enabled close + 5 minutes. Year heatmap always has an Others row; `booked_index_pnl.OTHER` holds non-desk booked P&L.
4. Adding a name is the DEVELOPMENT.md checklist (hours, poll, Positions, journal Others, merge to main).

## Consequences

- Enabling Gold does not keep NIFTY polling in the evening.
- Evening commodity exits still journal if Gold is enabled (lock after MCX close).
- Agri names, when catalogued, get 17:00 / 21:00 without another blunt clock.
