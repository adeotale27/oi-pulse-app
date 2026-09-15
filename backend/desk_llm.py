"""Desk LLM providers: OpenAI-compatible keys in the Fernet vault (admin-only)."""

from __future__ import annotations

import base64
import hashlib
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

COL = "desk_ai_providers"
ACTIVE_ID = "_active"

BUILTIN: List[Dict[str, str]] = [
    {"id": "openai", "name": "OpenAI", "base_url": "https://api.openai.com/v1", "model": "gpt-4o-mini"},
    {"id": "deepseek", "name": "DeepSeek", "base_url": "https://api.deepseek.com/v1", "model": "deepseek-chat"},
    {"id": "xai", "name": "xAI Grok", "base_url": "https://api.x.ai/v1", "model": "grok-3-mini"},
    {"id": "groq", "name": "Groq", "base_url": "https://api.groq.com/openai/v1", "model": "llama-3.1-8b-instant"},
    {"id": "openrouter", "name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "model": "openai/gpt-4o-mini"},
]

_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,40}$")
_has_key_cache = False


def _fernet():
    from cryptography.fernet import Fernet

    explicit = (os.environ.get("CREDENTIALS_FERNET_KEY") or os.environ.get("OI_VAULT_KEY") or "").strip()
    if explicit:
        try:
            return Fernet(explicit.encode() if isinstance(explicit, str) else explicit)
        except Exception:
            key = base64.urlsafe_b64encode(hashlib.sha256(explicit.encode()).digest())
            return Fernet(key)
    seed = os.environ.get("MONGO_URL", "seed") + os.environ.get("DB_NAME", "db")
    key = base64.urlsafe_b64encode(hashlib.sha256(seed.encode()).digest())
    return Fernet(key)


def encrypt_secret(plain: str) -> str:
    return _fernet().encrypt(str(plain).encode()).decode()


def decrypt_secret(blob: str) -> str:
    return _fernet().decrypt(str(blob).encode()).decode()


def env_llm() -> Dict[str, str]:
    key = (os.environ.get("OPENAI_API_KEY") or os.environ.get("DESK_GUIDE_API_KEY") or "").strip()
    return {
        "api_key": key,
        "base_url": (os.environ.get("DESK_GUIDE_BASE_URL") or "https://api.openai.com/v1").rstrip("/"),
        "model": (os.environ.get("DESK_GUIDE_MODEL") or "gpt-4o-mini").strip(),
        "provider_id": "env",
    }


def cached_has_key() -> bool:
    if _has_key_cache:
        return True
    return bool(env_llm()["api_key"])


def public_row(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": doc.get("id"),
        "name": doc.get("name"),
        "base_url": doc.get("base_url"),
        "model": doc.get("model"),
        "is_custom": bool(doc.get("is_custom")),
        "has_key": bool(doc.get("key_enc")),
        "selected": bool(doc.get("selected")),
    }


async def list_providers(db) -> List[Dict[str, Any]]:
    if db is None:
        return [{**p, "is_custom": False, "has_key": False, "selected": False} for p in BUILTIN]
    stored = {d["id"]: d async for d in db[COL].find({"id": {"$ne": ACTIVE_ID}}, {"_id": 0})}
    active = await db[COL].find_one({"id": ACTIVE_ID})
    active_id = (active or {}).get("provider_id")
    out = []
    seen = set()
    for p in BUILTIN:
        row = {**p, **(stored.get(p["id"]) or {}), "is_custom": False}
        row["id"] = p["id"]
        row["selected"] = row["id"] == active_id and (bool(row.get("key_enc")) or (row["id"] == "openai" and bool(env_llm().get("api_key"))))
        out.append(public_row(row))
        seen.add(p["id"])
    for pid, doc in stored.items():
        if pid in seen:
            continue
        has_key = bool(doc.get("key_enc"))
        doc = {**doc, "is_custom": True, "selected": pid == active_id and has_key}
        out.append(public_row(doc))
    return out


