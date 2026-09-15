from desk_llm import BUILTIN, env_llm, public_row, set_active
import asyncio
import os


def test_builtin_providers_include_deepseek_and_openai():
    ids = {p["id"] for p in BUILTIN}
    assert "openai" in ids and "deepseek" in ids


def test_public_row_never_includes_ciphertext():
    row = public_row({"id": "openai", "name": "OpenAI", "base_url": "https://api.openai.com/v1", "model": "gpt-4o-mini", "key_enc": "SECRET", "selected": True})
    assert "key_enc" not in row
    assert row["has_key"] is True
    assert "SECRET" not in str(row)


def test_env_fallback_shape():
    cfg = env_llm()
    assert "api_key" in cfg and "base_url" in cfg and "model" in cfg


def test_set_active_refuses_without_key():
    class Col:
        async def find_one(self, q):
            return None
        async def update_one(self, *a, **k):
            raise AssertionError("must not activate without a key")

    class Db:
        def __getitem__(self, _k):
            return Col()

    os.environ.pop("OPENAI_API_KEY", None)
    os.environ.pop("DESK_GUIDE_API_KEY", None)
    try:
        asyncio.run(set_active(Db(), "openai"))
        raise AssertionError("expected ValueError")
    except ValueError as e:
        assert "key" in str(e).lower()
