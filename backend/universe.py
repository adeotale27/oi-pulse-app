"""Instrument universe — one catalog for desk indices and future underlyings.

Desk ids (NIFTY / SENSEX / BANKNIFTY) stay on the OI board by default.
MCX majors (CRUDEOIL, GOLD, SILVER, NATURALGAS) are pollable: ATM from the
nearest MCX FUT. Each name has a ``session_group`` so OI polls only in that
contract's hours (non-agri 09:00–23:30 IST in US DST, 23:55 otherwise).
They are **not** auto-enabled — Admin → Index management ticks them on.

Keep this file aligned with ``frontend/src/lib/universe.js``.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple

# Desk OI board today (NFO / BFO cash-session indices).
DESK_IDS: Tuple[str, ...] = ("NIFTY", "SENSEX", "BANKNIFTY")

# Kite `name` for the four major MCX option chains (not minis).
MCX_MAJOR_IDS: Tuple[str, ...] = ("CRUDEOIL", "GOLD", "SILVER", "NATURALGAS")

# Aliases that settings / uploads / humans might type.
ALIASES: Dict[str, str] = {
    "BANK": "BANKNIFTY",
    "BNF": "BANKNIFTY",
    "NIFTY50": "NIFTY",
    "NIFTY 50": "NIFTY",
    "CRUDE": "CRUDEOIL",
    "CL": "CRUDEOIL",
    "NG": "NATURALGAS",
    "NATGAS": "NATURALGAS",
}

# Extra F&O names that appear on a Kite book even when they are not on the OI desk.
BOOK_ONLY_NAMES: Tuple[str, ...] = (
    "FINNIFTY",
    "MIDCPNIFTY",
    "BANKEX",
    "GOLDM",
    "SILVERM",
    "GOLDPETAL",
    "NATGASMINI",
    "CRUDEOILM",
)

_CATALOG: Tuple[Dict[str, Any], ...] = (
    {
        "id": "NIFTY",
        "label": "NIFTY",
        "short": "NIFTY",
        "kite_name": "NIFTY",
        "quote_symbol": "NSE:NIFTY 50",
        "quote_kind": "index",
        "exchange": "NFO",
        "segment": "NFO-OPT",
        "step": 50,
        "strikes_around_atm": 15,
        "calendar": "nse",
        "session_group": "nse",
        "pollable": True,
        "dot": "sky",
    },
    {
        "id": "SENSEX",
        "label": "SENSEX",
        "short": "SENSEX",
        "kite_name": "SENSEX",
        "quote_symbol": "BSE:SENSEX",
        "quote_kind": "index",
        "exchange": "BFO",
        "segment": "BFO-OPT",
        "step": 100,
        "strikes_around_atm": 15,
        "calendar": "nse",
        "session_group": "nse",
        "pollable": True,
        "dot": "amber",
    },
    {
        "id": "BANKNIFTY",
        "label": "BANKNIFTY",
        "short": "BNF",
        "kite_name": "BANKNIFTY",
        "quote_symbol": "NSE:NIFTY BANK",
        "quote_kind": "index",
        "exchange": "NFO",
        "segment": "NFO-OPT",
        "step": 100,
        "strikes_around_atm": 15,
        "calendar": "nse",
        "session_group": "nse",
        "pollable": True,
        "dot": "emerald",
    },
    # Kite `name` on MCX (majors, not minis). ATM = nearest FUT last_price.
    {
        "id": "CRUDEOIL",
        "label": "Crude oil",
        "short": "CRUDE",
        "kite_name": "CRUDEOIL",
        "quote_symbol": None,
        "quote_kind": "mcx_fut",
        "exchange": "MCX",
        "segment": "MCX-OPT",
        "step": 50,
        "strikes_around_atm": 12,
        "calendar": "mcx",
        "session_group": "mcx_non_agri",
        "pollable": True,
        "dot": "slate",
        "notes": "Kite name CRUDEOIL (not CRUDEOILM). Cash-settled. ATM from nearest MCX FUT. Non-agri hours 09:00–23:30 IST (US DST) / 23:55 (US standard).",
    },
    {
        "id": "GOLD",
        "label": "Gold",
        "short": "GOLD",
        "kite_name": "GOLD",
        "quote_symbol": None,
        "quote_kind": "mcx_fut",
        "exchange": "MCX",
        "segment": "MCX-OPT",
        "step": 100,
        "strikes_around_atm": 12,
        "calendar": "mcx",
        "session_group": "mcx_non_agri",
        "pollable": True,
        "dot": "amber",
        "notes": "Kite name GOLD (not GOLDM / GOLDPETAL). Physical FUT — dump drops the contract at tender. ATM from nearest remaining FUT. Same non-agri MCX clock as Crude.",
    },
    {
        "id": "SILVER",
        "label": "Silver",
        "short": "SILVER",
        "kite_name": "SILVER",
        "quote_symbol": None,
        "quote_kind": "mcx_fut",
        "exchange": "MCX",
        "segment": "MCX-OPT",
        "step": 250,
        "strikes_around_atm": 12,
        "calendar": "mcx",
        "session_group": "mcx_non_agri",
        "pollable": True,
        "dot": "slate",
        "notes": "Kite name SILVER (not SILVERM / SILVERMIC). Physical FUT. ATM from nearest MCX FUT. Non-agri MCX clock.",
    },
    {
        "id": "NATURALGAS",
        "label": "Natural gas",
        "short": "NG",
        "kite_name": "NATURALGAS",
        "quote_symbol": None,
        "quote_kind": "mcx_fut",
        "exchange": "MCX",
        "segment": "MCX-OPT",
        "step": 1,
        "strikes_around_atm": 12,
        "calendar": "mcx",
        "session_group": "mcx_non_agri",
        "pollable": True,
        "dot": "sky",
        "notes": "Kite name NATURALGAS (not NATGASMINI). Strikes are often 3-digit. ATM from nearest MCX FUT. Non-agri MCX clock.",
    },
)

_BY_ID: Dict[str, Dict[str, Any]] = {row["id"]: row for row in _CATALOG}


def normalize_id(raw: Any) -> Optional[str]:
    if raw is None:
        return None
    s = str(raw).strip().upper().replace(" ", "")
    if not s:
        return None
    s = ALIASES.get(s, s)
    if s in _BY_ID:
        return s
    return s


def get(uid: str) -> Optional[Dict[str, Any]]:
    key = normalize_id(uid)
    if key is None:
        return None
    return _BY_ID.get(key)


def is_desk(uid: str) -> bool:
    key = normalize_id(uid)
    return key in DESK_IDS


def is_pollable(uid: str) -> bool:
    row = get(uid)
    return bool(row and row.get("pollable"))


def desk_index_config() -> Dict[str, Dict[str, Any]]:
    """Shape consumed by oi_service / FastAPI (unchanged keys for the live desk)."""
    out: Dict[str, Dict[str, Any]] = {}
    for uid in DESK_IDS:
        row = _BY_ID[uid]
        out[uid] = {
            "quote_symbol": row["quote_symbol"],
            "quote_kind": row.get("quote_kind") or "index",
            "name": row["kite_name"],
            "step": row["step"],
            "segment": row["segment"],
            "strikes_around_atm": row["strikes_around_atm"],
            "calendar": row.get("calendar") or "nse",
            "session_group": row.get("session_group") or "nse",
        }
    return out


def catalog_public() -> List[Dict[str, Any]]:
    """Safe JSON for /config — no secrets, includes future MCX rows."""
    keys = (
        "id", "label", "short", "kite_name", "quote_symbol", "quote_kind",
        "exchange", "segment", "step", "calendar", "session_group", "pollable",
    )
    return [{k: row.get(k) for k in keys} for row in _CATALOG]


def order_desk(ids: List[str]) -> List[str]:
    wanted = []
    seen = set()
    for raw in ids or []:
        key = normalize_id(raw)
        if key in DESK_IDS and key not in seen and is_pollable(key):
            seen.add(key)
            wanted.append(key)
    return [i for i in DESK_IDS if i in seen]


def fno_name_alternation() -> str:
    """Regex alternation, longest names first (BANKNIFTY before NIFTY)."""
    names = list(DESK_IDS) + [r["id"] for r in _CATALOG if r["id"] not in DESK_IDS]
    names.extend(BOOK_ONLY_NAMES)
    uniq = []
    seen = set()
    for n in names:
        if n not in seen:
            seen.add(n)
            uniq.append(n)
    uniq.sort(key=len, reverse=True)
    return "|".join(uniq)


def expiry_date(raw: Any) -> Optional[date]:
    if raw is None or raw == "":
        return None
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    s = str(raw).strip()[:10]
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def ist_today() -> date:
    from datetime import timezone, timedelta
    ist = timezone(timedelta(hours=5, minutes=30))
    return datetime.now(ist).date()


def nearest_fut_quote_symbol(rows: Iterable[Dict[str, Any]], name: str, today: Optional[date] = None) -> Optional[str]:
    """Return ``EXCHANGE:TRADINGSYMBOL`` for the nearest unexpired FUT.

    Falls back to the latest expired FUT still in the dump (Gold tender).
    """
    key = normalize_id(name) or str(name or "").strip().upper()
    today = today or ist_today()
    live: List[Tuple[date, str]] = []
    expired: List[Tuple[date, str]] = []
    for row in rows or []:
        if str(row.get("name") or "").strip().upper() != key:
            continue
        if str(row.get("instrument_type") or "").upper() != "FUT":
            continue
        ts = str(row.get("tradingsymbol") or "").strip()
        if not ts:
            continue
        exch = str(row.get("exchange") or "MCX").strip().upper() or "MCX"
        exp = expiry_date(row.get("expiry"))
        if not exp:
            continue
        quote = f"{exch}:{ts}"
        if exp >= today:
            live.append((exp, quote))
        else:
            expired.append((exp, quote))
    if live:
        live.sort(key=lambda x: x[0])
        return live[0][1]
    if expired:
        expired.sort(key=lambda x: x[0], reverse=True)
        return expired[0][1]
    return None


def is_mcx_cfg(cfg: Optional[Dict[str, Any]]) -> bool:
    if not cfg:
        return False
    if cfg.get("quote_kind") == "mcx_fut":
        return True
    if str(cfg.get("calendar") or "").lower() == "mcx":
        return True
    group = str(cfg.get("session_group") or "").lower()
    if group.startswith("mcx"):
        return True
    return str(cfg.get("segment") or "").upper().startswith("MCX")


def session_group_for(uid: str, cfg: Optional[Dict[str, Any]] = None) -> str:
    """Poll-hours bucket for an underlying.

    nse — index / stock F&O (admin NSE hours, close 15:40).
    mcx_non_agri — GOLD, SILVER, CRUDEOIL, NATURALGAS, base metals (09:00–23:30/23:55).
    mcx_select_agri — Cotton, CPO, Kapas (09:00–21:00).
    mcx_agri — remaining agri (09:00–17:00).
    """
    row = get(uid) or {}
    for src in (row, cfg or {}):
        g = str(src.get("session_group") or "").strip().lower()
        if g:
            return g
    if is_mcx_cfg(cfg) or is_mcx_cfg(row):
        return "mcx_non_agri"
    return "nse"


def match_symbol_prefix(tradingsymbol: str) -> Optional[str]:
    """Longest Kite name prefix on a tradingsymbol (BANKNIFTY before NIFTY)."""
    ts = str(tradingsymbol or "").upper().replace(" ", "")
    if not ts:
        return None
    for name in fno_name_alternation().split("|"):
        if name and ts.startswith(name):
            if name == "NIFTY" and ts.startswith("NIFTYBANK"):
                return "BANKNIFTY"
            return name
    return None
