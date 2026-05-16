"""
Recuperação de chunks relevantes via pgvector (Supabase RPC).
"""

import uuid
from typing import Optional
from loguru import logger
from ..database import get_supabase
from .embeddings import embedding_query


def buscar_chunks(
    processo_id: uuid.UUID,
    query: str,
    top_k: int = 8,
    tipo_peca: Optional[str] = None,
) -> list[dict]:
    """Retorna chunks ordenados por similaridade semântica."""
    vetor = embedding_query(query)
    sb = get_supabase()

    params: dict = {
        "query_embedding": vetor,
        "p_processo_id":   str(processo_id),
        "match_count":     top_k,
    }
    if tipo_peca:
        params["p_tipo_peca"] = tipo_peca

    try:
        result = sb.rpc("buscar_chunks", params).execute()
        return result.data or []
    except Exception as e:
        logger.error(f"Erro na busca vetorial: {e}")
        return []


def formatar_contexto(chunks: list[dict]) -> str:
    """Formata chunks em bloco de contexto para o prompt."""
    partes = []
    for i, c in enumerate(chunks, 1):
        meta = f"[{i}] {c.get('tipo_peca', '?')} — pág. {c.get('pagina', '?')} (sim={c.get('similarity', 0):.2f})"
        partes.append(f"{meta}\n{c['conteudo']}")
    return "\n\n---\n\n".join(partes)
