"""
Prazos processuais — CRUD + cumprimento + importação de análises IA.

Tabela Supabase (rodar uma vez no SQL Editor):

  CREATE TABLE IF NOT EXISTS prazos (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    processo_id      UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
    tenant_id        UUID,
    titulo           TEXT NOT NULL,
    descricao        TEXT,
    tipo             TEXT NOT NULL DEFAULT 'processual',
    fundamento_legal TEXT,
    data_inicio      DATE,
    prazo_dias       INTEGER,
    vencimento       DATE NOT NULL,
    status           TEXT NOT NULL DEFAULT 'em_aberto',
    prioridade       TEXT NOT NULL DEFAULT 'normal',
    responsavel      TEXT,
    observacoes      TEXT,
    created_by       UUID,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS prazos_processo_id_idx ON prazos(processo_id);
  CREATE INDEX IF NOT EXISTS prazos_vencimento_idx  ON prazos(vencimento);
"""

import uuid
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..database import get_supabase, sb_run
from ..schemas import PrazoCreate, PrazoUpdate, PrazoOut
from ..services import audit_svc
from ..config import get_settings

router = APIRouter(prefix="/processos/{processo_id}/prazos", tags=["Prazos"])
settings = get_settings()
DEFAULT_USER = uuid.UUID(settings.default_usuario_id)


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _serialize(v):
    """Converte date → str para inserção no Supabase."""
    if isinstance(v, date):
        return v.isoformat()
    return v


@router.get("", response_model=list[PrazoOut])
async def listar_prazos(
    processo_id: uuid.UUID,
    status: Optional[str] = Query(None),
):
    sb = get_supabase()
    q = (sb.table("prazos")
         .select("*")
         .eq("processo_id", str(processo_id))
         .order("vencimento", desc=False))
    if status:
        q = q.eq("status", status)
    result = await sb_run(q.execute)
    return result.data or []


@router.post("", response_model=PrazoOut, status_code=201)
async def criar_prazo(processo_id: uuid.UUID, body: PrazoCreate):
    sb = get_supabase()
    data = {
        "id":          str(uuid.uuid4()),
        "processo_id": str(processo_id),
        "created_by":  str(DEFAULT_USER),
        "updated_at":  _utcnow(),
        **{k: _serialize(v) for k, v in body.model_dump(exclude_none=True).items()},
    }
    result = await sb_run(lambda: sb.table("prazos").insert(data).execute())
    await audit_svc.registrar(
        "criar", "prazo", data["id"],
        dados_depois=body.model_dump(), usuario_id=DEFAULT_USER,
    )
    return result.data[0]


@router.patch("/{prazo_id}", response_model=PrazoOut)
async def atualizar_prazo(
    processo_id: uuid.UUID,
    prazo_id: uuid.UUID,
    body: PrazoUpdate,
):
    sb = get_supabase()
    dados = {k: _serialize(v) for k, v in body.model_dump(exclude_none=True).items()}
    if not dados:
        raise HTTPException(400, "Nenhum campo para atualizar")
    dados["updated_at"] = _utcnow()
    result = await sb_run(
        lambda: sb.table("prazos").update(dados)
        .eq("id", str(prazo_id))
        .eq("processo_id", str(processo_id))
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Prazo não encontrado")
    await audit_svc.registrar(
        "atualizar", "prazo", prazo_id,
        dados_depois=dados, usuario_id=DEFAULT_USER,
    )
    return result.data[0]


@router.patch("/{prazo_id}/cumprir", response_model=PrazoOut)
async def cumprir_prazo(processo_id: uuid.UUID, prazo_id: uuid.UUID):
    """Marca o prazo como cumprido."""
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("prazos")
        .update({"status": "cumprido", "updated_at": _utcnow()})
        .eq("id", str(prazo_id))
        .eq("processo_id", str(processo_id))
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Prazo não encontrado")
    await audit_svc.registrar("cumprir", "prazo", prazo_id, usuario_id=DEFAULT_USER)
    return result.data[0]


@router.patch("/{prazo_id}/reabrir", response_model=PrazoOut)
async def reabrir_prazo(processo_id: uuid.UUID, prazo_id: uuid.UUID):
    """Reabre prazo anteriormente marcado como cumprido/suspenso."""
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("prazos")
        .update({"status": "em_aberto", "updated_at": _utcnow()})
        .eq("id", str(prazo_id))
        .eq("processo_id", str(processo_id))
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Prazo não encontrado")
    await audit_svc.registrar("reabrir", "prazo", prazo_id, usuario_id=DEFAULT_USER)
    return result.data[0]


@router.delete("/{prazo_id}", status_code=204)
async def deletar_prazo(processo_id: uuid.UUID, prazo_id: uuid.UUID):
    sb = get_supabase()
    check = await sb_run(
        lambda: sb.table("prazos").select("id")
        .eq("id", str(prazo_id))
        .eq("processo_id", str(processo_id))
        .limit(1)
        .execute()
    )
    if not check.data:
        raise HTTPException(404, "Prazo não encontrado")
    await sb_run(
        lambda: sb.table("prazos").delete()
        .eq("id", str(prazo_id))
        .execute()
    )
    await audit_svc.registrar("deletar", "prazo", prazo_id, usuario_id=DEFAULT_USER)
