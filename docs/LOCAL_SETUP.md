# OI Pulse — Run Locally

## Prerequisites

- Python **3.11+**
- Node.js **18+** / Yarn 1.x
- MongoDB **6+** reachable locally (or Atlas URI)
- Optional: Zerodha Kite API key + daily access token for LIVE mode

---

## 1. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Create `backend/.env` (never commit secrets):

```env
MONGO_URL=mongodb://127.0.0.1:27017
DB_NAME=oi_pulse

ADMIN_USERNAME=Adeotale
ADMIN_PASSWORD=change-me
# Optional fixed bootstrap token (otherwise sessions are issued at login):
# ADMIN_TOKEN=

# Preferred vault encryption key (Fernet key or any passphrase). If unset, vault
# derives from MONGO_URL+DB_NAME (legacy). Set this in production.
# CREDENTIALS_FERNET_KEY=

# Optional Kite bootstrap (otherwise configure via UI “Kite API”):
# KITE_API_KEY=
# KITE_ACCESS_TOKEN=

# Optional Telegram:
# TELEGRAM_BOT_TOKEN=
# TELEGRAM_CHAT_ID=

# Optional desk LLM (see docs/AI.md). Set on the API host / Emergent secrets — never commit.
# OPENAI_API_KEY=
# DESK_GUIDE_MODEL=gpt-4o-mini

CORS_ORIGINS=http://localhost:3000
# ENABLE_DEV_MOCK=true   # only for local fake OI without Kite
```

Start API (default port **8000**):

```bash
cd backend
source .venv/bin/activate
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

Health check: `http://localhost:8000/api/status`

---

## 2. Frontend

```bash
cd frontend
yarn install
```

Create `frontend/.env.local`:

```env
REACT_APP_BACKEND_URL=http://localhost:8000
```

Start CRA:

```bash
yarn start
```

App: `http://localhost:3000` — API calls go to `http://localhost:8000/api/...`.

WebSockets default to `ws://localhost:8000` when the env backend URL is set (see `src/lib/spotWs.js`).

---

## 3. First login

1. Open the app → Admin login with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
2. **Kite API** → save key/secret → generate/refresh daily access token → mode becomes **LIVE**.
3. Settings → confirm **enabled indices** (Fresh Pull only hits these).
4. Optional: turn **Public** on and approve guest access requests.

---

## 4. Useful admin actions

| Action | Where |
|--------|--------|
| Fresh Pull all enabled indices | Header → **Fresh Pull** (or Tools on mobile) |
| Morning token refresh | Header → **Refresh** |
| Upload constituents / events | **Upload** |
| Telegram prefs | **Telegram** |

---

## 5. Tests (optional)

```bash
cd backend
pytest -q
```

Root-level `backend_*.py` / `p0_regression_test.py` scripts hit a running API — set base URL as those files expect.

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| `MONGO_URL` KeyError on boot | `backend/.env` missing or not loaded |
| CORS errors | `CORS_ORIGINS` includes `http://localhost:3000` |
| Always OFFLINE | Kite credentials / access token expired — use Morning Refresh |
| Empty chart after Fresh Pull | Expected until first successful Kite pull; confirm LIVE + market hours |
| Phone layout crushed | Compact defaults on ≤1280px; right panel auto-hides ≤768px — use Alerts tab |

More detail: [ABOUT.md](./ABOUT.md) · [DATA.md](./DATA.md)
