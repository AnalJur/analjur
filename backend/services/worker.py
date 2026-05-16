"""
Worker de fila de jobs (polling-based, sem Redis).
Processa jobs pendentes da tabela jobs em background.
"""

import asyncio
import uuid
from datetime import datetime
from typing import Callable

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from loguru import logger

from ..models import Job
from ..database import AsyncSessionLocal


HANDLERS: dict[str, Callable] = {}


def registrar(tipo: str):
    """Decorator para registrar handlers de job."""
    def decorator(fn: Callable):
        HANDLERS[tipo] = fn
        return fn
    return decorator


async def enfileirar(
    db: AsyncSession,
    tipo: str,
    payload: dict,
    prioridade: int = 5,
    usuario_id: uuid.UUID | None = None,
) -> Job:
    job = Job(tipo=tipo, payload=payload, prioridade=prioridade, criado_por=usuario_id)
    db.add(job)
    await db.flush()
    return job


async def processar_proximo() -> bool:
    """Pega e processa o próximo job pendente. Retorna True se processou algo."""
    async with AsyncSessionLocal() as db:
        # Busca o job mais prioritário e mais antigo
        result = await db.execute(
            select(Job)
            .where(Job.status == "pendente", Job.tentativas < Job.max_tentativas)
            .order_by(Job.prioridade.asc(), Job.scheduled_for.asc())
            .limit(1)
            .with_for_update(skip_locked=True)   # evita processamento duplicado
        )
        job = result.scalar_one_or_none()
        if not job:
            return False

        # Marca como processando
        job.status = "processando"
        job.started_at = datetime.utcnow()
        job.tentativas += 1
        await db.commit()

        handler = HANDLERS.get(job.tipo)
        if not handler:
            job.status = "erro"
            job.erro_msg = f"Handler não registrado: {job.tipo}"
            job.finished_at = datetime.utcnow()
            await db.commit()
            return True

        try:
            resultado = await handler(job.payload)
            job.status = "concluido"
            job.resultado = resultado or {}
        except Exception as e:
            logger.error(f"Job {job.id} ({job.tipo}) falhou: {e}")
            job.status = "pendente" if job.tentativas < job.max_tentativas else "erro"
            job.erro_msg = str(e)
        finally:
            job.finished_at = datetime.utcnow()
            await db.commit()

        return True


async def loop_worker(intervalo_sec: float = 2.0):
    """Loop principal do worker. Rode em background com asyncio.create_task."""
    logger.info("Worker iniciado")
    while True:
        try:
            processou = await processar_proximo()
            if not processou:
                await asyncio.sleep(intervalo_sec)
        except Exception as e:
            logger.error(f"Erro no worker loop: {e}")
            await asyncio.sleep(5)


# ── Handlers registrados ────────────────────────────────────────────────

@registrar("snapshot")
async def handle_snapshot(payload: dict) -> dict:
    from ..services.snapshot_svc import criar_snapshot
    from ..database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        snap = await criar_snapshot(
            db,
            processo_id=uuid.UUID(payload["processo_id"]),
            trigger=payload.get("trigger", "automatico"),
            criado_por=uuid.UUID(payload["criado_por"]) if payload.get("criado_por") else None,
        )
        await db.commit()
        return {"snapshot_id": str(snap.id), "versao": snap.versao}
