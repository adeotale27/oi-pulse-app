"""Index registry + Kite underlying discovery.

Desk ids (NIFTY / SENSEX / BANKNIFTY) bootstrap into Mongo `index_registry`.
Admin search uses a compact `kite_underlyings` cache built from the daily
instruments dump — not a hardcoded list of every index.

Live OI still goes through oi_service.INDEX_CONFIG + OITracker (one pipeline).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from universe import DESK_IDS, MCX_MAJOR_IDS, desk_index_config, get as universe_get, nearest_fut_quote_symbol

logger = logging.getLogger(__name__)

OPT_SEGMENTS = {"NFO-OPT", "BFO-OPT", "MCX-OPT", "CDS-OPT"}
FUT_TYPES = {"FUT"}
OPT_TYPES = {"CE", "PE"}

# Well-known index quotes when the dump's cash symbol differs from F&O `name`.
QUOTE_HINTS = {
    "NIFTY": "NSE:NIFTY 50",
    "SENSEX": "BSE:SENSEX",
    "BANKNIFTY": "NSE:NIFTY BANK",
    "FINNIFTY": "NSE:NIFTY FIN SERVICE",
    "MIDCPNIFTY": "NSE:NIFTY MID SELECT",
    "BANKEX": "BSE:BANKEX",
}


def infer_step(strikes: Iterable[Any], fallback: int = 50) -> int:
    xs = sorted({int(s) for s in strikes if s not in (None, "") and str(s).replace(".", "", 1).isdigit() and float(s) > 0})
    diffs = [xs[i + 1] - xs[i] for i in range(len(xs) - 1) if xs[i + 1] > xs[i]]
    if not diffs:
        return fallback
    diffs.sort()
    step = diffs[len(diffs) // 2]
    return int(step) if step > 0 else fallback


def _row_name(row: Dict[str, Any]) -> str:
    return str(row.get("name") or "").strip().upper()


def summarize_underlyings(rows: List[Dict[str, Any]], q: str = "", limit: int = 40) -> List[Dict[str, Any]]:
    """Group instrument dump rows by F&O `name`. Search is substring on name."""
    needle = str(q or "").strip().upper()
    cap = None if limit is None else max(1, min(int(limit or 40), 80))
    buckets: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        name = _row_name(row)
        if not name or name in ("", "NAN"):
            continue
        itype = str(row.get("instrument_type") or "").upper()
        seg = str(row.get("segment") or "").upper()
        exch = str(row.get("exchange") or "").upper()
        is_opt = itype in OPT_TYPES or seg in OPT_SEGMENTS
        is_fut = itype in FUT_TYPES
        if not is_opt and not is_fut:
            continue
        b = buckets.setdefault(
            name,
            {
                "id": name,
                "name": name,
                "exchanges": set(),
                "segments": set(),
                "has_ce": False,
                "has_pe": False,
                "has_fut": False,
                "strikes": set(),
                "expiries": set(),
                "sample_opt": None,
                "sample_fut": None,
            },
        )
        if exch:
            b["exchanges"].add(exch)
        if seg:
            b["segments"].add(seg)
        if itype == "CE":
            b["has_ce"] = True
            b["sample_opt"] = b["sample_opt"] or row
        elif itype == "PE":
            b["has_pe"] = True
            b["sample_opt"] = b["sample_opt"] or row
        elif is_fut:
            b["has_fut"] = True
            b["sample_fut"] = b["sample_fut"] or row
        if row.get("strike") not in (None, "", 0, 0.0):
            try:
                b["strikes"].add(float(row["strike"]))
            except (TypeError, ValueError):
                pass
        exp = row.get("expiry")
        if exp:
            b["expiries"].add(str(exp)[:10])

    out = []
    for name, b in buckets.items():
        has_opt = b["has_ce"] and b["has_pe"]
        caps = capabilities_from_flags(
            live_price=True,
            futures=b["has_fut"],
            options=has_opt,
        )
        opt_seg = next((s for s in b["segments"] if s in OPT_SEGMENTS), None)
        if not opt_seg and b["segments"]:
            opt_seg = sorted(b["segments"])[0]
        out.append(
            {
                "id": name,
                "name": name,
                "exchange": sorted(b["exchanges"])[0] if b["exchanges"] else None,
                "exchanges": sorted(b["exchanges"]),
                "segment": opt_seg,
                "capabilities": caps,
                "expiry_count": len(b["expiries"]),
                "strike_count": len(b["strikes"]),
            }
        )
    out.sort(key=lambda r: (0 if r["id"] in DESK_IDS else 1, r["id"]))
    if needle:
        out = [
            r
            for r in out
            if needle in r["id"] or needle in (r.get("exchange") or "") or needle in str(r.get("segment") or "")
        ]
    return out if cap is None else out[:cap]


def capabilities_from_flags(*, live_price: bool, futures: bool, options: bool) -> Dict[str, bool]:
    oi = bool(options)
    return {
        "livePrice": bool(live_price),
        "futures": bool(futures),
        "options": bool(options),
        "optionOI": oi,
        "futuresOI": bool(futures),
        "straddle": oi,
        "oiChange": oi,
        "strikeTable": oi,
        "alerts": oi,
        "buildUp": oi,
    }


def inspect_underlying(rows: List[Dict[str, Any]], name: str) -> Dict[str, Any]:
    key = str(name or "").strip().upper()
    related = [r for r in rows if _row_name(r) == key]
    ce = [r for r in related if str(r.get("instrument_type") or "").upper() == "CE"]
    pe = [r for r in related if str(r.get("instrument_type") or "").upper() == "PE"]
    fut = [r for r in related if str(r.get("instrument_type") or "").upper() == "FUT"]
    strikes = []
    for r in ce + pe:
        try:
            s = float(r.get("strike") or 0)
            if s > 0:
                strikes.append(s)
        except (TypeError, ValueError):
            pass
    expiries = sorted({str(r.get("expiry") or "")[:10] for r in ce + pe + fut if r.get("expiry")})
    opt_seg = None
    exch = None
    for r in ce or pe or fut:
        seg = str(r.get("segment") or "")
        if str(r.get("instrument_type") or "").upper() in OPT_TYPES and seg:
            opt_seg = seg
        exch = str(r.get("exchange") or exch or "")
        if opt_seg:
            break
    urow = universe_get(key)
    step = int(urow["step"]) if urow and urow.get("step") else infer_step(strikes, 50)
    quote_kind = (urow or {}).get("quote_kind") or "index"
    quote = (urow or {}).get("quote_symbol") or QUOTE_HINTS.get(key)
    if quote_kind == "mcx_fut" or (not quote and fut):
        live_fut = nearest_fut_quote_symbol(related, key)
        if live_fut:
            quote = live_fut
            quote_kind = "mcx_fut"
        elif not quote and fut:
            f0 = fut[0]
            quote = f"{f0.get('exchange')}:{f0.get('tradingsymbol')}"
            quote_kind = "mcx_fut"
    has_opt = bool(ce) and bool(pe)
    caps = capabilities_from_flags(live_price=bool(quote), futures=bool(fut), options=has_opt)
    cfg = None
    if has_opt and quote:
        cfg = {
            "quote_symbol": quote,
            "quote_kind": quote_kind,
            "name": key,
            "step": step,
            "segment": opt_seg or (urow or {}).get("segment") or "NFO-OPT",
            "strikes_around_atm": int((urow or {}).get("strikes_around_atm") or 15),
            "calendar": (urow or {}).get("calendar") or ("mcx" if quote_kind == "mcx_fut" else "nse"),
            "session_group": (urow or {}).get("session_group") or (
                "mcx_non_agri" if quote_kind == "mcx_fut" else "nse"
            ),
        }
    notes = None
    hint = None
    if not caps["optionOI"]:
        notes = "OI analytics need listed CE and PE. This name has no option chain in the Kite dump."
    elif quote_kind == "mcx_fut":
        hint = (
            f"Kite name {key} on MCX (majors: {', '.join(MCX_MAJOR_IDS)}; "
            "minis CRUDEOILM / GOLDM / SILVERM / NATGASMINI are separate). "
            f"No cash spot — ATM from nearest FUT {quote or '—'}. "
            "Poll in this name's session_group hours (non-agri 09:00–23:30 IST in US DST, "
            "23:55 otherwise; select agri 21:00; other agri 17:00). "
            "Publisher Kite needs the commodity segment."
        )
    return {
        "id": key,
        "name": key,
        "display_name": (urow or {}).get("label") or key,
        "exchange": exch,
        "quote_symbol": quote,
        "quote_kind": quote_kind,
        "segment": opt_seg,
        "step": step,
        "expiries": expiries[:24],
        "ce_count": len(ce),
        "pe_count": len(pe),
        "fut_count": len(fut),
        "capabilities": caps,
        "config": cfg,
        "can_enable_oi": bool(cfg) and caps["optionOI"],
        "notes": notes,
        "hint": hint,
    }


def public_registry_doc(doc: Dict[str, Any]) -> Dict[str, Any]:
    if not doc:
        return {}
    caps = doc.get("capabilities") or {}
    return {
        "id": doc.get("_id") or doc.get("id"),
        "name": doc.get("name"),
        "display_name": doc.get("display_name") or doc.get("name"),
        "symbol": doc.get("symbol"),
        "exchange": doc.get("exchange"),
        "quote_symbol": doc.get("quote_symbol"),
        "quote_kind": doc.get("quote_kind"),
        "segment": doc.get("segment"),
        "step": doc.get("step"),
        "enabled": bool(doc.get("enabled")),
        "capabilities": caps,
        "updated_at": doc.get("updated_at"),
    }


def merge_live_index_config(extra: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    from oi_service import merge_index_config

    return merge_index_config(extra)


async def bootstrap_registry(db, settings: Optional[Dict[str, Any]] = None) -> List[str]:
    """Ensure NIFTY/SENSEX/BANKNIFTY exist. Returns enabled ids."""
    now = datetime.now(timezone.utc).isoformat()
    enabled_set = set((settings or {}).get("enabled_indices") or list(DESK_IDS))
    for uid, cfg in desk_index_config().items():
        u = universe_get(uid) or {}
        caps = capabilities_from_flags(live_price=True, futures=True, options=True)
        await db.index_registry.update_one(
            {"_id": uid},
            {
                "$setOnInsert": {
                    "name": uid,
                    "display_name": uid,
                    "symbol": uid,
                    "exchange": (u.get("exchange") if u else None),
                    "bootstrap": True,
                    "created_at": now,
                    "capabilities": caps,
                    "enabled": uid in enabled_set,
                },
                "$set": {
                    "quote_symbol": cfg["quote_symbol"],
                    "segment": cfg["segment"],
                    "step": cfg["step"],
                    "strikes_around_atm": cfg["strikes_around_atm"],
                    "updated_at": now,
                },
            },
            upsert=True,
        )
    enabled = []
    async for d in db.index_registry.find({"enabled": True}):
        enabled.append(d["_id"])
    if not enabled:
        enabled = list(DESK_IDS)
    extra_cfg = {}
    async for d in db.index_registry.find({}):
        if d["_id"] in DESK_IDS:
            continue
        if d.get("quote_symbol") and d.get("segment"):
            extra_cfg[d["_id"]] = d
    merge_live_index_config(extra_cfg)
    return enabled


async def persist_underlyings(db, summaries: List[Dict[str, Any]]) -> int:
    now = datetime.now(timezone.utc).isoformat()
    n = 0
    for s in summaries:
        uid = s.get("id")
        if not uid:
            continue
        await db.kite_underlyings.update_one(
            {"_id": uid},
            {"$set": {**{k: v for k, v in s.items() if k != "id"}, "synced_at": now}},
            upsert=True,
        )
        n += 1
    await db.kite_underlyings_meta.update_one(
        {"_id": "sync"},
        {"$set": {"synced_at": now, "count": n}},
        upsert=True,
    )
    return n


async def search_cached(db, q: str, limit: int = 40) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    needle = str(q or "").strip().upper()
    filt: Dict[str, Any] = {}
    if needle:
        filt = {
            "$or": [
                {"_id": {"$regex": needle, "$options": "i"}},
                {"name": {"$regex": needle, "$options": "i"}},
                {"exchange": {"$regex": needle, "$options": "i"}},
            ]
        }
    cur = db.kite_underlyings.find(filt).sort("_id", 1).limit(int(limit or 40))
    rows = []
    async for d in cur:
        item = dict(d)
        item["id"] = d["_id"]
        rows.append(item)
    meta = await db.kite_underlyings_meta.find_one({"_id": "sync"})
    return rows, (meta or {}).get("synced_at")


async def write_audit(db, *, action: str, index: str, admin: Any, prev: Any, new: Any) -> None:
    try:
        await db.admin_audit.insert_one(
            {
                "action": action,
                "index": index,
                "at": datetime.now(timezone.utc).isoformat(),
                "administrator": str(admin) if admin is not None else None,
                "previous": prev,
                "new": new,
            }
        )
    except Exception:
        logger.warning("admin_audit insert failed", exc_info=True)
