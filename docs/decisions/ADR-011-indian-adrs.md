# ADR-011 — Indian ADR monitor (Twelve Data)

Desk tab **ADRs** polls Twelve Data from the backend only (Fernet vault / `TWELVE_DATA_API_KEY`). Quotes are stored in `adr_observations` / `adr_latest`. Column visibility is a per-user localStorage preference and does not change what is fetched.

Default universe is true ADRs of Indian parents (INFY, HDB, IBN, WIT, RDY, SIFY, WNS, TTM). Admin can add more. Provider listings that are not NYSE/NASDAQ depositary receipts of Indian parents are filtered out.

US session uses `America/New_York` 09:30–16:00 with NYSE holidays. One extra poll at 09:15 IST on NSE trading days. Failed polls keep the last successful observation.
