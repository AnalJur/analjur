"""
Geração de embeddings via Voyage AI (voyage-law-2).
"""

import asyncio
import time
import functools
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
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


BATCH_SIZE = 32   # reduzido para respeitar rate limit


@retry(
    retry=retry_if_exception_type(Exception),
    stop=stop_after_attempt(5),
    wait=wait_exponential(min=5, max=60),
    reraise=True,
)
def _embed_batch(textos: list[str], input_type: str) -> list[list[float]]:
    client = get_client()
    result = client.embed(textos, model=settings.embedding_model, input_type=input_type)
    return result.embeddings


def _embed_em_lotes_sync(textos: list[str], input_type: str) -> list[list[float]]:
    todos: list[list[float]] = []
    for i in range(0, len(textos), BATCH_SIZE):
        lote = textos[i : i + BATCH_SIZE]
        logger.debug(f"Embedding lote {i}–{i + len(lote)} ({input_type})")
        todos.extend(_embed_batch(lote, input_type))
        if i + BATCH_SIZE < len(textos):
            time.sleep(1.0)
    return todos


async def embeddings_documentos(textos: list[str]) -> list[list[float]]:
    """Embeddings para chunks (input_type=document). Roda na thread pool."""
    loop = asyncio.get_event_loop()
    fn = functools.partial(_embed_em_lotes_sync, textos, "document")
    return await loop.run_in_executor(None, fn)


async def embedding_query(texto: str) -> list[float]:
    """Embedding para query do usuário (input_type=query). Roda na thread pool."""
    loop = asyncio.get_event_loop()
    fn = functools.partial(_embed_em_lotes_sync, [texto], "query")
    result = await loop.run_in_executor(None, fn)
    return result[0]
