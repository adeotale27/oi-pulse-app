"""NSE cash/F&O holiday circular upload.

Admin drops a CSV/XLSX in Upload. On success the file replaces that calendar
year in Mongo (`nse_holidays`). Runtime hours merge uploaded years over the
built-in 2025–2026 list in market_hours.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from event_risk_service import _pick_col, parse_event_date, read_upload_bytes
from market_hours import apply_uploaded_holidays, now_ist


META_ID = "nse_holidays_meta"
COLLECTION = "nse_holidays"
STALE_AFTER_DAYS = 365


def _cell(row, col) -> str:
    import pandas as pd
    if not col:
        return ""
    raw = row.get(col)
    if raw is None or (isinstance(raw, float) and raw != raw) or pd.isna(raw):
        return ""
    return str(raw).strip()


def _parse_hm(raw: str) -> Optional[str]:
    s = (raw or "").strip()
    if not s:
        return None
    parts = s.replace(".", ":").split(":")
    try:
        h = int(parts[0])
        m = int(parts[1]) if len(parts) > 1 else 0
    except Exception:
        return None
    if not (0 <= h <= 23 and 0 <= m <= 59):
        return None
    return f"{h:02d}:{m:02d}"


def parse_holidays(df) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Return (rows, errors). rows is empty when errors is non-empty."""
    import pandas as pd

    errors: List[str] = []
    if df is None or df.empty:
        return [], ["File contains no data rows."]

    col_date = _pick_col(df, ["DATE", "Date", "Holiday Date"])
    col_name = _pick_col(df, ["NAME", "Name", "Holiday", "Holiday Name", "Description"])
    col_session = _pick_col(df, ["SESSION", "Session", "Type"])
    col_open = _pick_col(df, ["OPEN", "Open", "Open IST", "Session Open"])
    col_close = _pick_col(df, ["CLOSE", "Close", "Close IST", "Session Close"])

    missing: List[str] = []
    if not col_date:
        missing.append("DATE")
    if not col_name:
        missing.append("NAME")
    if missing:
        errors.append(
            f"Missing required column(s): {', '.join(missing)}. "
            f"Found columns: {list(df.columns)}"
        )
        return [], errors

    rows: List[Dict[str, Any]] = []
    seen = set()
    for i, r in df.iterrows():
        excel_row = i + 2
        date_raw = r.get(col_date)
        name = _cell(r, col_name)
        session_raw = _cell(r, col_session).lower()
        open_raw = _cell(r, col_open)
        close_raw = _cell(r, col_close)

        empty_date = date_raw is None or (isinstance(date_raw, float) and date_raw != date_raw) or pd.isna(date_raw) or str(date_raw).strip() == ""
        if empty_date and not name and not session_raw:
            continue

        hol_date = parse_event_date(date_raw)
        if not hol_date:
            errors.append(f"Row {excel_row}: Invalid DATE ('{date_raw}'). Use YYYY-MM-DD or DD-MM-YYYY.")
            continue
        if not name:
            errors.append(f"Row {excel_row}: NAME is missing.")
            continue

        iso = hol_date.isoformat()
        if iso in seen:
            errors.append(f"Row {excel_row}: Duplicate DATE '{iso}'.")
            continue
        seen.add(iso)

        session = None
        if session_raw in ("muhurat", "muhurat trading", "special", "special session"):
            session = "muhurat"
        elif session_raw and session_raw not in ("", "closed", "holiday", "full"):
            errors.append(
                f"Row {excel_row}: SESSION '{session_raw}' is not recognised. "
                "Use blank (full holiday) or muhurat."
            )
            continue

        open_hm = _parse_hm(open_raw)
        close_hm = _parse_hm(close_raw)
        if session == "muhurat":
            if open_raw and not open_hm:
                errors.append(f"Row {excel_row}: OPEN must be HH:MM IST (got '{open_raw}').")
                continue
            if close_raw and not close_hm:
                errors.append(f"Row {excel_row}: CLOSE must be HH:MM IST (got '{close_raw}').")
                continue
            open_hm = open_hm or "13:30"
            close_hm = close_hm or "14:45"
        else:
            open_hm = None
            close_hm = None

        rows.append({
            "id": str(uuid.uuid4()),
            "date": iso,
            "name": name,
            "session": session,
            "open": open_hm,
            "close": close_hm,
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
        })

    if errors:
        return [], errors
    if not rows:
        return [], ["No valid rows found after parsing."]
    rows.sort(key=lambda r: r["date"])
    return rows, []


async def save_holidays(db, rows: List[Dict[str, Any]], source_filename: str = "") -> Dict[str, Any]:
    await db.nse_holidays.delete_many({})
    if rows:
        await db.nse_holidays.insert_many(rows)
    uploaded_at = datetime.now(timezone.utc).isoformat()
    await db.settings.update_one(
        {"_id": META_ID},
        {"$set": {
            "uploaded_at": uploaded_at,
            "source_filename": source_filename,
            "row_count": len(rows),
        }},
        upsert=True,
    )
    apply_uploaded_holidays(rows)
    return {"ok": True, "rows_saved": len(rows), "uploaded_at": uploaded_at}


async def fetch_holiday_rows(db) -> List[Dict[str, Any]]:
    docs = await db.nse_holidays.find({}, {"_id": 0}).sort("date", 1).to_list(length=500)
    return docs or []


async def fetch_holidays_payload(db) -> Dict[str, Any]:
    rows = await fetch_holiday_rows(db)
    meta = await db.settings.find_one({"_id": META_ID}) or {}
    apply_uploaded_holidays(rows or None)
    return {
        "source": "upload" if rows else "builtin",
        "holidays": rows,
        "uploaded_at": meta.get("uploaded_at"),
        "source_filename": meta.get("source_filename"),
        "row_count": meta.get("row_count") if rows else 0,
        "today_ist": now_ist().date().isoformat(),
    }


async def load_uploaded_holidays(db) -> None:
    """Apply Mongo overlay at process start. Empty collection → built-in list."""
    try:
        rows = await fetch_holiday_rows(db)
        apply_uploaded_holidays(rows or None)
    except Exception:
        apply_uploaded_holidays(None)
