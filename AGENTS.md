# StrikLenz — notes for humans and AI

**Current version: V18.41** (`VERSION` at repo root).

This is an Indian-market **open interest desk** branded **StrikLenz** (display name: repo-root `APP_NAME`). Indices: NIFTY, SENSEX, BANKNIFTY. FastAPI + MongoDB + React, live data from **Zerodha Kite Connect**.

Read first:

1. [README.md](README.md) — what the app is, how it works, user edge, how it is configured
2. [docs/CAS_AUTO_TRADE_15_20.md](docs/CAS_AUTO_TRADE_15_20.md) — 15:20 Auto Trade (admin runbook, decisions, trade logic)
3. [docs/VERSIONING.md](docs/VERSIONING.md) — bump `5.00` → `5.01` on updates; `6.00` when a whole new feature ships
4. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system map; [docs/ENGINEERING_RULES.md](docs/ENGINEERING_RULES.md) — how to change it
5. [docs/AI_DEVELOPMENT_RULES.md](docs/AI_DEVELOPMENT_RULES.md) — rules for coding agents
6. [docs/CHANGE_CHECKLIST.md](docs/CHANGE_CHECKLIST.md) — mandatory change, comment, test, documentation, and ship checklist
7. [docs/ABOUT.md](docs/ABOUT.md) — APIs and auth
8. [docs/DATA.md](docs/DATA.md) — Mongo collections and the poll pipeline
9. [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md) — run locally
10. [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — add an underlying / API / UI
11. [docs/HOSTING.md](docs/HOSTING.md) — leaving Emergent, Oracle Cloud vs keeping Mongo, GoDaddy DNS
12. [docs/AI.md](docs/AI.md) — rule copilot on the carry brief; optional LLM over OI + book
13. [docs/END_TO_END_AUDIT.md](docs/END_TO_END_AUDIT.md) — repeatable read-only local audit workflow; sample: [docs/audits/LOCAL_END_TO_END_AUDIT_2026-09-29.md](docs/audits/LOCAL_END_TO_END_AUDIT_2026-09-29.md)

Rules of the product:

- Publisher Kite token owns **OI / charts**. Guest books use **their own** Kite login.
- Journal is **admin-only**.
- Admin configuration → **Public / Admin dashboard pages**: two ticks per page (guests vs admin desk).
- After a finished change: bump version per `docs/VERSIONING.md`, open a PR, **merge to main**. Always. Checklist: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#ship--merge-to-main). New index/stock: [add-an-underlying checklist](docs/DEVELOPMENT.md#add-an-underlying) (hours, poll, Positions, journal Others, phone chrome). New UI: same PR on phone; do not grow header/sidebar.
- Protected live-data rule: without explicit administrator approval for that exact
  change, do not modify Positions, OI Change, Open Interest, strike/expiry math,
  Straddle, CAS signals, snapshot freshness/order, broker-book mapping, or poll
  semantics. UI polish and safe admin configuration changes remain allowed.
- Every code change must follow [docs/CHANGE_CHECKLIST.md](docs/CHANGE_CHECKLIST.md),
  including meaningful comments for major/non-obvious frontend and backend
  behavior, updates to stale comments, focused tests, documentation, and
  lockstep versioning.
- Passwordless admin is permitted only for loopback requests in local
  development when explicitly enabled; follow
  [docs/LOCAL_DEVELOPMENT_AUTH.md](docs/LOCAL_DEVELOPMENT_AUTH.md) and never
  enable it in staging or production.
- For an explicit full/local end-to-end audit request, follow
  [docs/END_TO_END_AUDIT.md](docs/END_TO_END_AUDIT.md): read-only, isolated local
  data, preserve the worktree, and create a sanitized dated report.
