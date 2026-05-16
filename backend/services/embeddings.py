"""
Geração de embeddings via Voyage AI (voyage-law-2).
Suporta batch com retry e rate-limit handling.
"""

import time
from tenacity import retry, stop_after_attempt, wait_exponential
import voyageai
from loguru import logger
from ..config import get_settings

settings = get_settings()

_client: voyageai.Client | None = None


def get_client() -> voyageai.Client:
    global _client
    if _client is None:
        _client = voyageai.Client(api_key=settings.voyage_api_key)
    return _client


BATCH_SIZE = 64   # limite prático do Voyage AI


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=10))
def _embed_batch(textos: list[str], input_type: str) -> list[list[float]]:
    client = get_client()
    result = client.embed(textos, model=settings.embedding_model, input_type=input_type)
    return result.embeddings


def embeddings_documentos(textos: list[str]) -> list[list[float]]:
    """Embeddings para chunks armazenados (input_type=document)."""
    return _embed_em_lotes(textos, "document")


def embedding_query(texto: str) -> list[float]:
    """Embedding para query do usuário (input_type=query)."""
    result = _embed_em_lotes([texto], "query")
    return result[0]


def _embed_em_lotes(textos: list[str], input_type: str) -> list[list[float]]:
    todos: list[list[float]] = []
    for i in range(0, len(textos), BATCH_SIZE):
        lote = textos[i : i + BATCH_SIZE]
        logger.debug(f"Embedding lote {i}–{i + len(lote)} ({input_type})")
        todos.extend(_embed_batch(lote, input_type))
        if i + BATCH_SIZE < len(textos):
            time.sleep(0.3)   # evita rate-limit
    return todos
