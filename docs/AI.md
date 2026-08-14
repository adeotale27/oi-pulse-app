# Desk AI — OI + positions guide

Do **not** send every 15s OI poll through a language model. Alerts stay rule-based. The carry brief already watches session OI, GIFT, VIX, the calendar, and the connected book.

## Layer 1 — always on (this app)

The overnight **carry brief** is the copilot:

- Session OI per index (which shorts are supported)
- Your open CE/PE shorts vs that OI
- GIFT, India VIX, Friday/weekend gap
- Results (index-weight) and holidays, listed in full when the brief is open
- **Why carry** / **Why not** columns

OI still updates on the existing poll. Positions refresh about once a minute while the brief is open. No API key required.

## Layer 2 — optional LLM (every ~5 minutes)

Set one of these in `backend/.env` (never in the frontend, never in prompts as secrets):

```
OPENAI_API_KEY=sk-...
# or a compatible key:
# DESK_GUIDE_API_KEY=
# DESK_GUIDE_BASE_URL=https://api.openai.com/v1
# DESK_GUIDE_MODEL=gpt-4o-mini
# DESK_GUIDE_MIN_INTERVAL_S=300
```

Then:

- `GET /api/desk-guide` — `{ enabled, model, interval_s }`
- `POST /api/desk-guide` — compact snapshot from the brief (why / why-not / results / book counts / VIX / GIFT). Response `{ source: "llm"|"rules", guide }`.

The backend clips strings, drops unknown fields, and **will not** forward Kite tokens. If the key is missing, you still get `source: "rules"` from the same snapshot.

Restart the API after adding the key. Open the carry brief; a **Desk guide** strip appears only when the LLM pass succeeds.

## What not to do

- Do not LLM the alert engine or huge-shift path
- Do not put `KITE_ACCESS_TOKEN` or vault material in chat messages
- Do not call the model on every ticker poll (cost, latency, and flaky advice)
