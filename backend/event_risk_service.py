"""
event_risk_service.py

Backend logic for the Index Event Risk Dashboard feature:
 - Parse & validate uploaded constituent files (Nifty 50 / Bank Nifty / Sensex)
 - Parse & validate uploaded NSE Event Calendar
 - Normalise company names for robust joining
 - Classify PURPOSE text into a canonical event_type (Quarterly Results, Board
   Meeting, Dividend, AGM, Bonus, Split, Buyback, Rights Issue, Merger,
   Conference Call, Investor Meeting, Other)
 - Build joined event dataset per index

Everything here is pure logic + Mongo I/O. HTTP glue lives in server.py.
"""

from __future__ import annotations

import io
import re
import uuid
from datetime import datetime, timezone, timedelta, date
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

# ---------- Canonical index codes used inside the app ----------
INDEX_CODES = {
    "nifty50": "NIFTY",       # matches app's activeIndex NIFTY
    "banknifty": "BANKNIFTY",
    "sensex": "SENSEX",
}

# Reverse — activeIndex → constituent bucket
ACTIVE_INDEX_TO_BUCKET = {
    "NIFTY": "NIFTY",
    "BANKNIFTY": "BANKNIFTY",
    "SENSEX": "SENSEX",
}

# ---------- Event type priority (lower number = higher priority) ----------
EVENT_TYPE_ORDER = [
    "Quarterly Results",
    "Board Meeting",
    "Dividend",
    "AGM",
    "Bonus",
    "Split",
    "Buyback",
    "Rights Issue",
    "Merger",
    "Conference Call",
    "Investor Meeting",
    "Other",
]

_EVENT_PRIORITY_MAP = {t: i for i, t in enumerate(EVENT_TYPE_ORDER)}


# =====================================================================
# Company name normalisation
# =====================================================================
_COMPANY_SUFFIXES = [
    "LIMITED", "LIMITED.", "LTD.", "LTD",
    "PVT.", "PVT", "PRIVATE",
    "CO.", "CO",
    "CORPORATION", "CORP.", "CORP",
    "INC.", "INC",
    "PLC.", "PLC",
    "COMPANY",
]

def normalize_company_name(name: Any) -> str:
    """
    Normalise a company name so 'HDFC Bank Limited', 'HDFC BANK LTD.' and
    'HDFC Bank' all collapse to the same key.
    Keeps only A-Z0-9 chars, uppercased.
    """
    if name is None:
        return ""
    s = str(name).upper().strip()
    # Strip common corporate suffixes (repeatedly)
    changed = True
    while changed:
        changed = False
        for suf in _COMPANY_SUFFIXES:
            if s.endswith(" " + suf):
                s = s[: -(len(suf) + 1)].strip()
                changed = True
    # Remove anything that isn't A-Z or 0-9
    s = re.sub(r"[^A-Z0-9]+", "", s)
    return s


def normalize_symbol(sym: Any) -> str:
    if sym is None:
        return ""
    return re.sub(r"[^A-Z0-9]+", "", str(sym).upper().strip())


# =====================================================================
# Event type classifier
# =====================================================================
def classify_event_type(purpose: Any, details: Any = "") -> str:
    """
    Classify NSE 'PURPOSE' (and optionally 'DETAILS') into a canonical event
    type. The purpose column often has slashes like
    'Financial Results/Other business matters' → we treat as Quarterly Results.
    """
    txt = f"{purpose or ''} {details or ''}".upper()

    # Order matters — earlier checks take precedence.
    if "QUARTERLY RESULT" in txt or "FINANCIAL RESULT" in txt or "RESULTS" in txt:
        # Distinguish AGM vs Financial Results — AGM should win only if no
        # financial results mentioned.
        if "AGM" in txt and "RESULT" not in txt:
            return "AGM"
        return "Quarterly Results"
    if "BOARD MEETING" in txt:
        return "Board Meeting"
    if "DIVIDEND" in txt:
        return "Dividend"
    if "AGM" in txt or "ANNUAL GENERAL MEETING" in txt:
        return "AGM"
    if "BONUS" in txt:
        return "Bonus"
    if "SPLIT" in txt or "SUB-DIVISION" in txt or "SUB DIVISION" in txt:
        return "Split"
    if "BUY-BACK" in txt or "BUYBACK" in txt or "BUY BACK" in txt:
        return "Buyback"
    if "RIGHTS ISSUE" in txt or "RIGHTS OFFER" in txt:
        return "Rights Issue"
    if "MERGER" in txt or "AMALGAMATION" in txt or "DEMERGER" in txt:
        return "Merger"
    if "CONFERENCE CALL" in txt or "CONF CALL" in txt or "EARNINGS CALL" in txt:
        return "Conference Call"
    if "INVESTOR MEET" in txt or "ANALYST MEET" in txt:
        return "Investor Meeting"
    return "Other"


