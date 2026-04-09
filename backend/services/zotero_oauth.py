"""Zotero integration: supports both Personal API Key (simple) and OAuth 1.0a."""
from __future__ import annotations

import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_pending: dict[str, dict[str, Any]] = {}
_TTL_SEC = 900


def _cleanup_pending() -> None:
    now = time.time()
    dead = [k for k, v in _pending.items() if now - float(v.get("created", 0)) > _TTL_SEC]
    for k in dead:
        _pending.pop(k, None)


# ---------------------------------------------------------------------------
# API Key mode (simple — user pastes their key + userID from zotero.org)
# ---------------------------------------------------------------------------

def fetch_top_items_apikey(api_key: str, user_id: str, limit: int = 25) -> list[dict[str, Any]]:
    url = f"https://api.zotero.org/users/{user_id}/items/top"
    with httpx.Client(timeout=30.0) as client:
        r = client.get(url, params={"limit": limit, "format": "json"}, headers={"Zotero-API-Key": api_key})
        r.raise_for_status()
    data = r.json()
    return data if isinstance(data, list) else []


def fetch_item_children_apikey(api_key: str, user_id: str, item_key: str) -> list[dict[str, Any]]:
    url = f"https://api.zotero.org/users/{user_id}/items/{item_key}/children"
    with httpx.Client(timeout=30.0) as client:
        r = client.get(url, params={"format": "json"}, headers={"Zotero-API-Key": api_key})
        r.raise_for_status()
    data = r.json()
    return data if isinstance(data, list) else []


def verify_apikey(api_key: str) -> dict[str, Any]:
    """Verify an API key and return the associated userID + username."""
    url = "https://api.zotero.org/keys/current"
    with httpx.Client(timeout=20.0) as client:
        r = client.get(url, headers={"Zotero-API-Key": api_key})
        r.raise_for_status()
    data = r.json()
    return {
        "userID": str(data.get("userID", "")),
        "username": data.get("username", ""),
        "access": data.get("access", {}),
    }


# ---------------------------------------------------------------------------
# OAuth 1.0a mode (server-level keys — only if env vars are configured)
# ---------------------------------------------------------------------------

def get_zotero_credentials() -> tuple[str, str, str]:
    import os

    key = os.getenv("ZOTERO_CLIENT_KEY", "").strip()
    secret = os.getenv("ZOTERO_CLIENT_SECRET", "").strip()
    cb = os.getenv("ZOTERO_CALLBACK_URL", "").strip()
    if not key or not secret or not cb:
        raise ValueError(
            "Set ZOTERO_CLIENT_KEY, ZOTERO_CLIENT_SECRET, and ZOTERO_CALLBACK_URL "
            "or use API Key mode instead."
        )
    return key, secret, cb


def oauth_available() -> bool:
    import os
    return bool(
        os.getenv("ZOTERO_CLIENT_KEY", "").strip()
        and os.getenv("ZOTERO_CLIENT_SECRET", "").strip()
        and os.getenv("ZOTERO_CALLBACK_URL", "").strip()
    )


def start_authorization(user_id: str) -> dict[str, str]:
    from requests_oauthlib import OAuth1Session

    _cleanup_pending()
    key, secret, cb = get_zotero_credentials()
    oauth = OAuth1Session(key, client_secret=secret, callback_uri=cb)
    token = oauth.fetch_request_token("https://www.zotero.org/oauth/request")
    rt = (token or {}).get("oauth_token") or oauth.token.get("oauth_token")
    rts = (token or {}).get("oauth_token_secret") or oauth.token.get("oauth_token_secret")
    if not rt or not rts:
        raise RuntimeError("Zotero did not return oauth_token")
    _pending[str(rt)] = {"oauth_token_secret": rts, "user_id": user_id, "created": time.time()}
    auth_url, _ = oauth.authorization_url("https://www.zotero.org/oauth/authorize")
    return {"authorization_url": auth_url, "oauth_token": str(rt)}


def complete_authorization(oauth_token: str, oauth_verifier: str) -> tuple[str, dict[str, Any]]:
    from requests_oauthlib import OAuth1Session

    _cleanup_pending()
    p = _pending.pop(str(oauth_token), None)
    if not p:
        raise ValueError("Invalid or expired OAuth session; start again from the app.")
    slr_uid = str(p["user_id"])
    key, secret, _ = get_zotero_credentials()
    oauth = OAuth1Session(
        key,
        client_secret=secret,
        resource_owner_key=oauth_token,
        resource_owner_secret=p["oauth_token_secret"],
    )
    oauth.fetch_access_token("https://www.zotero.org/oauth/access", verifier=oauth_verifier)
    tok = oauth.token or {}
    out = {
        "oauth_token": tok.get("oauth_token"),
        "oauth_token_secret": tok.get("oauth_token_secret"),
        "userID": tok.get("userID") or tok.get("user_id"),
        "username": tok.get("username") or tok.get("screen_name"),
    }
    if not out.get("oauth_token") or not out.get("oauth_token_secret"):
        raise RuntimeError("Zotero access token incomplete")
    return slr_uid, out


def fetch_top_items(access: dict[str, Any], limit: int = 25) -> list[dict[str, Any]]:
    uid = str(access.get("userID") or "")
    if not uid:
        raise ValueError("Missing Zotero userID in stored credentials")
    from requests_oauthlib import OAuth1Session

    key, secret, _ = get_zotero_credentials()
    sess = OAuth1Session(
        key,
        client_secret=secret,
        resource_owner_key=access["oauth_token"],
        resource_owner_secret=access["oauth_token_secret"],
    )
    url = f"https://api.zotero.org/users/{uid}/items/top"
    r = sess.get(url, params={"limit": limit, "format": "json"})
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, list) else []
