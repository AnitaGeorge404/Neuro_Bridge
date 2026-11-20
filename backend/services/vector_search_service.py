"""
Unified Vector Search Abstraction for NeuroBridge.

Provides semantic retrieval with two provider backends:
1. LocalExactVectorSearch (Default): In-database exact cosine-similarity scan.
   Zero extra cost, perfectly isolated per user, optimal for personal study libraries.
2. VertexAIVectorSearch: Cloud-scale vector search via Google Cloud Vertex AI Vector Search
   (formerly Matching Engine). Activated when VERTEX_VECTOR_SEARCH_ENABLED=true and
   VERTEX_VECTOR_SEARCH_ENDPOINT_ID / VERTEX_VECTOR_SEARCH_INDEX_ID are configured.
   Enforces strict metadata filtering on user_id to ensure absolute data isolation.

Fails soft: if Vertex AI Vector Search is unreachable or unconfigured, falls back
gracefully to the local exact search provider.
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from ..models import google_models
from . import google_ai_service, google_cloud

VERTEX_VECTOR_SEARCH_ENABLED = os.getenv("VERTEX_VECTOR_SEARCH_ENABLED", "false").lower() in ("true", "1")
VERTEX_VECTOR_SEARCH_INDEX_ID = os.getenv("VERTEX_VECTOR_SEARCH_INDEX_ID", "")
VERTEX_VECTOR_SEARCH_ENDPOINT_ID = os.getenv("VERTEX_VECTOR_SEARCH_ENDPOINT_ID", "")
VERTEX_LOCATION = os.getenv("VERTEX_AI_LOCATION") or os.getenv("GOOGLE_CLOUD_REGION") or "europe-west2"


class VectorSearchProvider(ABC):
    @abstractmethod
    def search(
        self,
        db: Session,
        user_id: str,
        query_vector: List[float],
        top_k: int = 5,
        min_score: float = 0.35,
        kind: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Retrieve the most relevant records for the user."""
        pass


class LocalExactVectorSearch(VectorSearchProvider):
    """Zero-cost, exact cosine similarity scan bounded to the user's records in the database."""

    def search(
        self,
        db: Session,
        user_id: str,
        query_vector: List[float],
        top_k: int = 5,
        min_score: float = 0.35,
        kind: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        if not query_vector:
            return []

        query = db.query(google_models.SemanticMemory).filter_by(user_id=user_id)
        if kind:
            query = query.filter_by(kind=kind)

        rows = query.order_by(google_models.SemanticMemory.id.desc()).limit(500).all()
        if not rows:
            return []

        scored = []
        for r in rows:
            sim = google_ai_service.cosine_similarity(query_vector, r.embedding or [])
            if sim >= min_score:
                scored.append({
                    "id": r.id,
                    "text": r.text,
                    "kind": r.kind,
                    "ref_id": r.ref_id,
                    "score": round(sim, 4),
                    "provider": "local_exact",
                })

        scored.sort(key=lambda s: s["score"], reverse=True)
        return scored[:top_k]


class VertexAIVectorSearch(VectorSearchProvider):
    """Google Cloud Vertex AI Vector Search with strict metadata filtering for user isolation."""

    def __init__(self, index_endpoint_id: str, index_id: str, location: str = "europe-west2"):
        self.index_endpoint_id = index_endpoint_id
        self.index_id = index_id
        self.location = location
        self._endpoint_client = None

    def _get_client(self):
        if self._endpoint_client is None:
            from google.cloud import aiplatform
            aiplatform.init(location=self.location)
            self._endpoint_client = aiplatform.MatchingEngineIndexEndpoint(
                index_endpoint_name=self.index_endpoint_id
            )
        return self._endpoint_client

    def search(
        self,
        db: Session,
        user_id: str,
        query_vector: List[float],
        top_k: int = 5,
        min_score: float = 0.35,
        kind: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        if not query_vector or not self.index_endpoint_id:
            return []

        try:
            endpoint = self._get_client()
            # Enforce user isolation via Vertex AI restricts/metadata filters
            restricts = [{"namespace": "user_id", "allow": [user_id]}]
            if kind:
                restricts.append({"namespace": "kind", "allow": [kind]})

            response = endpoint.find_neighbors(
                deployed_index_id=self.index_id,
                queries=[query_vector],
                num_neighbors=top_k,
                filter=restricts,
            )

            results: List[Dict[str, Any]] = []
            if response and len(response) > 0:
                neighbors = response[0]
                for n in neighbors:
                    sim = 1.0 - (n.distance / 2.0)  # Convert cosine distance to similarity
                    if sim >= min_score:
                        # Hydrate text from DB if ref stored
                        doc_id = int(n.id) if str(n.id).isdigit() else None
                        row = db.query(google_models.SemanticMemory).filter_by(id=doc_id, user_id=user_id).first() if doc_id else None
                        results.append({
                            "id": doc_id,
                            "text": row.text if row else "",
                            "kind": row.kind if row else "vertex_vector",
                            "ref_id": row.ref_id if row else None,
                            "score": round(sim, 4),
                            "provider": "vertex_vector_search",
                        })
            return results
        except Exception as e:
            google_cloud.log_structured(
                "vertex vector search error, falling back to local exact",
                error=type(e).__name__,
                details=str(e)[:200],
            )
            # Safe automatic fallback to local exact search
            fallback = LocalExactVectorSearch()
            return fallback.search(db, user_id, query_vector, top_k=top_k, min_score=min_score, kind=kind)


def get_vector_search_provider() -> VectorSearchProvider:
    """Factory returning the active vector search provider based on configuration."""
    if VERTEX_VECTOR_SEARCH_ENABLED and VERTEX_VECTOR_SEARCH_ENDPOINT_ID:
        return VertexAIVectorSearch(
            index_endpoint_id=VERTEX_VECTOR_SEARCH_ENDPOINT_ID,
            index_id=VERTEX_VECTOR_SEARCH_INDEX_ID,
            location=VERTEX_LOCATION,
        )
    return LocalExactVectorSearch()


def search_vectors(
    db: Session,
    user_id: str,
    query_vector: List[float],
    top_k: int = 5,
    min_score: float = 0.35,
    kind: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Central entrypoint for vector search queries across NeuroBridge."""
    provider = get_vector_search_provider()
    return provider.search(
        db=db,
        user_id=user_id,
        query_vector=query_vector,
        top_k=top_k,
        min_score=min_score,
        kind=kind,
    )
