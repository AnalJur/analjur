"""
database.py — Conexão com Supabase e operações de banco de dados

Usa pgvector para busca por similaridade semântica.
"""

import os
from typing import Optional
from loguru import logger
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

TABLE_NAME = "chunks_processuais"


def get_supabase() -> Client:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise ValueError("SUPABASE_URL e SUPABASE_SERVICE_KEY devem estar no .env")
    return create_client(url, key)


def inserir_chunks(chunks_com_embeddings: list[dict]) -> int:
    """
    Insere chunks com embeddings no Supabase.
    Retorna número de chunks inseridos com sucesso.
    """
    sb = get_supabase()
    LOTE = 50
    inseridos = 0

    for i in range(0, len(chunks_com_embeddings), LOTE):
        lote = chunks_com_embeddings[i : i + LOTE]
        try:
            sb.table(TABLE_NAME).insert(lote).execute()
            inseridos += len(lote)
            logger.debug(f"Inseridos {inseridos}/{len(chunks_com_embeddings)} chunks")
        except Exception as e:
            logger.error(f"Erro ao inserir lote {i}–{i+len(lote)}: {e}")

    return inseridos


def buscar_chunks_similares(
    embedding_query: list[float],
    processo_id: str,
    top_k: int = 8,
    tipo_peca: Optional[str] = None,
) -> list[dict]:
    """
    Busca os chunks mais similares à query usando pgvector.

    Args:
        embedding_query: Vetor da query (gerado por Voyage AI)
        processo_id: Filtrar por processo específico
        top_k: Número de chunks a retornar
        tipo_peca: Filtrar por tipo de peça (opcional)

    Returns:
        Lista de chunks ordenados por similaridade
    """
    sb = get_supabase()

    try:
        params = {
            "query_embedding": embedding_query,
            "processo_id_filter": processo_id,
            "match_count": top_k,
        }
        if tipo_peca:
            params["tipo_peca_filter"] = tipo_peca

        result = sb.rpc("buscar_chunks_similares", params).execute()
        return result.data or []

    except Exception as e:
        logger.error(f"Erro na busca vetorial: {e}")
        return []


def listar_processos() -> list[dict]:
    """Lista todos os processos cadastrados."""
    sb = get_supabase()
    try:
        result = (
            sb.table(TABLE_NAME)
            .select("processo_id, tipo_peca, pagina_inicio, pagina_fim")
            .execute()
        )
        # Agrupar por processo_id
        processos = {}
        for row in result.data:
            pid = row["processo_id"]
            if pid not in processos:
                processos[pid] = {
                    "processo_id": pid,
                    "total_chunks": 0,
                    "tipos_peca": set(),
                }
            processos[pid]["total_chunks"] += 1
            processos[pid]["tipos_peca"].add(row["tipo_peca"])

        return [
            {**p, "tipos_peca": list(p["tipos_peca"])}
            for p in processos.values()
        ]
    except Exception as e:
        logger.error(f"Erro ao listar processos: {e}")
        return []


def deletar_processo(processo_id: str) -> bool:
    """Remove todos os chunks de um processo."""
    sb = get_supabase()
    try:
        sb.table(TABLE_NAME).delete().eq("processo_id", processo_id).execute()
        logger.info(f"Processo {processo_id} removido")
        return True
    except Exception as e:
        logger.error(f"Erro ao deletar processo: {e}")
        return False


