"""Optional Qdrant vector store: mirrors project chunk embeddings for scalable similarity search."""
from __future__ import annotations

import logging
import os
import re
from typing import Any

logger = logging.getLogger(__name__)


def qdrant_enabled() -> bool:
    return bool(os.getenv("QDRANT_URL", "").strip())


def _sanitize_id(project_id: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", project_id)[:80]


def collection_name(project_id: str) -> str:
    pref = os.getenv("QDRANT_COLLECTION_PREFIX", "slr").strip() or "slr"
    return f"{pref}_{_sanitize_id(project_id)}"


def _client():
    try:
        from qdrant_client import QdrantClient
    except ImportError:
        logger.warning("qdrant-client not installed; pip install qdrant-client")
        return None
    url = os.getenv("QDRANT_URL", "http://127.0.0.1:6333").strip()
    key = os.getenv("QDRANT_API_KEY", "").strip() or None
    return QdrantClient(url=url, api_key=key, timeout=60)


def ensure_collection(dim: int, name: str) -> bool:
    client = _client()
    if not client:
        return False
    try:
        from qdrant_client.models import Distance, VectorParams

        try:
            client.get_collection(collection_name=name)
            return True
        except Exception:
            pass
        client.create_collection(
            collection_name=name,
            vectors_config=VectorParams(size=dim, distance=Distance.COSINE),
        )
        return True
    except Exception:
        logger.exception("Qdrant ensure_collection failed")
        return False


def delete_collection(name: str) -> None:
    client = _client()
    if not client:
        return
    try:
        try:
            client.get_collection(collection_name=name)
        except Exception:
            return
        client.delete_collection(collection_name=name)
    except Exception:
        logger.exception("Qdrant delete_collection failed")


def upsert_project_chunks(
    project_id: str,
    points: list[dict[str, Any]],
) -> int:
    """
    points: [{"id": str, "vector": list[float], "payload": dict}, ...]
    """
    if not qdrant_enabled() or not points:
        return 0
    client = _client()
    if not client:
        return 0
    name = collection_name(project_id)
    dim = len(points[0]["vector"])
    if not ensure_collection(dim, name):
        return 0
    try:
        from qdrant_client.models import PointStruct

        batch = [
            PointStruct(id=p["id"], vector=p["vector"], payload={**p["payload"], "project_id": project_id})
            for p in points
        ]
        client.upsert(collection_name=name, points=batch, wait=True)
        return len(batch)
    except Exception:
        logger.exception("Qdrant upsert failed")
        return 0


def search_project(
    project_id: str,
    query_vector: list[float],
    top_k: int = 8,
) -> list[dict[str, Any]]:
    if not qdrant_enabled():
        return []
    client = _client()
    if not client:
        return []
    name = collection_name(project_id)
    try:
        try:
            client.get_collection(collection_name=name)
        except Exception:
            return []
        res = client.search(
            collection_name=name,
            query_vector=query_vector,
            limit=top_k,
            with_payload=True,
        )
        out: list[dict[str, Any]] = []
        for hit in res:
            pl = hit.payload or {}
            out.append(
                {
                    "text": (pl.get("text") or "")[:500],
                    "score": float(hit.score or 0),
                    "document_id": pl.get("document_id"),
                    "chunk_id": pl.get("chunk_id"),
                }
            )
        return out
    except Exception:
        logger.exception("Qdrant search failed")
        return []
