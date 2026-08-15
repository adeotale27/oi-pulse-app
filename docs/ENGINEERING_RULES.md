# OI Pulse — engineering rules

Read [ARCHITECTURE.md](./ARCHITECTURE.md) and [AI_DEVELOPMENT_RULES.md](./AI_DEVELOPMENT_RULES.md) first.
Product rules: [../AGENTS.md](../AGENTS.md). Versioning: [VERSIONING.md](./VERSIONING.md).

## Priority

**Existing functionality → data integrity → security → correctness → maintainability → new features.**

Do not rewrite working code to look cleaner. Prefer the smallest change that fits the existing pattern.

## Stack

- Frontend: React (CRA/craco) + Tailwind, JS (not TypeScript).
- Backend: FastAPI + Motor/MongoDB + Zerodha Kite Connect.
- Product version: repo-root `VERSION` (lockstep files in VERSIONING.md).

## Naming

- Python: modules `snake_case.py`, classes `PascalCase`, functions `snake_case`.
- React components: `PascalCase.jsx` under `frontend/src/components` or `pages`.
- Shared client logic: `frontend/src/lib/*.js` (payoff math, holidays, universe).
- Tests sit next to the module (`foo.test.js`) or in `backend/tests/test_*.py`.
- Instrument ids are **uppercase Kite names**: `NIFTY`, `BANKNIFTY`, `CRUDEOIL`. Aliases live in `universe`.

## Folder map

| Path | Belongs here |
|------|----------------|
| `frontend/src/pages` | Route-level screens |
| `frontend/src/components` | UI. No Kite/Mongo. Call `lib/api.js`. |
| `frontend/src/lib` | Pure-ish domain: payoff, holidays, universe, journal heat |
| `frontend/src/hooks` | React hooks |
| `backend/server.py` | HTTP routes only; keep logic in modules |
| `backend/oi_tracker.py` | Poll loop, settings, snapshots |
| `backend/oi_service.py` | Kite chain → snapshot |
| `backend/universe.py` | **Only** place to add a new underlying |
| `backend/*.py` | One concern per file (journal, hours, positions) |
| `docs/` | Human + AI contracts |

## Dependency direction

```
UI → lib/api → FastAPI → domain modules → Mongo / Kite
         ↘ lib (universe, holidays, payoff)
```

Forbidden: UI importing backend paths; Kite calls from React; duplicating `DESK_IDS` in a fourth file.

## Instrument universe

- Live OI poller accepts **pollable desk ids only** (`universe.DESK_IDS`).
- Catalog may list MCX / stocks **before** they are wired. `pollable: false` until session hours + spot quote path exist.
- Admin settings must not offer non-pollable ids.
- Adding a new underlying: see [DEVELOPMENT.md](./DEVELOPMENT.md#add-an-underlying).

## Functions

Keep functions doing one job. Giant files (`Dashboard.jsx`, `server.py`, `PositionsPanel.jsx`) are known debt — **split only when you are already changing that area**, and preserve test ids / API paths.

## Errors and logging

- Backend: `logging.getLogger(__name__)`. No empty `except:`. Catch Kite/network, log type + message, return safe JSON.
- Never log access tokens, API secrets, passwords, or Fernet keys.
- FastAPI: `HTTPException` with a short `detail` string. 401/403 for auth, 400 validation, 404 unknown index.

## API

- Prefix `/api`. Auth: `X-Admin-Token` or `X-Guest-Token` as today.
- Do not break existing paths or response keys. Additive fields (`universe` on `/config`) are OK.
- Validate index ids with `INDEX_CONFIG` / `is_pollable`.
- Publisher Kite owns OI. Guest books use the guest’s own Kite login. Journal is admin-only.

## Database

- Collection names stay as in [DATA.md](./DATA.md). `oi_snapshots` unique on `(index, expiry, timestamp)`.
- No destructive `delete_many` except existing Fresh Pull / retention prune.
- New fields: optional, backward compatible. Do not rename `index` on snapshots.

## Security

- Secrets only in env / encrypted vault (`credentials` collection). Never commit `.env`.
- Maintain `backend/.env.example` and `frontend/.env.example` (gitignored pattern except those two).
- CORS from `CORS_ORIGINS`. Do not widen to `*` in production.
- Guest cannot see publisher positions.

## Tests

- Meaningful tests for payoff, holidays, universe, journal heat, market hours, symbol parse.
- Do not add tests that only assert mocks returned mocks.
- After behavior changes: run the nearest existing test file.

## Git

- Feature branches `cursor/<short-name>-<suffix>` as the cloud agent requires.
- One concern per PR. Bump version lockstep on ship. Merge to `main` when the change is finished.
- Rollback: revert the version bump commit; Mongo schema must remain readable by the previous version.

## Comments

Explain *why* (NSE vs MCX hours, token checksum vs used-token). Do not narrate `i += 1`.
