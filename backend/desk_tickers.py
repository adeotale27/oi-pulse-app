"""Desk index LTP rows for /tickers — Kite overlay on last OI snapshot."""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Tuple

CORE_SYMBOLS: Tuple[Tuple[str, str, str], ...] = (
    ("NIFTY", "NSE:NIFTY 50", "NIFTY 50"),
    ("SENSEX", "BSE:SENSEX", "SENSEX"),
    ("BANKNIFTY", "NSE:NIFTY BANK", "BANK NIFTY"),
)


def _f(v: Any, default: float = 0.0) -> float:
    try:
        n = float(v if v is not None else default)
        return n if n == n else default  # NaN
    except (TypeError, ValueError):
        return default


def pick_quote_blob(data: Optional[dict], symbol: str) -> dict:
    """Kite quote() keys sometimes omit the exchange prefix or add a suffix."""
    if not isinstance(data, dict) or not symbol:
        return {}
    direct = data.get(symbol)
    if isinstance(direct, dict) and (_f(direct.get("last_price")) or direct.get("ohlc")):
        return direct
    tail = symbol.split(":", 1)[-1].strip().upper()
    for k, v in data.items():
        if not isinstance(v, dict):
            continue
        ku = str(k).upper()
        if ku == symbol.upper() or ku.endswith(tail) or (tail and tail in ku):
            if _f(v.get("last_price")) or v.get("ohlc"):
                return v
    return direct if isinstance(direct, dict) else {}


def merge_ticker_row(
    internal: str,
    label: str,
    *,
    kite_blob: Optional[dict] = None,
    snap: Optional[dict] = None,
) -> Dict[str, Any]:
    """Prefer live Kite LTP; if missing/zero, keep last snapshot price. Keep OHLC close for change."""
    blob = kite_blob or {}
    snap = snap or {}
    ohlc = blob.get("ohlc") if isinstance(blob.get("ohlc"), dict) else {}
    kite_ltp = _f(blob.get("last_price"))
    snap_ltp = _f(snap.get("price") or snap.get("atm"))
    ltp = kite_ltp if kite_ltp else snap_ltp
    prev = _f(ohlc.get("close") or snap.get("prev_close"))
    day_open = _f(ohlc.get("open") or snap.get("day_open"))
    if not prev:
        prev = day_open or ltp
    if not day_open:
        day_open = prev or ltp
    change = (ltp - prev) if prev else 0.0
    change_pct = (change / prev * 100) if prev else 0.0
    source = "kite" if kite_ltp else ("snapshot" if snap_ltp else "none")
    return {
        "index": internal,
        "label": label,
        "ltp": round(ltp, 2),
        "prev_close": round(prev, 2),
        "day_open": round(day_open, 2),
        "day_high": round(_f(ohlc.get("high"), ltp), 2),
        "day_low": round(_f(ohlc.get("low"), ltp), 2),
        "change": round(change, 2),
        "change_pct": round(change_pct, 3),
        "source": source,
        "as_of": snap.get("timestamp"),
    }


def ticker_symbol_list(
    enabled: Iterable[str],
    *,
    index_config: Optional[dict] = None,
    extra: Optional[List[Tuple[str, str, str]]] = None,
) -> List[Tuple[str, str, str]]:
    symbols = list(CORE_SYMBOLS)
    seen = {s[0] for s in symbols}
    cfgs = index_config or {}
    for uid in enabled or []:
        if uid in seen:
            continue
        cfg = cfgs.get(uid) or {}
        qsym = cfg.get("quote_symbol")
        if not qsym:
            continue
        symbols.append((uid, qsym, uid))
        seen.add(uid)
    if extra:
        for row in extra:
            if row[0] not in seen:
                symbols.append(row)
                seen.add(row[0])
    return symbols
