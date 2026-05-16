import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from ..database import get_db
from ..models import Processo, Parte, Cronologia, Snapshot
from ..schemas import (
    ProcessoCreate, ProcessoUpdate, ProcessoOut,
    ParteCreate, ParteOut, CronologiaOut, SnapshotOut,
)
from ..services import audit_svc, snapshot_svc
from ..config import get_settings

router = APIRouter(prefix="/processos", tags=["Processos"])
settings = get_settings()

DEFAULT_TENANT = uuid.UUID(settings.default_tenant_id)
DEFAULT_USER   = uuid.UUID(settings.default_usuario_id)


@router.get("", response_model=list[ProcessoOut])
async def listar_processos(
    status: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    # Usa a view v_processos para obter contagens pré-calculadas
    filtro = "WHERE status = :status" if status else ""
    sql = text(f"SELECT * FROM v_processos {filtro} ORDER BY updated_at DESC LIMIT 200")
    params = {"status": status} if status else {}
    result = await db.execute(sql, params)
    rows = result.mappings().all()
    return [dict(r) for r in rows]


@router.post("", response_model=ProcessoOut, status_code=201)
async def criar_processo(body: ProcessoCreate, db: AsyncSession = Depends(get_db)):
    proc = Processo(
        tenant_id=DEFAULT_TENANT,
        created_by=DEFAULT_USER,
        **body.model_dump(),
    )
    db.add(proc)
    await db.flush()
    await audit_svc.registrar(db, "criar", "processo", proc.id,
                               dados_depois=body.model_dump(), usuario_id=DEFAULT_USER)
    await db.commit()
    await db.refresh(proc)
    return proc


@router.get("/{processo_id}", response_model=ProcessoOut)
async def obter_processo(processo_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text("SELECT * FROM v_processos WHERE id = :id").bindparams(id=processo_id)
    )
    row = result.mappings().first()
    if not row:
        raise HTTPException(404, "Processo não encontrado")
    return dict(row)


@router.patch("/{processo_id}", response_model=ProcessoOut)
async def atualizar_processo(
    processo_id: uuid.UUID,
    body: ProcessoUpdate,
    db: AsyncSession = Depends(get_db),
):
    proc = await db.get(Processo, processo_id)
    if not proc:
        raise HTTPException(404, "Processo não encontrado")

    antes = {"status": proc.status, "assunto": proc.assunto}
    for campo, valor in body.model_dump(exclude_none=True).items():
        setattr(proc, campo, valor)

    await audit_svc.registrar(db, "atualizar", "processo", processo_id,
                               dados_antes=antes, dados_depois=body.model_dump(exclude_none=True),
                               usuario_id=DEFAULT_USER)
    await db.commit()
    await db.refresh(proc)
    return proc


@router.delete("/{processo_id}", status_code=204)
async def deletar_processo(processo_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    proc = await db.get(Processo, processo_id)
    if not proc:
        raise HTTPException(404, "Processo não encontrado")
    await audit_svc.registrar(db, "deletar", "processo", processo_id, usuario_id=DEFAULT_USER)
    await db.delete(proc)
    await db.commit()


# ── Partes ────────────────────────────────────────────────────────────────

@router.get("/{processo_id}/partes", response_model=list[ParteOut])
async def listar_partes(processo_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Parte).where(Parte.processo_id == processo_id))
    return result.scalars().all()


@router.post("/{processo_id}/partes", response_model=ParteOut, status_code=201)
async def adicionar_parte(
    processo_id: uuid.UUID, body: ParteCreate, db: AsyncSession = Depends(get_db)
):
    parte = Parte(processo_id=processo_id, **body.model_dump())
    db.add(parte)
    await db.commit()
    await db.refresh(parte)
    return parte


# ── Cronologia ────────────────────────────────────────────────────────────

@router.get("/{processo_id}/cronologia", response_model=list[CronologiaOut])
async def obter_cronologia(processo_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Cronologia)
        .where(Cronologia.processo_id == processo_id)
        .order_by(Cronologia.data_evento.asc().nullslast())
    )
    return result.scalars().all()


@router.patch("/{processo_id}/cronologia/{evento_id}/validar", response_model=CronologiaOut)
async def validar_evento(
    processo_id: uuid.UUID, evento_id: uuid.UUID, db: AsyncSession = Depends(get_db)
):
    ev = await db.get(Cronologia, evento_id)
    if not ev or ev.processo_id != processo_id:
        raise HTTPException(404, "Evento não encontrado")
    ev.validado = True
    await db.commit()
    await db.refresh(ev)
    return ev


# ── Snapshots ─────────────────────────────────────────────────────────────

@router.get("/{processo_id}/snapshots", response_model=list[SnapshotOut])
async def listar_snapshots(processo_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Snapshot)
        .where(Snapshot.processo_id == processo_id)
        .order_by(Snapshot.versao.desc())
    )
    return result.scalars().all()


@router.post("/{processo_id}/snapshots", response_model=SnapshotOut, status_code=201)
async def criar_snapshot(processo_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    snap = await snapshot_svc.criar_snapshot(db, processo_id, "manual", DEFAULT_USER)
    await db.commit()
    return snap


@router.get("/{processo_id}/snapshots/{snap_id}", response_model=SnapshotOut)
async def obter_snapshot(
    processo_id: uuid.UUID, snap_id: uuid.UUID, db: AsyncSession = Depends(get_db)
):
    snap = await db.get(Snapshot, snap_id)
    if not snap or snap.processo_id != processo_id:
        raise HTTPException(404, "Snapshot não encontrado")
    return snap


@router.get("/{processo_id}/snapshots/comparar/{snap_a}/{snap_b}")
async def comparar(
    processo_id: uuid.UUID,
    snap_a: uuid.UUID,
    snap_b: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    return await snapshot_svc.comparar_snapshots(db, snap_a, snap_b)
