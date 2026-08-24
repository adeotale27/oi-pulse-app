# StrikLenz — notes for humans and AI

**Current version: V8.05** (`VERSION` at repo root).

This is an Indian-market **open interest desk** branded **StrikLenz** (display name: repo-root `APP_NAME`). Indices: NIFTY, SENSEX, BANKNIFTY. FastAPI + MongoDB + React, live data from **Zerodha Kite Connect**.

Read first:

1. [README.md](README.md) — what the app is, how it works, user edge, how it is configured
2. [docs/VERSIONING.md](docs/VERSIONING.md) — bump `5.00` → `5.01` on updates; `6.00` when a whole new feature ships
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system map; [docs/ENGINEERING_RULES.md](docs/ENGINEERING_RULES.md) — how to change it
4. [docs/AI_DEVELOPMENT_RULES.md](docs/AI_DEVELOPMENT_RULES.md) — rules for coding agents
5. [docs/ABOUT.md](docs/ABOUT.md) — APIs and auth
6. [docs/DATA.md](docs/DATA.md) — Mongo collections and the poll pipeline
7. [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md) — run locally
8. [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — add an underlying / API / UI
9. [docs/HOSTING.md](docs/HOSTING.md) — leaving Emergent, Oracle Cloud vs keeping Mongo, GoDaddy DNS
10. [docs/AI.md](docs/AI.md) — rule copilot on the carry brief; optional LLM over OI + book

Rules of the product:

- Publisher Kite token owns **OI / charts**. Guest books use **their own** Kite login.
- Journal is **admin-only**.
- Admin configuration → **Public / Admin dashboard pages**: two ticks per page (guests vs admin desk).
- After a finished change: bump version per `docs/VERSIONING.md`, open a PR, **merge to main**. Always. Checklist: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#ship--merge-to-main). New index/stock: [add-an-underlying checklist](docs/DEVELOPMENT.md#add-an-underlying) (hours, poll, Positions, journal Others, phone chrome). New UI: same PR on phone; do not grow header/sidebar.
