"""WebSocket disconnect vs real errors (reload / tab close are not crashes)."""
from __future__ import annotations

import asyncio
from typing import Any


def ws_client_gone(exc: BaseException) -> bool:
    if isinstance(exc, asyncio.CancelledError):
        return True
    if isinstance(exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)):
        return True
    return type(exc).__name__ in (
        "WebSocketDisconnect",
        "ConnectionClosed",
        "ConnectionClosedOK",
        "ConnectionClosedError",
    )


async def close_ws_quietly(websocket: Any) -> None:
    try:
        await websocket.close()
    except Exception:
        pass
