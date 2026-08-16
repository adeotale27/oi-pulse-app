# Rules for AI coding agents on StrikLenz

1. Read [ARCHITECTURE.md](./ARCHITECTURE.md), [ENGINEERING_RULES.md](./ENGINEERING_RULES.md), [../AGENTS.md](../AGENTS.md), and `VERSION` before coding.
2. Reuse `universe`, holidays, payoff, journal helpers. Do not create a second index list.
3. Never duplicate services/components/utilities that already exist.
4. Follow existing names and folders. New underlyings go in `universe` first.
5. Do not modify unrelated files. Do not drive-by reformat.
6. Do not remove working features. Publisher Kite owns OI; guest books use guest Kite; journal is admin-only.
7. Never hardcode secrets. Use env + vault. Keep `.env.example` updated.
8. Do not add dependencies unless the task cannot be done with the current stack.
9. Add tests for universe, hours, symbol parse, payoff, and money math you change.
10. Update docs when architecture or the catalog changes.
11. Keep diffs small. Bump version lockstep when shipping ([VERSIONING.md](./VERSIONING.md)).
12. Run the nearest pytest / `node *.test.js`. Do not claim a full rewrite of `server.py` was required for a catalog change.
13. Check regressions: default enabled indices still NIFTY/SENSEX/BANKNIFTY; settings still reject unknown ids; MCX majors stay off until Admin enables them.
14. Prefer incremental changes. Do not enable Crude/Gold/Silver/NG polling as a surprise (admin Enable is the switch).
15. No temporary hacks (fake spot, NSE hours for MCX, hardcoded tokens).
16. Significant choices → `docs/decisions/ADR-NNN-*.md`.
17. Inspect `oi_service.get_snapshot` before inventing a new chain fetcher.
18. Do not rewrite `Dashboard.jsx` / `PositionsPanel.jsx` / `server.py` “for cleanliness”.
19. Decide from the repo when the behavior is already specified (version bump, universe, auth headers).
21. After a finished change: bump version, open a PR, **merge to `main`**. Do not leave work only on a feature branch.
22. New index / stock / commodity: follow the checklist in [DEVELOPMENT.md](./DEVELOPMENT.md#add-an-underlying) — `session_group` hours, poll only in those hours, Positions shows the Kite leg, journal + heatmap **Others**, phone chrome, tests, merge to main.
23. New desk UI: phone in the same PR. Do not grow header/sidebar/sticky chrome — extra indices use `INDEX_CHIP_CAP` (dropdown / slide). Follow [DEVELOPMENT.md](./DEVELOPMENT.md#add-a-ui-component).
