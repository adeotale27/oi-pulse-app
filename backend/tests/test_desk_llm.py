from desk_llm import BUILTIN, env_llm, public_row


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
