"""
Worker de integração — processa fila de integracoes_eventos.

Executado como background task no startup da aplicação.
Intervalo: a cada 30 segundos.
Backoff: 30s → 5min → 30min → 2h → 24h (máx 5 tentativas).
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone

from loguru import logger

from ..database import get_supabase, sb_run
from ..services import webhook_svc

# URL de destino para envio de eventos — configurável via env
_GESTOR360_WEBHOOK_URL = os.getenv("GESTOR360_WEBHOOK_URL", "")
_WORKER_INTERVALO_SEC = 30
_LOTE_MAX = 20


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _buscar_hmac_secret(sistema: str = "gestor360") -> str:
    sb = get_supabase()
    rows = await sb_run(
        sb.table("integracoes_chaves")
        .select("hmac_secret")
        .eq("sistema", sistema)
        .eq("ativo", True)
        .limit(1)
    )
    if rows:
        return rows[0]["hmac_secret"]
    return os.getenv("GESTOR360_HMAC_SECRET", "")


async def _processar_lote() -> int:
    """Busca e processa eventos pendentes prontos para retry. Retorna quantidade processada."""
    if not _GESTOR360_WEBHOOK_URL:
        return 0

    sb = get_supabase()
    agora = _utcnow_iso()

    rows = await sb_run(
        sb.table("integracoes_eventos")
        .select("*")
        .in_("status", ["pendente", "erro"])
        .lte("proximo_retry", agora)
        .eq("direcao", "enviado")
        .order("proximo_retry")
        .limit(_LOTE_MAX)
    )

    if not rows:
        return 0

    hmac_secret = await _buscar_hmac_secret()
    processados = 0

    for evento in rows:
        try:
            await webhook_svc.entregar_evento(
                evento_row=evento,
                destino_url=_GESTOR360_WEBHOOK_URL,
                hmac_secret=hmac_secret,
            )
            processados += 1
        except Exception as e:
            logger.error(f"Erro inesperado no worker ao processar {evento['event_id']}: {e}")

    return processados


async def loop_integracao(intervalo_sec: float = _WORKER_INTERVALO_SEC) -> None:
    """Loop infinito — deve ser iniciado como asyncio task no lifespan da aplicação."""
    logger.info("Worker de integração iniciado")
    while True:
        try:
            processados = await _processar_lote()
            if processados:
                logger.info(f"Worker integração: {processados} eventos processados")
        except Exception as e:
            logger.error(f"Worker integração — erro no ciclo: {e}")
        await asyncio.sleep(intervalo_sec)
