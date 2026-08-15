"""Instrument universe — one catalog for desk indices and future underlyings.

The live OI poller only accepts **desk** (pollable) ids. Catalog entries with
``pollable=False`` are documentation + future wiring (MCX crude / metals / gas).
Do not add a catalog id to ``enabled_indices`` until its session calendar and
spot quote path are implemented.

Keep this file aligned with ``frontend/src/lib/universe.js``.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

# Desk OI board today (NFO / BFO cash-session indices).
DESK_IDS: Tuple[str, ...] = ("NIFTY", "SENSEX", "BANKNIFTY")

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
        "pollable": True,
        "dot": "emerald",
    },
    # --- MCX (catalog only until session hours + nearest-FUT spot are wired) ---
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
        "pollable": False,
        "dot": "slate",
        "notes": "No Kite spot. ATM from nearest MCX FUT. Options often expire before FUT. Hours ~09:00–23:30 IST.",
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
        "pollable": False,
        "dot": "slate",
        "notes": "Physical FUT (Zerodha stops before tender). Options CE/PE on MCX-OPT. No Kite spot.",
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
        "pollable": False,
        "dot": "slate",
        "notes": "Physical FUT. Same Kite quote.oi path as index options once FUT spot is resolved.",
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
        "pollable": False,
        "dot": "slate",
        "notes": "Strikes can be 3-digit; F&O symbol parser is still 4–6 digit index-style.",
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
            "name": row["kite_name"],
            "step": row["step"],
            "segment": row["segment"],
            "strikes_around_atm": row["strikes_around_atm"],
        }
    return out


def catalog_public() -> List[Dict[str, Any]]:
    """Safe JSON for /config — no secrets, includes future MCX rows."""
    keys = (
        "id", "label", "short", "kite_name", "quote_symbol", "quote_kind",
        "exchange", "segment", "step", "calendar", "pollable",
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
