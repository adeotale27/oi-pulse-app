# Desk AI — live OI seller coach

Alerts stay rule-based. Desk AI does **not** send every 15s poll through GPT. It **does** re-read the live chain on each tick and rewrite the rule coach; GPT is optional and rate-limited.

## Layer 1 — always on (this app)

The **Desk AI** bar (when ticked on in Alert Settings) shows:

- Live tape: spot, ATM, PCR, CE vs PE OI change, put/call walls for NIFTY / SENSEX / BANKNIFTY
- VIX + GIFT
- Open shorts from Positions (when Kite is connected)
- Calendar (results / holidays)
- Cash FII/DII as **T+1**, never as a tick

HOLD / ROLL / CUT / HEDGE / STAND ASIDE comes from that tape even with no API key.

**Carry brief** and **Positions** still have their own coach strips (`surface: carry` / `positions`).

## Layer 2 — optional GPT

Set in `backend/.env` (never in the frontend, never in git):

```
OPENAI_API_KEY=sk-...
# optional:
# DESK_GUIDE_API_KEY=
# DESK_GUIDE_BASE_URL=https://api.openai.com/v1
# DESK_GUIDE_MODEL=gpt-4o-mini
# DESK_GUIDE_MIN_INTERVAL_S=300
```

- `GET /api/desk-guide` — `{ enabled, model, interval_s }`
- `POST /api/desk-guide` — clipped snapshot (`oi`, `adjust`, `book`, `fii`, `vix`, `giftPct`, calendar). `force: true` (Ask AI) bypasses the GPT cache. Rules text is always rebuilt from the latest snap.

The backend clips strings, drops strike grids and Kite tokens. If the key is missing or GPT errors (quota), you still get `source: "rules"` from the live tape.

## Who sees the bar

Alert Settings (admin only):

- **Desk AI (Admin)** — default on
- **Desk AI (Public)** — default off (guests)

## What not to do

- Do not LLM the alert engine
- Do not put `KITE_ACCESS_TOKEN` in chat
- Do not call the model on every ticker poll
