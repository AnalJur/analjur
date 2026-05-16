import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..database import get_db
from ..models import Analise
from ..schemas import AnaliseSolicitacao, AnaliseOut, ChatRequest, ChatResponse
from ..services.analise_ia import gerar_analise, chat_processo
from ..services import audit_svc
from ..config import get_settings

router = APIRouter(prefix="/processos/{processo_id}/analises", tags=["Análises"])
settings = get_settings()
DEFAULT_USER = uuid.UUID(settings.default_usuario_id)


@router.get("", response_model=list[AnaliseOut])
async def listar_analises(
    processo_id: uuid.UUID,
    tipo: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    q = select(Analise).where(Analise.processo_id == processo_id)
    if tipo:
        q = q.where(Analise.tipo == tipo)
    q = q.order_by(Analise.created_at.desc())
    result = await db.execute(q)
    return result.scalars().all()


@router.post("", response_model=AnaliseOut, status_code=201)
async def solicitar_analise(
    processo_id: uuid.UUID,
    body: AnaliseSolicitacao,
    db: AsyncSession = Depends(get_db),
):
    try:
        analise = await gerar_analise(
            db, processo_id, body.tipo,
            usuario_id=DEFAULT_USER,
            contexto_extra=body.contexto_extra,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    await audit_svc.registrar(db, "criar", "analise", analise.id,
                               dados_depois={"tipo": body.tipo}, usuario_id=DEFAULT_USER)
    await db.commit()
    await db.refresh(analise)
    return analise


@router.get("/{analise_id}", response_model=AnaliseOut)
async def obter_analise(
    processo_id: uuid.UUID, analise_id: uuid.UUID, db: AsyncSession = Depends(get_db)
):
    analise = await db.get(Analise, analise_id)
    if not analise or analise.processo_id != processo_id:
        raise HTTPException(404, "Análise não encontrada")
    return analise


@router.post("/{analise_id}/aprovar", response_model=AnaliseOut)
async def aprovar_analise(
    processo_id: uuid.UUID, analise_id: uuid.UUID,
    comentario: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    analise = await db.get(Analise, analise_id)
    if not analise or analise.processo_id != processo_id:
        raise HTTPException(404, "Análise não encontrada")

    from datetime import datetime
    analise.status_revisao = "aprovada"
    analise.revisado_por = DEFAULT_USER
    analise.revisado_at = datetime.utcnow()
    if comentario:
        analise.comentario_revisao = comentario

    await audit_svc.registrar(db, "aprovar", "analise", analise_id,
                               dados_depois={"status": "aprovada"}, usuario_id=DEFAULT_USER)
    await db.commit()
    await db.refresh(analise)
    return analise


@router.post("/{analise_id}/rejeitar", response_model=AnaliseOut)
async def rejeitar_analise(
    processo_id: uuid.UUID, analise_id: uuid.UUID,
    comentario: str,
    db: AsyncSession = Depends(get_db),
):
    analise = await db.get(Analise, analise_id)
    if not analise or analise.processo_id != processo_id:
        raise HTTPException(404, "Análise não encontrada")

    from datetime import datetime
    analise.status_revisao = "rejeitada"
    analise.revisado_por = DEFAULT_USER
    analise.revisado_at = datetime.utcnow()
    analise.comentario_revisao = comentario

    await audit_svc.registrar(db, "rejeitar", "analise", analise_id,
                               dados_depois={"status": "rejeitada", "comentario": comentario},
                               usuario_id=DEFAULT_USER)
    await db.commit()
    await db.refresh(analise)
    return analise


# ── Chat ──────────────────────────────────────────────────────────────────

@router.post("/chat", response_model=ChatResponse, tags=["Chat"])
async def chat(body: ChatRequest, db: AsyncSession = Depends(get_db)):
    try:
        resposta, fontes, tokens = await chat_processo(
            processo_id=body.processo_id,
            mensagens=[m.model_dump() for m in body.mensagens],
            tipo_peca=body.tipo_peca,
        )
    except Exception as e:
        raise HTTPException(500, str(e))
    return ChatResponse(resposta=resposta, fontes=fontes, tokens=tokens)
