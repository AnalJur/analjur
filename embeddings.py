"""
embeddings.py — Geração de embeddings com Voyage AI (voyage-law-2)

Modelo voyage-law-2 é otimizado para texto jurídico em português e inglês.
Implementa batch processing e retry automático para respeitar rate limits.
"""

import os
import time
from typing import Optional
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_exponential
import voyageai
from dotenv import load_dotenv

from ingestao import Chunk

load_dotenv()

# ---------------------------------------------------------------------------
# Configuração
# ---------------------------------------------------------------------------

VOYAGE_MODEL = "voyage-law-2"
BATCH_SIZE = 32          # máximo recomendado pelo Voyage AI
MAX_TOKENS_BATCH = 120_000  # limite de tokens por batch


# ---------------------------------------------------------------------------
# Cliente
# ---------------------------------------------------------------------------

def get_client() -> voyageai.Client:
    api_key = os.getenv("VOYAGE_API_KEY")
    if not api_key:
        raise ValueError("VOYAGE_API_KEY não definida no .env")
    return voyageai.Client(api_key=api_key)


# ---------------------------------------------------------------------------
# Geração de embeddings
# ---------------------------------------------------------------------------

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=30),
)
def _embeddings_batch(textos: list[str], client: voyageai.Client) -> list[list[float]]:
    """Gera embeddings para um batch de textos com retry automático."""
    resultado = client.embed(
        texts=textos,
        model=VOYAGE_MODEL,
        input_type="document",
    )
    return resultado.embeddings


def gerar_embeddings_chunks(chunks: list[Chunk]) -> list[dict]:
    """
    Gera embeddings para uma lista de chunks.

    Retorna lista de dicts prontos para inserir no Supabase:
    {
        "processo_id": str,
        "chunk_index": int,
        "texto": str,
        "embedding": list[float],
        "tokens": int,
        "pagina_inicio": int,
        "pagina_fim": int,
        "tipo_peca": str,
        "autor": str,
        "data_doc": str,
    }
    """
    client = get_client()
    resultados = []
    total = len(chunks)

    logger.info(f"Gerando embeddings para {total} chunks com {VOYAGE_MODEL}...")

    for i in range(0, total, BATCH_SIZE):
        batch = chunks[i : i + BATCH_SIZE]
        textos = [c.texto for c in batch]

        try:
            logger.debug(f"Batch {i//BATCH_SIZE + 1} | chunks {i}–{i+len(batch)-1}")
            embeddings = _embeddings_batch(textos, client)

            for chunk, emb in zip(batch, embeddings):
                resultados.append({
                    "processo_id": chunk.processo_id,
                    "chunk_index": chunk.chunk_index,
                    "texto": chunk.texto,
                    "embedding": emb,
                    "tokens": chunk.tokens,
                    "pagina_inicio": chunk.pagina_inicio,
                    "pagina_fim": chunk.pagina_fim,
                    "tipo_peca": chunk.tipo_peca,
                    "autor": chunk.autor,
                    "data_doc": chunk.data_doc,
                })

            # Respeitar rate limit: 100 req/min
            if i + BATCH_SIZE < total:
                time.sleep(0.7)

        except Exception as e:
            logger.error(f"Falha no batch {i}–{i+len(batch)-1}: {e}")
            # Continuar com os outros batches mesmo se um falhar

    logger.info(f"Embeddings gerados: {len(resultados)}/{total}")
    return resultados


def gerar_embedding_query(query: str) -> list[float]:
    """
    Gera embedding para uma query do usuário.
    Usa input_type='query' para melhor similaridade com documentos.
    """
    client = get_client()
    resultado = client.embed(
        texts=[query],
        model=VOYAGE_MODEL,
        input_type="query",
    )
    return resultado.embeddings[0]


# ---------------------------------------------------------------------------
# Teste
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    # Teste simples
    test_textos = [
        "O autor requer a procedência da ação com base no artigo 186 do Código Civil.",
        "O réu contesta os fatos alegados na petição inicial, negando responsabilidade.",
    ]

    client = get_client()
    print(f"Gerando embeddings de teste com {VOYAGE_MODEL}...")
    embs = _embeddings_batch(test_textos, client)
    print(f"✓ Embeddings gerados: {len(embs)} vetores de dimensão {len(embs[0])}")

    q_emb = gerar_embedding_query("quais são os fundamentos do pedido?")
    print(f"✓ Embedding de query: dimensão {len(q_emb)}")
