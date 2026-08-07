# OI Pulse

NSE Open Interest tracker for NIFTY / SENSEX / BANKNIFTY — live Kite Connect polling, MongoDB snapshots, React dashboard with alerts, sell candidates, straddles, and session replay.

## Docs

| Doc | Contents |
|-----|----------|
| **[docs/ABOUT.md](docs/ABOUT.md)** | Project overview, login/access, internal & external APIs |
| **[docs/DATA.md](docs/DATA.md)** | How data is stored in MongoDB and manipulated end-to-end |
| **[docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md)** | Run backend + frontend locally |

## Quick start

```bash
# Backend
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# create backend/.env with MONGO_URL, DB_NAME, ADMIN_* …
uvicorn server:app --reload --port 8000

# Frontend (other terminal)
cd frontend && yarn install
echo 'REACT_APP_BACKEND_URL=http://localhost:8000' > .env.local
yarn start
```

See [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md) for full env vars and first-login steps.
