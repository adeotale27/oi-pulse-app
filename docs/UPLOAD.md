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
| Event upload meta | `settings` (`_id: "nse_events_meta"`) | Upserts `uploaded_at`, `source_filename`, `row_count` |

APIs:

- `POST /api/admin/upload/constituents` — form fields: `upload_type` ∈ `nifty50` \| `banknifty` \| `sensex`, plus `file`
- `POST /api/admin/upload/events` — form field: `file`
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

---

## Admin UI tips

1. Use **Upload** in the header (admin Tools on tablet/phone).
2. Pick the upload type, open the source link if needed, choose the CSV/XLSX, then Save.
3. If the modal lists row errors, fix the file and re-upload — old data stays until a clean file succeeds.
4. After a successful events upload, Index Risk / market-impact badges refresh from the new calendar.

---

## Seed data (local / bootstrap)

Optional samples under `backend/seed_data/` (`nifty50.xlsx`, `events.csv`, …) can be loaded via `seed_index_data.py` for development. Production should rely on admin uploads of the latest official files.
