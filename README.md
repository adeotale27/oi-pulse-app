# Market Events (Chrome)

Standalone **Manifest V3** extension. **No Kite. No OI Pulse poller. No Mongo. No FastAPI.**

Canonical product repo: **https://github.com/adeotale27/Market_Events**

If you only have `oi-pulse-app`, pull **the orphan branch** — see **[PULL.md](PULL.md)**. Do not copy this into OI Pulse `main`.

## What you see

Same four header tiles as OI Pulse, plus live index prints:

| Tile | Source | Who updates |
|------|--------|-------------|
| **Holiday** | `data/holidays.json` | Admin JSON (Options upload **or** commit on GitHub) |
| **FII / DII** | NSE `fiidiiTradeReact` from this Chrome profile | Automatic (~3h + Refresh). **Never uploaded.** |
| **Next Event** | `data/econ-events.json` (RBI, FOMC, CPI, GDP, Budget — Pulse `econCalendar.js`) | Commit / Options upload |
| **Index Impact** | `data/index-impact/NIFTY.json` · `SENSEX.json` · `BANKNIFTY.json` | Admin per-index JSON |

**Index chips** (NIFTY / SENSEX / BANKNIFTY) switch Index Impact to that index only — same idea as Pulse `GET /events/{activeIndex}` when the desk index changes.

**Spots:** Yahoo `^NSEI` / `^BSESN` / `^NSEBANK` last + %. During 09:15–15:30 IST the worker refreshes about every minute.

Color rules (Pulse-like): Holiday / Next Event go red for today–tomorrow; Index Impact red if a result/board meeting is within 7 days, blue for 8–14 days.

## Data precedence

1. Files the admin picked on **chrome://extensions → Details → Extension options** (this browser)
2. GitHub raw (`data/config.json` `remoteBase`, default `Market_Events` `main`) — this is the shared “server”
3. JSON bundled in the zip / Load unpacked folder

## Version

`VERSION` and `manifest.json` `"version"` must be the same semver (now **1.0.0**). See [PUBLISH.md](PUBLISH.md).

## Load unpacked

1. Chrome → `chrome://extensions`
2. Developer mode
3. **Load unpacked** → this folder (the folder that contains `manifest.json`)

## Admin

[ADMIN.md](ADMIN.md) — holiday JSON, per-index impact JSON, Options page, GitHub as the file server.

## Publish to the Web Store

[PUBLISH.md](PUBLISH.md)
