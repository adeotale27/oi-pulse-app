import asyncio

import notifier


class _Col:
    def __init__(self):
        self.doc = {}

    async def find_one(self, q):
        if q.get("_id") == "telegram_prefs":
            return dict(self.doc) if self.doc else None
        return None

    async def update_one(self, q, u, upsert=False):
        if q.get("_id") != "telegram_prefs":
            return
        self.doc.update(u.get("$set") or {})
        self.doc["_id"] = "telegram_prefs"


class _Db:
    def __init__(self):
        self.settings = _Col()


def test_public_prefs_never_exposes_plaintext_token(monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    db = _Db()
    notifier.set_db(db)
    notifier._prefs_cache = {}
    notifier._prefs_cache_ts = 0
    notifier._secret = {"token": "", "chat": ""}

    pub = asyncio.run(notifier.save_prefs({"bot_token": "123456:ABCDEF-secret", "chat_id": "999"}))
    assert pub["bot_token_configured"] is True
    assert pub["bot_token_masked"].endswith("cret")
    assert "123456:ABCDEF-secret" not in str(pub)
    assert "bot_token_enc" not in pub
    assert pub["chat_id"] == "999"
    assert "bot_token_enc" in db.settings.doc

    kept = asyncio.run(notifier.save_prefs({"enabled": False}))
    assert kept["enabled"] is False
    assert kept["bot_token_configured"] is True
    assert notifier._secret["token"] == "123456:ABCDEF-secret"

    masked = asyncio.run(notifier.save_prefs({"bot_token": "************cret"}))
    assert notifier._secret["token"] == "123456:ABCDEF-secret"
    assert masked["bot_token_masked"]


def test_mask_helpers():
    assert notifier.mask_bot_token("abcd1234").endswith("1234")
    assert notifier.is_placeholder_token("")
    assert notifier.is_placeholder_token("************1234")
    assert not notifier.is_placeholder_token("real-token-value")
