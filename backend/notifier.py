"""
Telegram notifier for uptime and trading alerts.

Reads TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from env. If either is missing,
notifications become a no-op (graceful degradation).

Also honors per-user preferences stored in Mongo (db.settings, _id="telegram_prefs")
so the user can filter which indices / event types / hours receive alerts.
"""
import os
import time
import logging
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any
import httpx

logger = logging.getLogger(__name__)

TELEGRAM_API = "https://api.telegram.org"
IST = timezone(timedelta(hours=5, minutes=30))

# Per-key cooldown so we don't spam the user with duplicate errors.
_last_sent: Dict[str, float] = {}

# Cached prefs (refreshed every PREFS_TTL_SEC from db) — set by set_db().
_db = None
_prefs_cache: Dict[str, Any] = {}
_prefs_cache_ts: float = 0.0
PREFS_TTL_SEC = 10  # short so changes reflect quickly

DEFAULT_PREFS: Dict[str, Any] = {
    "enabled": True,
    "indices": {"NIFTY": True, "SENSEX": True, "BANKNIFTY": True},
    "types": {
        "oi_reversal": True,
        "huge_shift": True,
        "huge_shift_major_only": False,   # if true, only send TG when shift is "major"
        "market_open": True,
        "market_close": True,
        "daily_digest": True,
        "tracker_errors": True,
        "kite_token": True,
    },
    "quiet_hours": {
        "enabled": False,   # if true, only send during [start, end] IST
        "start": "09:00",
        "end": "10:30",
    },
    # |Δ OI| in raw contracts. Default 2 Cr = 20 lakh contracts... actually raw units of OI.
    # Frontend sends value in "contracts * lot?" — see useHugeShiftMonitor: it's raw ΔOI sum.
    # 1 Cr threshold in UI (oiSettings.hugeShiftAbs default 10_000_000). "Major" default = 2x = 2 Cr.
    "major_abs_threshold": 20_000_000,
}


def set_db(db):
    """Called once at startup from server.py to give us access to the mongo db."""
    global _db
    _db = db


def _cfg():
    return (
        os.environ.get("TELEGRAM_BOT_TOKEN", "").strip(),
        os.environ.get("TELEGRAM_CHAT_ID", "").strip(),
    )


def is_configured() -> bool:
    token, chat = _cfg()
    return bool(token) and bool(chat)


async def _load_prefs() -> Dict[str, Any]:
    """Read prefs from Mongo with a small in-memory cache."""
    global _prefs_cache, _prefs_cache_ts
    now = time.time()
    if _prefs_cache and (now - _prefs_cache_ts) < PREFS_TTL_SEC:
        return _prefs_cache
    prefs = dict(DEFAULT_PREFS)
    try:
        if _db is not None:
            doc = await _db.settings.find_one({"_id": "telegram_prefs"})
            if doc:
                doc.pop("_id", None)
                # Deep merge (only 1 level of nesting for indices/types/quiet_hours)
                for k, v in doc.items():
                    if isinstance(v, dict) and isinstance(prefs.get(k), dict):
                        merged = dict(prefs[k]); merged.update(v)
                        prefs[k] = merged
                    else:
                        prefs[k] = v
    except Exception as e:
        logger.warning(f"telegram prefs load failed: {e}")
    _prefs_cache = prefs
    _prefs_cache_ts = now
    return prefs


async def get_prefs() -> Dict[str, Any]:
    """Public accessor — always returns fresh-ish prefs merged with defaults."""
    return await _load_prefs()


async def save_prefs(patch: Dict[str, Any]) -> Dict[str, Any]:
    """Merge `patch` into stored prefs. Only known keys are persisted."""
    global _prefs_cache_ts
    allowed_top = {"enabled", "indices", "types", "quiet_hours", "major_abs_threshold"}
    clean = {k: v for k, v in (patch or {}).items() if k in allowed_top}
    if _db is None:
        raise RuntimeError("DB not initialized for telegram prefs")
    await _db.settings.update_one(
        {"_id": "telegram_prefs"}, {"$set": clean}, upsert=True
    )
    _prefs_cache_ts = 0  # invalidate cache
    return await _load_prefs()


