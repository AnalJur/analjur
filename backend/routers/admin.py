"""
Endpoints administrativos: audit log, dashboard operacional, configurações.
"""

import uuid
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text

from ..database import get_db
from ..models import AuditLog, Processo, Documento, TarefaRevisao, Analise

router = APIRouter(prefix="/admin", tags=["Admin / Governança"])


@router.get("/dashboard")
async def dashboard_operacional(db: AsyncSession = Depends(get_db)):
    """Métricas operacionais consolidadas."""
    processos   = await db.scalar(select(func.count()).select_from(Processo))
    documentos  = await db.scalar(select(func.count()).select_from(Documento).where(Documento.status == "processado"))
    tarefas_pend = await db.scalar(select(func.count()).select_from(TarefaRevisao).where(TarefaRevisao.status == "pendente"))
    analises_pend = await db.scalar(select(func.count()).select_from(Analise).where(Analise.status_revisao == "pendente"))

    return {
        "total_processos":         processos,
        "total_documentos":        documentos,
        "tarefas_pendentes":       tarefas_pend,
        "analises_pendentes_revisao": analises_pend,
    }


@router.get("/audit")
async def listar_audit(
    entidade: str | None = Query(None),
    usuario_id: uuid.UUID | None = Query(None),
    limit: int = Query(50, le=500),
    db: AsyncSession = Depends(get_db),
):
    q = select(AuditLog)
    if entidade:
        q = q.where(AuditLog.entidade == entidade)
    if usuario_id:
        q = q.where(AuditLog.usuario_id == usuario_id)
    q = q.order_by(AuditLog.created_at.desc()).limit(limit)
    result = await db.execute(q)
    logs = result.scalars().all()
    return [
        {
            "id":          str(l.id),
            "acao":        l.acao,
            "entidade":    l.entidade,
            "entidade_id": str(l.entidade_id) if l.entidade_id else None,
            "usuario_id":  str(l.usuario_id) if l.usuario_id else None,
            "created_at":  l.created_at.isoformat(),
        }
        for l in logs
    ]
