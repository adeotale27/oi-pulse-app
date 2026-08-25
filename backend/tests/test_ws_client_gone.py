import asyncio

from ws_close import ws_client_gone


class WebSocketDisconnect(Exception):
    pass


def test_disconnect_and_cancel_are_client_gone():
    assert ws_client_gone(WebSocketDisconnect())
    assert ws_client_gone(asyncio.CancelledError())
    assert ws_client_gone(ConnectionResetError())
    assert not ws_client_gone(RuntimeError("boom"))
