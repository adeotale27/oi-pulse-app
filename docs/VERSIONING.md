# StrikLenz versioning

Product **name** lives in **`APP_NAME`** at repo root (currently **StrikLenz**). Change that one line and rebuild; backend and UI read it.

Product **version** lives in **`VERSION`** at repo root (currently **V7.14**). Display it as `V` + that number (`V5.10`).

Keep these in lockstep on every ship:

| File | Role |
|------|------|
| `APP_NAME` | Canonical **display name** (source of truth for branding) |
| `VERSION` | Canonical product version (source of truth) |
| `CHANGELOG.md` | What changed in this version |
| `frontend/src/lib/appVersion.js` | UI label + About modal (name from `REACT_APP_APP_NAME` at build) |
| `backend/app_version.py` | API `/api/version` and `/api/status` (loads `APP_NAME` + `VERSION`) |
| `frontend/package.json` `version` | npm-style `major.minor.patch` (`5.0.0` ≡ `V5.00`) |
| `AGENTS.md` | So a new AI/session starts from the current version |

## When to bump

| Kind of change | Bump | Example |
|----------------|------|---------|
| Bugfix, polish, copy, publish/hotfix | **hundredths** | `5.00` → `5.01` → `5.02` |
| A complete new feature area (new desk surface, new data product) | **major** | `5.xx` → **`6.00`** |

Do not skip `APP_NAME` + `VERSION` + `CHANGELOG.md`. Clicking the logo / **V5.xx** in the app must always match the shipped tree.
