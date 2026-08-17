# Upload Data — Storage, CSV Columns & Replace Behaviour

This document describes how the **Upload** section stores data, which columns are required for each file type, and what happens when a valid new file replaces an older one.

Related overview: [DATA.md](./DATA.md).

---

## Where data is stored

Uploads are **not** kept as raw files on disk for runtime. After validation succeeds, rows are written to **MongoDB**:

| Upload type | Mongo collection | Scope of replace |
|-------------|------------------|------------------|
| Nifty 50 constituents | `index_constituents` | All docs with `index: "NIFTY"` |
| Bank Nifty constituents | `index_constituents` | All docs with `index: "BANKNIFTY"` |
| Sensex constituents | `index_constituents` | All docs with `index: "SENSEX"` |
| NSE event calendar | `nse_events` | **Entire** collection |
| NSE holiday circular | `nse_holidays` | **Entire** collection (runtime **merges by calendar year** over the built-in 2025–2026 list) |
| Event upload meta | `settings` (`_id: "nse_events_meta"`) | Upserts `uploaded_at`, `source_filename`, `row_count` |
| Holiday upload meta | `settings` (`_id: "nse_holidays_meta"`) | Same stamp fields |

APIs:

- `POST /api/admin/upload/constituents` — form fields: `upload_type` ∈ `nifty50` \| `banknifty` \| `sensex`, plus `file`
- `POST /api/admin/upload/events` — form field: `file`
- `POST /api/admin/upload/holidays` — form field: `file` (NSE trading-holiday circular)
- `GET /api/holidays` — `{ source: "upload"|"builtin", holidays: [...] }`
- `GET /api/constituents/{index}` — read back
- `GET /api/events/{index}` — joined events for constituents of that index

Accepted file types: **`.csv`**, **`.xlsx`**, **`.xls`**.

---

## Replace behaviour (important)

On a **successful** upload (file readable **and** row validation passes with **zero** errors):

1. Old rows for that category are **deleted**.
2. New rows are **inserted**.
3. The UI toast confirms how many rows were saved.

If validation fails (`ok: false` + `errors: [...]`):

- **Nothing is deleted.**
- Previous constituents / events remain unchanged.

Implementation: `event_risk_service.save_constituents` / `save_events` only run after `parse_*` returns an empty error list.

---

## Nifty 50 / Bank Nifty constituents

`upload_type`: `nifty50` → index `NIFTY` · `banknifty` → `BANKNIFTY`

### Required columns

| Column (aliases accepted) | Required | Notes |
|---------------------------|----------|-------|
| Company Name / Company | Yes | Display + join key |
| Symbol | Yes | NSE symbol; duplicates rejected |
| Industry / Sector | Yes | Stored as industry |
| ISIN Code / ISIN | Yes | Required for Nifty & Bank Nifty |
| Weightage / Weight / Weight (%) | Yes (column) | Cell may be blank → stored as “not available”; invalid numbers error |

### Example header

```text
Company Name,Symbol,Industry,ISIN Code,Weightage
```

Typical source: NSE / Nifty Indices constituent downloads.

---

## Sensex constituents

`upload_type`: `sensex` → index `SENSEX`

### Required columns

| Column (aliases accepted) | Required | Notes |
|---------------------------|----------|-------|
| Constituents / Company Name / Company | Yes | BSE files often use **Constituents** |
| Symbol | Yes | |
| Macro-Economic Sector / Industry / Sector | Yes | |
| Weightage / Weight / Weight (%) | Yes (column) | Same rules as Nifty |
| ISIN | No | Sensex files often omit ISIN |

### Example header

```text
Constituents,Symbol,Macro-Economic Sector,Weightage
```

Typical source: BSE Indices constituents page.

---

## NSE event calendar (1-month list)

`POST /api/admin/upload/events` replaces **all** prior calendar rows.

### Required columns

| Column (aliases accepted) | Required | Notes |
|---------------------------|----------|-------|
| SYMBOL / Symbol | Yes* | *At least one of SYMBOL or COMPANY per row |
| COMPANY / Company Name / Company | Yes* | *At least one of SYMBOL or COMPANY per row |
| PURPOSE / Purpose / Event / Event Type | Yes | Classified into Quarterly Results, Board Meeting, Dividend, AGM, etc. |
| DATE / Date / Event Date / BM Date | Yes | Many formats accepted (`20-Jul-2026`, `YYYY-MM-DD`, …) |
| DETAILS / Details / Description | No | Helps classification |

