import uuid
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..database import get_db
from ..models import TarefaRevisao
from ..schemas import TarefaCreate, TarefaUpdate, TarefaOut
from ..services import audit_svc
from ..config import get_settings

router = APIRouter(prefix="/revisao", tags=["Revisão Humana"])
settings = get_settings()
DEFAULT_USER = uuid.UUID(settings.default_usuario_id)


@router.get("/tarefas", response_model=list[TarefaOut])
async def listar_tarefas(
    status: Optional[str] = Query(None),
    processo_id: Optional[uuid.UUID] = Query(None),
    prioridade: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    q = select(TarefaRevisao)
    if status:
        q = q.where(TarefaRevisao.status == status)
    if processo_id:
        q = q.where(TarefaRevisao.processo_id == processo_id)
    if prioridade:
        q = q.where(TarefaRevisao.prioridade == prioridade)
    q = q.order_by(TarefaRevisao.created_at.desc()).limit(200)
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/tarefas", response_model=TarefaOut, status_code=201)
async def criar_tarefa(body: TarefaCreate, db: AsyncSession = Depends(get_db)):
    tarefa = TarefaRevisao(atribuido_por=DEFAULT_USER, **body.model_dump())
    db.add(tarefa)
    await db.commit()
    await db.refresh(tarefa)
    return tarefa


@router.get("/tarefas/{tarefa_id}", response_model=TarefaOut)
async def obter_tarefa(tarefa_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    tarefa = await db.get(TarefaRevisao, tarefa_id)
    if not tarefa:
        raise HTTPException(404, "Tarefa não encontrada")
    return tarefa


@router.patch("/tarefas/{tarefa_id}", response_model=TarefaOut)
async def atualizar_tarefa(
    tarefa_id: uuid.UUID, body: TarefaUpdate, db: AsyncSession = Depends(get_db)
):
    tarefa = await db.get(TarefaRevisao, tarefa_id)
    if not tarefa:
        raise HTTPException(404, "Tarefa não encontrada")

    antes = {"status": tarefa.status}
    for campo, valor in body.model_dump(exclude_none=True).items():
        setattr(tarefa, campo, valor)

    # Se aprovando ou rejeitando, registra quem e quando
    if body.status in ("aprovado", "rejeitado", "cancelado"):
        tarefa.concluido_por = DEFAULT_USER
        tarefa.concluido_at = datetime.utcnow()

    await audit_svc.registrar(db, "atualizar", "tarefa", tarefa_id,
                               dados_antes=antes, dados_depois=body.model_dump(exclude_none=True),
                               usuario_id=DEFAULT_USER)
    await db.commit()
    await db.refresh(tarefa)
    return tarefa


@router.get("/resumo")
async def resumo_revisao(db: AsyncSession = Depends(get_db)):
    """Contagem de tarefas por status — para dashboard operacional."""
    from sqlalchemy import func, case
    result = await db.execute(
        select(
            TarefaRevisao.status,
            TarefaRevisao.prioridade,
            func.count().label("total"),
        ).group_by(TarefaRevisao.status, TarefaRevisao.prioridade)
    )
    rows = result.all()
    return [{"status": r.status, "prioridade": r.prioridade, "total": r.total} for r in rows]
