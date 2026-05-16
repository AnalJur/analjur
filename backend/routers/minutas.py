import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..database import get_db
from ..models import Minuta
from ..schemas import MinutaSolicitacao, MinutaUpdate, MinutaOut
from ..services.minuta_svc import gerar_minuta, salvar_versao
from ..services import audit_svc
from ..config import get_settings

router = APIRouter(prefix="/processos/{processo_id}/minutas", tags=["Minutas"])
settings = get_settings()
DEFAULT_USER = uuid.UUID(settings.default_usuario_id)


@router.get("", response_model=list[MinutaOut])
async def listar_minutas(processo_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Minuta).where(Minuta.processo_id == processo_id).order_by(Minuta.created_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=MinutaOut, status_code=201)
async def solicitar_minuta(
    processo_id: uuid.UUID, body: MinutaSolicitacao, db: AsyncSession = Depends(get_db)
):
    try:
        minuta = await gerar_minuta(
            db,
            processo_id=processo_id,
            tipo=body.tipo,
            titulo=body.titulo,
            instrucoes=body.instrucoes,
            usuario_id=DEFAULT_USER,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    await audit_svc.registrar(db, "criar", "minuta", minuta.id,
                               dados_depois={"tipo": body.tipo, "titulo": body.titulo},
                               usuario_id=DEFAULT_USER)
    await db.commit()
    await db.refresh(minuta)
    return minuta


@router.get("/{minuta_id}", response_model=MinutaOut)
async def obter_minuta(
    processo_id: uuid.UUID, minuta_id: uuid.UUID, db: AsyncSession = Depends(get_db)
):
    minuta = await db.get(Minuta, minuta_id)
    if not minuta or minuta.processo_id != processo_id:
        raise HTTPException(404, "Minuta não encontrada")
    return minuta


@router.patch("/{minuta_id}", response_model=MinutaOut)
async def editar_minuta(
    processo_id: uuid.UUID, minuta_id: uuid.UUID,
    body: MinutaUpdate, db: AsyncSession = Depends(get_db),
):
    minuta = await db.get(Minuta, minuta_id)
    if not minuta or minuta.processo_id != processo_id:
        raise HTTPException(404, "Minuta não encontrada")

    if body.conteudo_md and body.conteudo_md != minuta.conteudo_md:
        await salvar_versao(db, minuta_id, body.conteudo_md, DEFAULT_USER)
    elif body.titulo:
        minuta.titulo = body.titulo
    if body.status:
        minuta.status = body.status
        if body.status == "aprovado":
            from datetime import datetime
            minuta.revisado_por = DEFAULT_USER
            minuta.revisado_at = datetime.utcnow()

    await audit_svc.registrar(db, "atualizar", "minuta", minuta_id,
                               dados_depois=body.model_dump(exclude_none=True),
                               usuario_id=DEFAULT_USER)
    await db.commit()
    await db.refresh(minuta)
    return minuta


@router.delete("/{minuta_id}", status_code=204)
async def deletar_minuta(
    processo_id: uuid.UUID, minuta_id: uuid.UUID, db: AsyncSession = Depends(get_db)
):
    minuta = await db.get(Minuta, minuta_id)
    if not minuta or minuta.processo_id != processo_id:
        raise HTTPException(404, "Minuta não encontrada")
    await db.delete(minuta)
    await db.commit()