def event_priority(event_type: str) -> int:
    return _EVENT_PRIORITY_MAP.get(event_type, 99)


# =====================================================================
# Date parsing
# =====================================================================
_DATE_FMTS = [
    "%d-%b-%Y",       # 20-Jul-2026
    "%d-%b-%y",       # 20-Jul-26
    "%d-%B-%Y",
    "%d-%m-%Y",
    "%d/%m/%Y",
    "%Y-%m-%d",
    "%d %b %Y",
    "%d %B %Y",
]


def parse_event_date(raw: Any) -> Optional[date]:
    if raw is None:
        return None
    # If pandas already parsed it as Timestamp
    if isinstance(raw, pd.Timestamp):
        return raw.date()
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    s = str(raw).strip()
    if not s:
        return None
    for fmt in _DATE_FMTS:
        try:
            return datetime.strptime(s, fmt).date()
        except Exception:
            continue
    # Last-ditch: pandas parser
    try:
        return pd.to_datetime(s, dayfirst=True).date()
    except Exception:
        return None


# =====================================================================
# Weightage parsing
# =====================================================================
def parse_weightage(raw: Any) -> Optional[float]:
    """Return weightage as a float percentage (e.g. 11.49). None if missing.
    Handles inputs like '2.20 %', '2.20', or 0.022 (fraction)."""
    if raw is None:
        return None
    # Detect pandas NaN early
    try:
        if isinstance(raw, float) and (raw != raw):
            return None
    except Exception:
        pass
    # Numeric values: assume it's already a percentage number (e.g. 2.2 means 2.2%).
    # Only treat as a fraction when it's clearly a decimal fraction < 1 AND
    # not accompanied by a '%' sign (we can't know here, so we err on the side
    # of "it is already a percentage"). This matches the NSE constituent files
    # where 0.95 means 0.95% (NOT 95%).
    if isinstance(raw, (int, float)):
        try:
            v = float(raw)
        except Exception:
            return None
        if v != v:
            return None
        return round(v, 4)
    s = str(raw).strip()
    if not s or s.upper() in ("NA", "N/A", "-", "--", "NAN", "NONE"):
        return None
    had_pct = "%" in s
    s = s.replace("%", "").replace(",", "").strip()
    try:
        v = float(s)
        if v != v:
            return None
        # Only if the string had NO percent sign AND value <= 1 do we treat as
        # a fraction. When '%' was present, take the value at face value —
        # so '0.95 %' stays 0.95, and '11.49 %' stays 11.49.
        if not had_pct and 0 < v < 1:
            v = v * 100
        return round(v, 4)
    except Exception:
        return None


# =====================================================================
# File readers
# =====================================================================
def read_upload_bytes(file_bytes: bytes, filename: str) -> pd.DataFrame:
    """Read a CSV or XLSX file bytes into a DataFrame."""
    fname = (filename or "").lower()
    bio = io.BytesIO(file_bytes)
    try:
        if fname.endswith(".xlsx") or fname.endswith(".xls"):
            return pd.read_excel(bio, engine="openpyxl", dtype=str)
        # CSV — try utf-8 first, fall back to latin-1
        try:
            return pd.read_csv(bio, dtype=str)
        except UnicodeDecodeError:
            bio.seek(0)
            return pd.read_csv(bio, dtype=str, encoding="latin-1")
    except Exception as e:
        raise ValueError(f"Corrupted or unreadable file: {e}")


