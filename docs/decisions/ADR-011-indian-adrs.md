# ADR-011 — Indian ADR monitor (Twelve Data)

Desk tab **ADRs** polls Twelve Data from the backend only (Fernet vault / `TWELVE_DATA_API_KEY`). Quotes are stored in `adr_observations` / `adr_latest`. Column visibility is a per-user localStorage preference and does not change what is fetched.

Default universe is true ADRs of Indian parents (INFY, HDB, IBN, WIT, RDY, SIFY, WNS, TTM). Admin can add more. Provider listings that are not NYSE/NASDAQ depositary receipts of Indian parents are filtered out.

US session uses `America/New_York` 09:30–16:00 with NYSE holidays. ADR quotes are polled no more frequently than every 600 seconds and never while the US session is closed. Failed polls keep the last successful observation. Global Markets Twelve Data instruments share the same account quota and are also gated to a 600-second per-instrument cadence.

The cadence is per instrument, not a daily account-credit budget. Seven FX instruments alone can exceed the Free plan's 800 daily credits if all are enabled and polled through their open sessions; other instruments and ADRs add usage. The Twelve Data account dashboard is account-wide and may include calls from outside StrikLenz. StrikLenz does not yet enforce an aggregate daily-credit cap, so configure only the instruments needed and monitor the provider dashboard.
