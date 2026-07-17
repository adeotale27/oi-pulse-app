"""
Telegram notifier for uptime and trading alerts.

Reads TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from env. If either is missing,
notifications become a no-op (graceful degradation).

How to set up:
  1. Talk to @BotFather on Telegram, /newbot, get a bot token.
  2. Message your new bot once (any text).
  3. Visit https://api.telegram.org/bot<TOKEN>/getUpdates and copy the chat "id".
  4. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in backend/.env, restart backend.
"""
import os
import time
import logging
import asyncio
from typing import Optional, Dict
import httpx

logger = logging.getLogger(__name__)

TELEGRAM_API = "https://api.telegram.org"

# Per-key cooldown so we don't spam the user with duplicate errors.
_last_sent: Dict[str, float] = {}


def _cfg():
    return (
        os.environ.get("TELEGRAM_BOT_TOKEN", "").strip(),
        os.environ.get("TELEGRAM_CHAT_ID", "").strip(),
    )


def is_configured() -> bool:
    token, chat = _cfg()
    return bool(token) and bool(chat)


async def send_message(text: str, *, dedupe_key: Optional[str] = None,
                       cooldown_seconds: int = 300, parse_mode: str = "HTML") -> bool:
    """
    Send a Telegram message. If dedupe_key is given, suppress duplicates within cooldown_seconds.
    Returns True on success, False otherwise (no exceptions raised to caller).
    """
    token, chat = _cfg()
    if not token or not chat:
        # Silently skip — notifications are optional.
        return False

    if dedupe_key:
        now = time.time()
        last = _last_sent.get(dedupe_key, 0)
        if now - last < cooldown_seconds:
            return False
        _last_sent[dedupe_key] = now

    url = f"{TELEGRAM_API}/bot{token}/sendMessage"
    payload = {
        "chat_id": chat,
        "text": text,
        "parse_mode": parse_mode,
        "disable_web_page_preview": True,
    }
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


def send_message_sync(text: str, *, dedupe_key: Optional[str] = None,
                      cooldown_seconds: int = 300) -> bool:
    """Sync wrapper for contexts where we can't await."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.ensure_future(send_message(text, dedupe_key=dedupe_key, cooldown_seconds=cooldown_seconds))
            return True
        return loop.run_until_complete(send_message(text, dedupe_key=dedupe_key, cooldown_seconds=cooldown_seconds))
    except Exception as e:
        logger.warning(f"Telegram sync send error: {e}")
        return False


# ---------- Convenience helpers used by the tracker ----------

async def alert_tracker_stopped(reason: str):
    await send_message(
        f"🔴 <b>OI-Pulse tracker STOPPED</b>\nReason: {reason}",
        dedupe_key="tracker_stopped",
        cooldown_seconds=600,
    )


async def alert_tracker_error(error: str):
    await send_message(
        f"⚠️ <b>OI-Pulse error</b>\n<code>{error[:400]}</code>",
        dedupe_key=f"tracker_error:{error[:60]}",
        cooldown_seconds=600,
    )


async def alert_kite_token_issue(detail: str):
    await send_message(
        f"🔑 <b>Kite token issue</b>\n{detail}\n\n"
        f"Please regenerate: open the app → Kite Login → paste request_token, "
        f"or POST to <code>/api/kite/refresh</code>.",
        dedupe_key="kite_token_issue",
        cooldown_seconds=3600,  # remind at most once/hour
    )


async def alert_market_open():
    await send_message(
        "🟢 <b>Market open</b> — OI-Pulse is now polling live data.",
        dedupe_key=f"market_open:{time.strftime('%Y-%m-%d')}",
        cooldown_seconds=86400,
    )


async def alert_market_close():
    await send_message(
        "🔵 <b>Market closed</b> — polling paused until 9:00 AM tomorrow (IST).",
        dedupe_key=f"market_close:{time.strftime('%Y-%m-%d')}",
        cooldown_seconds=86400,
    )


async def alert_oi_spike(alert: dict):
    idx = alert.get("index", "?")
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
    # No dedupe on OI spikes — user wants each real alert
    await send_message(text, dedupe_key=None)


async def alert_huge_shift(shift: dict):
    """Called from frontend when the HugeShiftModal fires. Forwards the same data to Telegram."""
    idx = shift.get("index", "?")
    side = shift.get("side", "?")           # 'CE' or 'PE'
    value = shift.get("value", 0)
    direction = shift.get("direction", "build")   # 'build' or 'unwind'
    window = shift.get("window", "?")
    price = shift.get("price")
    atm = shift.get("atm")
    contributing = (shift.get("contributing") or [])[:5]

    # Emoji: CE build = bearish (red), CE unwind = bullish (green)
    # PE build = bullish (green), PE unwind = bearish (red)
    bullish = (side == "PE" and direction == "build") or (side == "CE" and direction == "unwind")
    emoji = "🟢" if bullish else "🔴"
    sign = "+" if value > 0 else ""
    mn = f"{value/1e6:.2f}M"  # human-readable

    contrib_lines = "\n".join(
        f"• {c['strike']}: CE {c.get('ce_delta',0)/1e6:+.2f}M · PE {c.get('pe_delta',0)/1e6:+.2f}M"
        for c in contributing
    )

    text = (
        f"{emoji} <b>HUGE OI SHIFT · {idx}</b>\n"
        f"{side} {direction.upper()} in last <b>{window} min</b> → <b>{sign}{mn}</b>\n"
        f"Price: <b>{price}</b>  |  ATM: <b>{atm}</b>\n"
        f"{contrib_lines}"
    )
    # Dedupe per (index, window, side, direction) for 2 min so we don't spam
    key = f"huge:{idx}:{window}:{side}:{direction}"
    await send_message(text, dedupe_key=key, cooldown_seconds=120)


async def send_daily_digest(digest: dict):
    """Send end-of-day summary. digest = {
        date, alerts_total, indices: [ {index, closing_price, atm, total_alerts,
        top_bullish: {...}, top_bearish: {...}, biggest_ce_shift, biggest_pe_shift} ] } """
    date = digest.get("date", "?")
    total = digest.get("alerts_total", 0)
    lines = [f"📊 <b>OI-Pulse Daily Digest — {date}</b>", f"Total alerts: <b>{total}</b>", ""]
    for row in digest.get("indices", []):
        lines.append(f"<b>{row['index']}</b>")
        lines.append(f"Close: {row.get('closing_price', '—')}  |  ATM: {row.get('atm', '—')}")
        lines.append(f"Alerts today: {row.get('total_alerts', 0)}")
        tb = row.get("top_bullish")
        tbe = row.get("top_bearish")
        if tb:
            lines.append(f"🟢 Top bullish: {tb.get('index','')} — strike {tb.get('strike','?')} PE {tb.get('pe_pct',0):+.1f}%")
        if tbe:
            lines.append(f"🔴 Top bearish: {tbe.get('index','')} — strike {tbe.get('strike','?')} CE {tbe.get('ce_pct',0):+.1f}%")
        lines.append("")
    await send_message("\n".join(lines).strip(), dedupe_key=f"digest:{date}", cooldown_seconds=86400)


async def send_test_message() -> bool:
    return await send_message(
        "✅ <b>OI-Pulse Telegram is connected!</b>\n"
        "You'll now receive:\n"
        "• Tracker stop / error alerts\n"
        "• Daily Kite token reminder\n"
        "• Market open / close pings\n"
        "• OI reversal spike alerts",
        dedupe_key=None,
    )