def _in_quiet_hours(prefs: Dict[str, Any]) -> bool:
    """
    Returns True if quiet-hours mode is enabled AND the current IST time
    is OUTSIDE the [start, end] window (i.e., we should mute).
    Naming: "quiet_hours" means "only send during this window" (morning-only mode).
    """
    qh = prefs.get("quiet_hours", {}) or {}
    if not qh.get("enabled"):
        return False
    now = datetime.now(IST).strftime("%H:%M")
    start = str(qh.get("start", "09:00"))
    end = str(qh.get("end", "10:30"))
    # Normal case (no midnight wrap)
    if start <= end:
        return not (start <= now <= end)
    # Wrap (e.g., 22:00 → 06:00)
    return not (now >= start or now <= end)


async def _should_send(event_type: str, *, index: Optional[str] = None,
                       is_major: bool = False, is_critical: bool = False) -> bool:
    """
    Decide whether to send a Telegram message based on prefs.
    * is_critical=True bypasses master ON/OFF and quiet hours (e.g., tracker_errors).
    """
    prefs = await _load_prefs()
    # Master switch
    if not prefs.get("enabled", True) and not is_critical:
        return False
    # Event-type toggle
    types = prefs.get("types", {}) or {}
    if event_type in types and not types.get(event_type, True) and not is_critical:
        return False
    # Major-only override for huge_shift
    if event_type == "huge_shift" and types.get("huge_shift_major_only") and not is_major:
        return False
    # Index filter (only for events that carry an index)
    if index:
        idx_map = prefs.get("indices", {}) or {}
        if not idx_map.get(index, True):
            return False
    # Quiet-hours: skip non-critical events outside the allowed window
    if _in_quiet_hours(prefs) and not is_critical:
        return False
    return True


# ---------------- Formatters ----------------
def fmt_lakh(v: float) -> str:
    """Format a raw ΔOI value in Indian lakhs (Cr for >= 100 L to keep messages short)."""
    if v is None:
        return "—"
    absv = abs(v)
    sign = "+" if v > 0 else ("-" if v < 0 else "")
    if absv >= 10_000_000:  # 1 Cr
        return f"{sign}{absv/10_000_000:.2f} Cr"
    return f"{sign}{absv/100_000:.1f} L"


def _classify_shift(side: str, direction: str) -> tuple:
    """Return (bias, meaning) for an OI build/unwind. No position advice."""
    bullish = (side == "PE" and direction == "build") or (side == "CE" and direction == "unwind")
    bearish = (side == "CE" and direction == "build") or (side == "PE" and direction == "unwind")
    if bullish:
        return (
            "Support / bid",
            "Puts building or calls covering — spot has a bid underneath. Watch whether that strike holds.",
        )
    if bearish:
        return (
            "Resistance / offer",
            "Calls building or puts covering — supply overhead. Watch whether spot is rejected there.",
        )
    return ("Watch", "OI moved; read the ladder on the desk for the exact strikes.")


def format_huge_shift_html(shift: dict, *, is_major: bool) -> str:
    idx = shift.get("index", "?")
    side = shift.get("side", "?")
    value = shift.get("value", 0) or 0
    direction = shift.get("direction", "build")
    window = shift.get("window", "?")
    price = shift.get("price")
    atm = shift.get("atm")
    contributing = (shift.get("contributing") or [])[:5]
    bias, meaning = _classify_shift(side, direction)
    banner = "🚨 <b>MAJOR OI SHIFT</b>\n" if is_major else "⚡ <b>OI SHIFT</b>\n"
    contrib_lines = "\n".join(
        f"• {c.get('strike')}: CE {fmt_lakh(c.get('ce_delta', 0))}  ·  PE {fmt_lakh(c.get('pe_delta', 0))}"
        for c in contributing
        if isinstance(c, dict) and "quantity" not in c and "tradingsymbol" not in c
    )
    return (
        f"{banner}"
        f"<b>{idx}</b> · {side} {direction.upper()} in last <b>{window} min</b> → <b>{fmt_lakh(value)}</b>\n"
        f"Read: <b>{bias}</b>\n"
        f"{meaning}\n"
        f"Spot: <b>{price if price is not None else '—'}</b>  ·  ATM: <b>{atm if atm is not None else '—'}</b>\n"
        f"{contrib_lines}\n"
        f"<i>Open the OI chart on the desk. We never send your book.</i>"
    )