def _pick_col(df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
    """Return the actual DataFrame column that matches any candidate (case-insensitive, punctuation-insensitive)."""
    def norm(c: str) -> str:
        return re.sub(r"[^a-z0-9]+", "", c.lower())

    normalised = {norm(c): c for c in df.columns}
    for cand in candidates:
        key = norm(cand)
        if key in normalised:
            return normalised[key]
    return None


# =====================================================================
# Constituents validator + parser
# =====================================================================
def parse_constituents(
    df: pd.DataFrame, index_code: str
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """
    Returns (rows, errors). rows is empty if errors non-empty.
    index_code ∈ {'NIFTY','BANKNIFTY','SENSEX'}
    """
    errors: List[str] = []

    if df is None or df.empty:
        return [], ["File contains no data rows."]

    # Column detection — Sensex uses 'Constituents' instead of 'Company Name',
    # and 'Macro-Economic Sector' instead of 'Industry'; and has no ISIN.
    col_company = _pick_col(df, ["Company Name", "Constituents", "Company"])
    col_symbol = _pick_col(df, ["Symbol"])
    col_industry = _pick_col(df, ["Industry", "Macro-Economic Sector", "Sector"])
    col_isin = _pick_col(df, ["ISIN Code", "ISIN"])
    col_weightage = _pick_col(df, ["Weightage", "Weight", "Weight (%)"])

    missing: List[str] = []
    if not col_company:
        missing.append("Company Name")
    if not col_symbol:
        missing.append("Symbol")
    if not col_industry:
        missing.append("Industry")
    if not col_weightage:
        missing.append("Weightage")
    # ISIN is required only for NIFTY / BANKNIFTY. Sensex has none.
    if index_code in ("NIFTY", "BANKNIFTY") and not col_isin:
        missing.append("ISIN Code")

    if missing:
        errors.append(
            f"Missing required column(s): {', '.join(missing)}. "
            f"Found columns: {list(df.columns)}"
        )
        return [], errors

    seen_symbols = set()
    rows: List[Dict[str, Any]] = []
    for i, r in df.iterrows():
        excel_row = i + 2  # header is row 1
        company = (r.get(col_company) or "").strip() if pd.notna(r.get(col_company)) else ""
        symbol = (r.get(col_symbol) or "").strip() if pd.notna(r.get(col_symbol)) else ""
        industry = (r.get(col_industry) or "").strip() if pd.notna(r.get(col_industry)) else ""
        isin = ""
        if col_isin:
            isin = (r.get(col_isin) or "").strip() if pd.notna(r.get(col_isin)) else ""
        weightage_raw = r.get(col_weightage)

        # Skip fully-empty rows silently.
        if not company and not symbol and not industry and not weightage_raw:
            continue

        if not company:
            errors.append(f"Row {excel_row}: Company Name is missing.")
        if not symbol:
            errors.append(f"Row {excel_row}: Symbol is missing.")

        w = parse_weightage(weightage_raw)
        # Missing weightage is ALLOWED (spec: "Show Weightage as Not Available").
        # Only flag as invalid when the raw value is present but unparseable AND
        # clearly not just a missing marker.
        if (
            weightage_raw is not None
            and w is None
            and str(weightage_raw).strip().upper() not in ("", "NA", "N/A", "-", "--", "NAN", "NONE")
        ):
            errors.append(
                f"Row {excel_row}: Weightage is invalid ('{weightage_raw}')."
            )

        sym_norm = normalize_symbol(symbol)
        if sym_norm and sym_norm in seen_symbols:
            errors.append(f"Row {excel_row}: Duplicate Symbol '{symbol}'.")
        elif sym_norm:
            seen_symbols.add(sym_norm)

        rows.append({
            "id": str(uuid.uuid4()),
            "index": index_code,
            "company_name": company,
            "normalized_name": normalize_company_name(company),
            "symbol": sym_norm,
            "symbol_raw": symbol,
            "industry": industry,
            "isin": isin or None,
            "weightage": w,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

    if errors:
        return [], errors
    if not rows:
        return [], ["No valid rows found after parsing."]
    return rows, []


# =====================================================================
# Events validator + parser
# =====================================================================
def parse_events(df: pd.DataFrame) -> Tuple[List[Dict[str, Any]], List[str]]:
    errors: List[str] = []
    if df is None or df.empty:
        return [], ["File contains no data rows."]

    col_symbol = _pick_col(df, ["SYMBOL", "Symbol"])
    col_company = _pick_col(df, ["COMPANY", "Company Name", "Company"])
    col_purpose = _pick_col(df, ["PURPOSE", "Purpose", "Event", "Event Type"])
    col_details = _pick_col(df, ["DETAILS", "Details", "Description"])
    col_date = _pick_col(df, ["DATE", "Date", "Event Date", "BM Date"])

    missing: List[str] = []
    if not col_symbol:
        missing.append("SYMBOL")
    if not col_company:
        missing.append("COMPANY")
    if not col_purpose:
        missing.append("PURPOSE")
    if not col_date:
        missing.append("DATE")

    if missing:
        errors.append(
            f"Missing required column(s): {', '.join(missing)}. "
            f"Found columns: {list(df.columns)}"
        )
        return [], errors

    today = date.today()
    rows: List[Dict[str, Any]] = []
    for i, r in df.iterrows():
        excel_row = i + 2
        symbol = (r.get(col_symbol) or "").strip() if pd.notna(r.get(col_symbol)) else ""
        company = (r.get(col_company) or "").strip() if pd.notna(r.get(col_company)) else ""
        purpose = (r.get(col_purpose) or "").strip() if pd.notna(r.get(col_purpose)) else ""
        details = ""
        if col_details:
            details = (r.get(col_details) or "").strip() if pd.notna(r.get(col_details)) else ""
        date_raw = r.get(col_date)

        # Skip fully empty rows silently
        if not symbol and not company and not purpose and not date_raw:
            continue

        if not symbol and not company:
            errors.append(f"Row {excel_row}: Both SYMBOL and COMPANY are missing.")
            continue
        if not purpose:
            errors.append(f"Row {excel_row}: PURPOSE (event type) is missing.")

        ev_date = parse_event_date(date_raw)
        if not ev_date:
            errors.append(f"Row {excel_row}: Invalid Event Date ('{date_raw}').")
            continue

        event_type = classify_event_type(purpose, details)

        rows.append({
            "id": str(uuid.uuid4()),
            "symbol": normalize_symbol(symbol),
            "symbol_raw": symbol,
            "company_name": company,
            "normalized_name": normalize_company_name(company),
            "purpose_raw": purpose,
            "details": details,
            "event_type": event_type,
            "event_date": ev_date.isoformat(),
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
        })

    if errors:
        return [], errors
    if not rows:
        return [], ["No valid rows found after parsing."]
    return rows, []


# =====================================================================
# Joining logic — events for the given index
# =====================================================================
def build_index_event_dataset(
    constituents: List[Dict[str, Any]],
    events: List[Dict[str, Any]],
    index_code: str,
) -> List[Dict[str, Any]]:
    """
    Join events onto constituents by symbol first, then normalized company name.
    Skip events whose company is NOT in the index's constituent list.

    Returns a list sorted by:
      1. event priority (Quarterly Results > Board Meeting > ...)
      2. days_remaining ascending
      3. weightage descending
    """
    # Build lookup by symbol and by normalized name (only for the given index).
    by_symbol = {c["symbol"]: c for c in constituents if c.get("symbol")}
    by_name = {c["normalized_name"]: c for c in constituents if c.get("normalized_name")}

    today = date.today()
    out: List[Dict[str, Any]] = []

    for ev in events:
        match = None
        sym = ev.get("symbol") or ""
        if sym and sym in by_symbol:
            match = by_symbol[sym]
        elif ev.get("normalized_name") and ev["normalized_name"] in by_name:
            match = by_name[ev["normalized_name"]]

        if not match:
            # Company not part of this index — skip.
            continue

        try:
            ev_dt = datetime.fromisoformat(ev["event_date"]).date()
        except Exception:
            continue
        days_remaining = (ev_dt - today).days

        out.append({
            "id": ev["id"],
            "company_name": match["company_name"],
            "symbol": match["symbol"],
            "industry": match.get("industry") or None,
            "isin": match.get("isin"),
            "weightage": match.get("weightage"),
            "index": index_code,
            "event_type": ev["event_type"],
            "purpose_raw": ev["purpose_raw"],
            "details": ev.get("details") or "",
            "event_date": ev["event_date"],
            "days_remaining": days_remaining,
        })

    out.sort(
        key=lambda r: (
            event_priority(r["event_type"]),
            r["days_remaining"] if r["days_remaining"] >= 0 else 9999,
            -(r["weightage"] or 0.0),
        )
    )
    return out


# =====================================================================
# Mongo helpers (used by server.py routes)
# =====================================================================
async def save_constituents(db, index_code: str, rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    # Replace previous entries for that index — spec: "Replace the previous
    # uploaded file for that category".
    await db.index_constituents.delete_many({"index": index_code})
    if rows:
        await db.index_constituents.insert_many(rows)
    return {
        "ok": True,
        "index": index_code,
        "rows_saved": len(rows),
    }


async def save_events(db, rows: List[Dict[str, Any]], source_filename: str = "") -> Dict[str, Any]:
    await db.nse_events.delete_many({})
    if rows:
        await db.nse_events.insert_many(rows)
    await db.settings.update_one(
        {"_id": "nse_events_meta"},
        {"$set": {
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
            "source_filename": source_filename,
            "row_count": len(rows),
        }},
        upsert=True,
    )
    return {"ok": True, "rows_saved": len(rows)}


async def fetch_events_for_index(db, index_code: str) -> List[Dict[str, Any]]:
    constituents = await db.index_constituents.find(
        {"index": index_code}, {"_id": 0}
    ).to_list(length=500)
    events = await db.nse_events.find({}, {"_id": 0}).to_list(length=5000)
    return build_index_event_dataset(constituents, events, index_code)