async def upsert_provider(db, payload: Dict[str, Any]) -> Dict[str, Any]:
    global _has_key_cache
    pid = str(payload.get("id") or "").strip().lower()
    name = str(payload.get("name") or "").strip()
    if not pid:
        pid = re.sub(r"[^a-z0-9_-]+", "-", name.lower()).strip("-")[:40] or f"ai-{uuid.uuid4().hex[:8]}"
    if not _ID_RE.match(pid):
        raise ValueError("Provider id must be 2–41 chars: a-z, 0-9, _-")
    base = str(payload.get("base_url") or "https://api.openai.com/v1").strip().rstrip("/")
    model = str(payload.get("model") or "gpt-4o-mini").strip() or "gpt-4o-mini"
    if not name:
        name = pid
    builtin_ids = {p["id"] for p in BUILTIN}
    prev = await db[COL].find_one({"id": pid}) or {}
    doc = {
        "id": pid,
        "name": name[:80],
        "base_url": base[:240],
        "model": model[:80],
        "is_custom": pid not in builtin_ids,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "key_enc": prev.get("key_enc"),
    }
    key = str(payload.get("api_key") or "").strip()
    if key:
        doc["key_enc"] = encrypt_secret(key)
        _has_key_cache = True
    if payload.get("clear_key"):
        doc["key_enc"] = None
    await db[COL].update_one({"id": pid}, {"$set": doc}, upsert=True)
    if payload.get("select") or not await db[COL].find_one({"id": ACTIVE_ID}):
        await set_active(db, pid)
    rows = await list_providers(db)
    return next((r for r in rows if r["id"] == pid), public_row(doc))


async def set_active(db, provider_id: str) -> None:
    env = env_llm()
    doc = await db[COL].find_one({"id": provider_id}) if db is not None else None
    has_vault = bool(doc and doc.get("key_enc"))
    env_ok = bool(env.get("api_key")) and provider_id == "openai"
    if not has_vault and not env_ok:
        raise ValueError("Add an API key for this provider (or set OPENAI_API_KEY for OpenAI) before making it Active.")
    await db[COL].update_one(
        {"id": ACTIVE_ID},
        {"$set": {"id": ACTIVE_ID, "provider_id": provider_id}},
        upsert=True,
    )


async def delete_provider(db, provider_id: str) -> None:
    builtin_ids = {p["id"] for p in BUILTIN}
    if provider_id in builtin_ids:
        await db[COL].update_one({"id": provider_id}, {"$unset": {"key_enc": ""}})
        return
    await db[COL].delete_one({"id": provider_id})
    active = await db[COL].find_one({"id": ACTIVE_ID})
    if (active or {}).get("provider_id") == provider_id:
        await db[COL].delete_one({"id": ACTIVE_ID})


async def resolve_llm(db=None) -> Dict[str, str]:
    """Active vault provider, else env. Never log the key."""
    global _has_key_cache
    fallback = env_llm()
    if db is None:
        return fallback
    try:
        active = await db[COL].find_one({"id": ACTIVE_ID})
        pid = (active or {}).get("provider_id")
        doc = await db[COL].find_one({"id": pid}) if pid else None
        if not doc:
            docs = [d async for d in db[COL].find({"key_enc": {"$exists": True, "$ne": None}}).limit(1)]
            doc = docs[0] if docs else None
        if doc and doc.get("key_enc"):
            key = decrypt_secret(doc["key_enc"]).strip()
            if key:
                _has_key_cache = True
                return {
                    "api_key": key,
                    "base_url": str(doc.get("base_url") or fallback["base_url"]).rstrip("/"),
                    "model": str(doc.get("model") or fallback["model"]),
                    "provider_id": str(doc.get("id") or "vault"),
                }
    except Exception:
        pass
    if fallback["api_key"]:
        _has_key_cache = True
    return fallback