# ---------------- Send primitive ----------------
async def send_message(text: str, *, dedupe_key: Optional[str] = None,
                       cooldown_seconds: int = 300, parse_mode: str = "HTML") -> bool:
    token, chat = _cfg()
    if not token or not chat:
        return False
    if dedupe_key:
        now = time.time()
        last = _last_sent.get(dedupe_key, 0)
        if now - last < cooldown_seconds:
            return False
        _last_sent[dedupe_key] = now
    url = f"{TELEGRAM_API}/bot{token}/sendMessage"
    payload = {"chat_id": chat, "text": text, "parse_mode": parse_mode,
               "disable_web_page_preview": True}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(url, json=payload)
            if r.status_code != 200:
                logger.warning(f"Telegram sendMessage failed [{r.status_code}]: {r.text[:200]}")
                return False
            return True
    except Exception as e:
        logger.warning(f"Telegram send error: {type(e).__name__}: {e}")
        return False


# ---------------- Semantic wrappers ----------------
async def alert_tracker_stopped(reason: str):
    if not await _should_send("tracker_errors", is_critical=True):
        return
    await send_message(
        f"🔴 <b>OI-Pulse tracker STOPPED</b>\nReason: {reason}",
        dedupe_key="tracker_stopped", cooldown_seconds=600,
    )


async def alert_tracker_error(error: str):
    if not await _should_send("tracker_errors", is_critical=True):
        return
    await send_message(
        f"⚠️ <b>OI-Pulse error</b>\n<code>{error[:400]}</code>",
        dedupe_key=f"tracker_error:{error[:60]}", cooldown_seconds=600,
    )


async def alert_kite_token_issue(detail: str):
    if not await _should_send("kite_token", is_critical=True):
        return
    await send_message(
        f"🔑 <b>Kite token issue</b>\n{detail}\n\n"
        f"Please regenerate via the 'Refresh Kite' button on the dashboard.",
        dedupe_key="kite_token_issue", cooldown_seconds=3600,
    )


async def alert_market_open():
    if not await _should_send("market_open"):
        return
    await send_message(
        "🟢 <b>Market open</b> — OI-Pulse is now polling live data.",
        dedupe_key=f"market_open:{time.strftime('%Y-%m-%d')}", cooldown_seconds=86400,
    )


async def alert_market_close():
    if not await _should_send("market_close"):
        return
    await send_message(
        "🔵 <b>Market closed</b> — polling paused until next open (IST).",
        dedupe_key=f"market_close:{time.strftime('%Y-%m-%d')}", cooldown_seconds=86400,
    )


async def alert_oi_spike(alert: dict):
    idx = alert.get("index", "?")
    if not await _should_send("oi_reversal", index=idx):
        return
    direction = alert.get("direction", "OI spike")
    price = alert.get("price")
    atm = alert.get("atm")
    strikes = alert.get("strikes", [])[:5]
    strike_lines = "\n".join(
        f"• {s['strike']}: CE {s['ce_pct']:+.1f}% / PE {s['pe_pct']:+.1f}%"
        for s in strikes
    )
    emoji = "🟢" if "Bullish" in direction else ("🔴" if "Bearish" in direction else "🟡")
    text = (
        f"{emoji} <b>{idx} — {direction}</b>\n"
        f"Price: <b>{price}</b>  |  ATM: <b>{atm}</b>\n"
        f"{strike_lines}"
    )
    await send_message(text, dedupe_key=None)


