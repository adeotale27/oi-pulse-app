# Admin data

There is no FastAPI in this repo. “Upload into the server” means:

1. **Shared:** commit JSON on **https://github.com/adeotale27/Market_Events** under `data/` (GitHub raw is the server every installed copy can fetch).
2. **This browser only:** Chrome → extension **Options** → pick the JSON files. Those win until you Clear uploads.

## Holiday list

Replace `data/holidays.json` (or Options → Holiday):

```json
{ "holidays": [ { "date": "2026-09-14", "name": "Ganesh Chaturthi" } ] }
```

`date` = `YYYY-MM-DD`. NSE trading holidays only.

## Next Event (macro)

Same shape as Pulse `frontend/src/lib/econCalendar.js`. Replace `data/econ-events.json`:

```json
{ "events": [ { "date": "2026-08-06", "name": "RBI MPC Decision", "type": "rbi", "country": "IN", "impact": "critical" } ] }
```

`impact`: `critical` | `high` | `medium` | `low`. Popup labels: TODAY / TOMORROW / in Nd (Pulse `MarketEventsBadge`).

## Index Impact (one file per index)

Pulse: admin `POST /api/admin/upload/events` + constituents, then `GET /events/{NIFTY|SENSEX|BANKNIFTY}`.

Here the join is already done in JSON:

- `data/index-impact/NIFTY.json`
- `data/index-impact/SENSEX.json`
- `data/index-impact/BANKNIFTY.json`

```json
{
  "index": "NIFTY",
  "events": [
    {
      "name": "MAXHEALTH",
      "date": "2026-08-14",
      "event_type": "Quarterly Results",
      "weightage": 3.1,
      "symbol": "MAXHEALTH"
    }
  ]
}
```

Popup chips show **only** the selected index. High-impact filter matches Pulse: **Quarterly Results** and **Board Meeting**, sorted by days remaining then weightage.

Selecting NIFTY / SENSEX / BANKNIFTY in the popup is the same as changing `activeIndex` on the Pulse desk.

## FII / DII

Do **not** upload. Service worker warms NSE cookies (`nseindia.com` home + FII-DII page) then `GET /api/fiidiiTradeReact`. Needs a normal Chrome profile that can open NSE (same constraint as Pulse’s Python pull).

## Remote base

Options → GitHub remote, or `data/config.json`:

```json
{ "remoteBase": "https://raw.githubusercontent.com/adeotale27/Market_Events/main" }
```

Empty `remoteBase` = bundled + Options only.