### Example header

```text
SYMBOL,COMPANY,PURPOSE,DETAILS,DATE
```

Typical source: NSE Corporate Filings → Event Calendar export.

### How events appear in the app

`GET /api/events/{NIFTY|SENSEX|BANKNIFTY}` joins calendar rows to that index’s **current** constituents (by symbol, then normalized company name). Companies not in the uploaded constituent list for that index are skipped.

`days_remaining` is calendar days from **IST today** (not the server TZ). The Index Impact tile and Index Risk board only **show** rows with `days_remaining >= 0`; past dates stay in the API payload. The tile lists every upcoming type (results, board meetings, dividends, AGMs, …), not only results/board meetings. An empty list usually means the uploaded NSE calendar is already in the past — re-upload a current 1-month file.

---

## NSE holiday circular (Next Holiday tile)

`POST /api/admin/upload/holidays` stores the file in Mongo `nse_holidays`. **Years present in the file replace that year’s built-in dates**; other years keep the shipped 2025–2026 circular. Polling hours (`market_hours`) and the Next Holiday tile both use the merged list.

Until a file is uploaded, Next Holiday / market-closed days still come from the built-in list in `frontend/src/lib/holidays.js` and `backend/market_hours.py`.

This is **not** the same as:

- **Next Event** (RBI / FOMC / CPI / Budget) — curated in `frontend/src/lib/econCalendar.js`
- **Index Impact / Index Risk** — NSE corporate event calendar joined to constituents (`nse_events`)

### Required columns

| Column (aliases accepted) | Required | Notes |
|---------------------------|----------|-------|
| DATE / Date / Holiday Date | Yes | `YYYY-MM-DD`, `DD-MM-YYYY`, `DD/MM/YYYY`, Excel dates |
| NAME / Name / Holiday / Holiday Name | Yes | Shown on the Next Holiday tile |
| SESSION / Session / Type | No | Blank = full holiday. `muhurat` = special live session |
| OPEN / Open / Open IST | No | `HH:MM` IST. Default `13:30` when SESSION is muhurat |
| CLOSE / Close / Close IST | No | `HH:MM` IST. Default `14:45` when SESSION is muhurat |

### Example header

```text
DATE,NAME,SESSION,OPEN,CLOSE
2027-01-26,Republic Day,,,
2027-11-08,Diwali Laxmi Pujan,muhurat,13:30,19:15
```

Sample file in-repo: `backend/seed_data/nse_holidays.csv` (2026 circular). Copy that shape for 2027 when NSE publishes the next list.

Typical source: NSE → Resources → Exchange communication → Holidays.

---

### Freshness advisories (admin only)

| Category | Stale after | Why |
|----------|-------------|-----|
| NSE events | **15 days** | 1-month calendar drifts; refresh mid-cycle so Index Risk does not miss results |
| NSE holidays | **365 days** | Annual circular; upload when NSE publishes the next year |
| Nifty 50 / Bank Nifty / Sensex constituents | **30 days** | Reconstitution / weightage drift |

`GET /api/upload/meta` returns `age_days`, `stale_after_days`, and `stale` per key. The admin banner + toast nudge never shows to guests. Index Risk stamps highlight amber when stale.

## Admin UI tips

1. Use **Admin → Upload** in the desktop header (or Tools on tablet/phone).
2. Pick the upload type, open the source link if needed, choose the CSV/XLSX, then Save.
3. If the modal lists row errors, fix the file and re-upload — old data stays until a clean file succeeds.
4. After a successful upload, Index Risk shows **separate last-upload stamps** for Nifty 50, Bank Nifty, Sensex, and NSE events (`GET /api/upload/meta`). Each category keeps its own timestamp because files are often refreshed on different days.

### Per-category upload meta (Mongo `settings`)

| Category | Settings `_id` |
|----------|----------------|
| Nifty 50 | `constituents_meta_NIFTY` |
| Bank Nifty | `constituents_meta_BANKNIFTY` |
| Sensex | `constituents_meta_SENSEX` |
| NSE events | `nse_events_meta` |
| NSE holidays | `nse_holidays_meta` |

Each doc stores `uploaded_at`, `source_filename`, `row_count`.

---

## Seed data (local / bootstrap)

Optional samples under `backend/seed_data/` (`nifty50.xlsx`, `events.csv`, …) can be loaded via `seed_index_data.py` for development. Production should rely on admin uploads of the latest official files.
