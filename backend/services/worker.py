"""
Worker de fila de jobs (polling-based, sem Redis).
Processa jobs pendentes da tabela jobs em background via supabase-py.
"""

import asyncio
import uuid
from datetime import datetime, timezone
from typing import Callable

from loguru import logger

from ..database import get_supabase, sb_run


HANDLERS: dict[str, Callable] = {}


def registrar(tipo: str):
    def decorator(fn: Callable):
        HANDLERS[tipo] = fn
        return fn
    return decorator


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


async def enfileirar(
    tipo: str,
    payload: dict,
    prioridade: int = 5,
    usuario_id: uuid.UUID | None = None,
) -> dict:
    sb = get_supabase()
    job_data = {
        "id": str(uuid.uuid4()),
        "tipo": tipo,
        "payload": payload,
        "prioridade": prioridade,
        "status": "pendente",
        "tentativas": 0,
        "max_tentativas": 3,
        "scheduled_for": _utcnow(),
        "criado_por": str(usuario_id) if usuario_id else None,
    }
    result = await sb_run(lambda: sb.table("jobs").insert(job_data).execute())
    return result.data[0]


async def processar_proximo() -> bool:
    sb = get_supabase()

    result = await sb_run(
        lambda: sb.table("jobs")
        .select("*")
        .eq("status", "pendente")
        .lte("scheduled_for", _utcnow())
        .order("prioridade", desc=False)
        .order("scheduled_for", desc=False)
        .limit(5)
        .execute()
    )

    candidatos = [j for j in (result.data or []) if j["tentativas"] < j.get("max_tentativas", 3)]
    if not candidatos:
        return False

    job = candidatos[0]
    job_id = job["id"]

    # Atualização atômica: só marca processando se ainda estiver pendente
    upd = await sb_run(
        lambda: sb.table("jobs")
        .update({
            "status": "processando",
            "started_at": _utcnow(),
            "tentativas": job["tentativas"] + 1,
        })
        .eq("id", job_id)
        .eq("status", "pendente")
        .execute()
    )

    if not upd.data:
        return False

    job = upd.data[0]

    handler = HANDLERS.get(job["tipo"])
    if not handler:
        await sb_run(
            lambda: sb.table("jobs").update({
                "status": "erro",
                "erro_msg": f"Handler não registrado: {job['tipo']}",
                "finished_at": _utcnow(),
            }).eq("id", job_id).execute()
        )
        return True

    try:
        resultado = await handler(job["payload"])
        await sb_run(
            lambda: sb.table("jobs").update({
                "status": "concluido",
                "resultado": resultado or {},
                "finished_at": _utcnow(),
            }).eq("id", job_id).execute()
        )
    except Exception as e:
        logger.error(f"Job {job_id} ({job['tipo']}) falhou: {e}")
        tentativas_usadas = job["tentativas"] + 1
        novo_status = "pendente" if tentativas_usadas < job.get("max_tentativas", 3) else "erro"
        await sb_run(
            lambda: sb.table("jobs").update({
                "status": novo_status,
                "erro_msg": str(e),
                "finished_at": _utcnow(),
            }).eq("id", job_id).execute()
        )

    return True


async def loop_worker(intervalo_sec: float = 2.0):
    logger.info("Worker iniciado")
    while True:
        try:
            processou = await processar_proximo()
            if not processou:
                await asyncio.sleep(intervalo_sec)
        except Exception as e:
            logger.error(f"Erro no worker loop: {e}")
            await asyncio.sleep(5)


# ── Handlers ────────────────────────────────────────────────────────────────

@registrar("snapshot")
async def handle_snapshot(payload: dict) -> dict:
    from ..services.snapshot_svc import criar_snapshot
    snap = await criar_snapshot(
        processo_id=uuid.UUID(payload["processo_id"]),
        trigger=payload.get("trigger", "automatico"),
        criado_por=uuid.UUID(payload["criado_por"]) if payload.get("criado_por") else None,
    )
    return {"snapshot_id": snap["id"], "versao": snap["versao"]}
