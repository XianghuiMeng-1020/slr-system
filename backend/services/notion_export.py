"""Create Notion pages via official API (integration token)."""
from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

NOTION_VERSION = "2022-06-28"


def normalize_notion_page_id(raw: str) -> str:
    s = raw.strip().split("?")[0].strip()
    if "/" in s:
        s = s.rsplit("/", 1)[-1]
    s = s.replace("-", "")
    if len(s) == 32:
        return f"{s[0:8]}-{s[8:12]}-{s[12:16]}-{s[16:20]}-{s[20:32]}"
    return raw.strip()


def create_page_with_blocks(
    integration_secret: str,
    parent_page_id: str,
    title: str,
    paragraph_lines: list[str],
) -> dict[str, Any]:
    """
    parent_page_id: Notion page UUID (with or without dashes).
    """
    url = "https://api.notion.com/v1/pages"
    headers = {
        "Authorization": f"Bearer {integration_secret}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }
    page_id = normalize_notion_page_id(parent_page_id)
    parent = {"type": "page_id", "page_id": page_id}

    children = []
    for line in paragraph_lines[:90]:
        if not line.strip():
            continue
        children.append(
            {
                "object": "block",
                "type": "paragraph",
                "paragraph": {
                    "rich_text": [{"type": "text", "text": {"content": line[:2000]}}],
                },
            }
        )

    body: dict[str, Any] = {
        "parent": parent,
        "properties": {
            "title": {
                "title": [{"type": "text", "text": {"content": title[:2000]}}],
            },
        },
    }
    if children:
        body["children"] = children

    with httpx.Client(timeout=60.0) as client:
        r = client.post(url, headers=headers, json=body)
        if r.status_code >= 400:
            logger.warning("Notion API error: %s %s", r.status_code, r.text[:500])
            r.raise_for_status()
        return r.json()
