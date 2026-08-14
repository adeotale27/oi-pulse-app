You are a Cursor Cloud Agent working **only** on https://github.com/adeotale27/Market_Events

Do **not** open, clone, or push **oi-pulse-app**. Do not add Kite, FastAPI, Mongo, Emergent `/health` probes, Desk AI, journal, or OI pollers.

## Goal

Ship a Chrome **Manifest V3** extension on **Market_Events `main`** that mirrors the four OI Pulse header tiles plus live index prices.

If this repo is empty or incomplete, seed it from the Pulse **orphan** branch (extension files only — never merge that branch into Pulse `main`):

```bash
git clone --single-branch --branch cursor/market-events-1bf9 \
  https://github.com/adeotale27/oi-pulse-app.git /tmp/me-ext
# copy every file from /tmp/me-ext (except .git) onto this repo’s working tree
# commit on Market_Events main and push
```

Load unpacked (`chrome://extensions` → folder with `manifest.json`) to verify.

## Product (must all be present)

1. **Holiday** — `data/holidays.json` `{ holidays: [{ date, name }] }`. Admin replaces via Options file picker **or** git commit. Show next holiday with TODAY / TOMORROW / in Nd (Pulse `HolidayBadge` / `nextHolidayInfo`).
2. **FII / DII** — fetch `https://www.nseindia.com/api/fiidiiTradeReact` from the user’s Chrome after cookie warmup (NSE home + `/reports/fii-dii`), same idea as Pulse `fii_dii_service.py`. Alarm ~3h. **Not uploaded.**
3. **Next Event** — `data/econ-events.json` copied from Pulse `frontend/src/lib/econCalendar.js` (RBI, FOMC, India/US CPI, GDP, Budget, NFP). Labels like Pulse `MarketEventsBadge`.
4. **Index Impact** — `data/index-impact/{NIFTY,SENSEX,BANKNIFTY}.json`. Popup chips **NIFTY / SENSEX / BANKNIFTY**: selecting an index shows **that** file only (Pulse `GET /events/{activeIndex}` + `MarketImpactBadge`). Filter Quarterly Results / Board Meeting; red ≤7d, blue 8–14d. Admin uploads one JSON per index (Pulse equivalent of `POST /api/admin/upload/events` after constituents join — here the join is already in the file).
5. **Spots** — Yahoo chart `^NSEI`, `^BSESN`, `^NSEBANK` during 09:15–15:30 IST (~1 min). All three always shown.

## Admin “server”

GitHub **is** the server: commit JSON under `data/` on Market_Events `main`. `data/config.json` `remoteBase` should be
`https://raw.githubusercontent.com/adeotale27/Market_Events/main`
so installed copies pick up holiday / econ / impact without a new zip. Options page stores per-browser overrides in `chrome.storage`.

## Docs that must exist

README.md, ADMIN.md, PUBLISH.md (Web Store zip + semver lockstep `VERSION` ↔ `manifest.version`), PULL.md, CHANGELOG.md.

## Do not

Kite tokens, OI snapshots, alerts, journal, Desk AI, merge into Pulse `main`, host this on Emergent with the Pulse API.
