# NSE Market Radar — Chrome extension (independent)

Separate project from the OI Pulse FastAPI poller. Load unpacked from this folder. Chrome Web Store later is optional.

## What it shows

| Tile | Source | Server cost |
|------|--------|-------------|
| **Holiday** | Bundled `data/holidays.json` (NSE 2026 circular) | **₹0** |
| **FII / DII** | NSE `fiidiiTradeReact` from the **user’s Chrome** (cookie warmup in the service worker) | **₹0** |
| **Market risk** | India VIX via Yahoo chart API | **₹0** |
| **Index results** | Optional: your **existing** OI Pulse `/api/events/{index}` | **₹0 extra** (same VM/Mongo) |

## Why not a new backend

A always-on worker just to proxy NSE would add a VM bill and still fight Akamai. The extension runs on the trader’s laptop during market hours — the same place NSE already allows a browser.

Do **not** stand up Oracle/another FastAPI for this. If results must be public without login, export a static JSON to **GitHub Pages** or **Cloudflare R2** (free) once a day from the desk you already run — still not a new poller.

## Load locally

1. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → this folder.
2. Pin the icon. Click **Refresh**.
3. Options: paste Pulse origin only if you want weight-joined results from Mongo you already host.

## Deploy / store

- Sideload for your own desk: free.
- Chrome Web Store: one-time developer fee (Google), no monthly server.
- Keep this tree in the same git repo but **do not** merge its fetches into `oi_tracker` / k8s readiness.

## Out of scope

Kite tokens, OI snapshots, alerts, journal. Those stay in OI Pulse.