async def alert_huge_shift(shift: dict):
    """Forward a huge OI shift. Never include the user's book/positions."""
    idx = shift.get("index", "?")
    value = shift.get("value", 0) or 0
    prefs = await _load_prefs()
    major_threshold = float(prefs.get("major_abs_threshold", 20_000_000))
    is_major = abs(value) >= major_threshold
    if not await _should_send("huge_shift", index=idx, is_major=is_major):
        return
    text = format_huge_shift_html(shift, is_major=is_major)
    key = f"huge:{idx}:{shift.get('window')}:{shift.get('side')}:{shift.get('direction')}"
    await send_message(text, dedupe_key=key, cooldown_seconds=120)


def next_session_notes(now: Optional[datetime] = None) -> list:
    """Holidays / session notes for the next open. No positions."""
    from market_hours import now_ist, is_trading_day, is_full_holiday, NSE_SPECIAL_SESSIONS, NSE_HOLIDAYS
    dt = now or datetime.now(IST)
    notes = []
    d = (dt + timedelta(days=1)).date()
    guard = 0
    while guard < 10:
        guard += 1
        probe = datetime(d.year, d.month, d.day, 12, 0, tzinfo=IST)
        iso = d.isoformat()
        if iso in NSE_SPECIAL_SESSIONS:
            name = (NSE_SPECIAL_SESSIONS.get(iso) or {}).get("name") or "Muhurat"
            notes.append(f"Special session {iso}: {name}")
        if is_trading_day(probe):
            notes.insert(0, f"Next session: {d.strftime('%a %d %b %Y')}")
            break
        if is_full_holiday(probe) or iso in NSE_HOLIDAYS:
            notes.append(f"Market closed {iso} (NSE holiday)")
        elif probe.weekday() >= 5:
            notes.append(f"Weekend {iso}")
        d = d + timedelta(days=1)
    return notes[:6]


def format_eod_html(digest: dict, *, next_notes: Optional[list] = None) -> str:
    date = digest.get("date", "?")
    total = digest.get("alerts_total", 0)
    lines = [
        f"📋 <b>OI Pulse · session wrap {date}</b>",
        "Sent ~15:15 IST (cash F&O continuous close). Index F&O still prints until 15:40.",
        f"OI alerts today: <b>{total}</b>",
        "",
    ]
    for row in digest.get("indices") or []:
        idx = row.get("index", "?")
        lines.append(f"<b>{idx}</b>  close {row.get('closing_price', '—')}  ·  ATM {row.get('atm', '—')}  ·  alerts {row.get('total_alerts', 0)}")
        tb = row.get("top_bullish")
        tbe = row.get("top_bearish")
        if tb:
            lines.append(f"  Support print: strike {tb.get('strike', '?')} PE {tb.get('pe_pct', 0):+.1f}%")
        if tbe:
            lines.append(f"  Resistance print: strike {tbe.get('strike', '?')} CE {tbe.get('ce_pct', 0):+.1f}%")
    notes = next_notes if next_notes is not None else next_session_notes()
    if notes:
        lines.append("")
        lines.append("<b>Into the next session</b>")
        for n in notes:
            lines.append(f"• {n}")
    lines.append("")
    lines.append("<i>Chart is on the desk. We never send positions or P&L.</i>")
    return "\n".join(lines)


async def send_daily_digest(digest: dict):
    if not await _should_send("daily_digest"):
        return False
    date = digest.get("date", "?")
    text = format_eod_html(digest)
    return await send_message(text, dedupe_key=f"digest:{date}", cooldown_seconds=86400)


async def send_test_message() -> bool:
    return await send_message(
        "✅ <b>OI-Pulse Telegram is connected!</b>\n"
        "You'll now receive alerts based on your <b>Telegram Preferences</b> "
        "(click the ⚙️ Telegram button on the dashboard to configure).",
        dedupe_key=None,
    )
