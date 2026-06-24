"""
Módulo de Clientes — CRUD + vínculo com processos.
"""

import uuid
from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..database import get_supabase, sb_run

router = APIRouter(prefix="/clientes", tags=["Clientes"])


# ── Schemas ───────────────────────────────────────────────────────────────

class ClienteCreate(BaseModel):
    nome: str
    tipo: str = "pf"
    cpf_cnpj: Optional[str] = None
    email: Optional[str] = None
    telefone: Optional[str] = None
    endereco: Optional[str] = None
    observacoes: Optional[str] = None


class ClienteUpdate(BaseModel):
    nome: Optional[str] = None
    tipo: Optional[str] = None
    cpf_cnpj: Optional[str] = None
    email: Optional[str] = None
    telefone: Optional[str] = None
    endereco: Optional[str] = None
    observacoes: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────

@router.get("")
async def listar_clientes():
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("v_clientes").select("*").order("nome").execute()
    )
    return result.data or []


@router.post("", status_code=201)
async def criar_cliente(body: ClienteCreate):
    sb = get_supabase()
    row = {k: v for k, v in body.model_dump().items() if v is not None}
    result = await sb_run(lambda: sb.table("clientes").insert(row).execute())
    if not result.data:
        raise HTTPException(500, "Erro ao criar cliente")
    novo_id = result.data[0]["id"]
    view = await sb_run(
        lambda: sb.table("v_clientes").select("*").eq("id", novo_id).limit(1).execute()
    )
    return view.data[0] if view.data else result.data[0]


@router.get("/{cliente_id}")
async def obter_cliente(cliente_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("v_clientes").select("*").eq("id", str(cliente_id)).limit(1).execute()
    )
    if not result.data:
        raise HTTPException(404, "Cliente não encontrado")
    return result.data[0]


@router.patch("/{cliente_id}")
async def atualizar_cliente(cliente_id: uuid.UUID, body: ClienteUpdate):
    sb = get_supabase()
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    upd["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await sb_run(
        lambda: sb.table("clientes").update(upd).eq("id", str(cliente_id)).execute()
    )
    if not result.data:
        raise HTTPException(404, "Cliente não encontrado")
    view = await sb_run(
        lambda: sb.table("v_clientes").select("*").eq("id", str(cliente_id)).limit(1).execute()
    )
    return view.data[0] if view.data else result.data[0]


@router.delete("/{cliente_id}", status_code=204)
async def deletar_cliente(cliente_id: uuid.UUID):
    sb = get_supabase()
    await sb_run(
        lambda: sb.table("clientes").delete().eq("id", str(cliente_id)).execute()
    )


@router.get("/{cliente_id}/processos")
async def processos_do_cliente(cliente_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("v_processos")
        .select("*")
        .eq("cliente_id", str(cliente_id))
        .order("updated_at", desc=True)
        .execute()
    )
    return result.data or []


@router.patch("/{cliente_id}/vincular-processo/{processo_id}", status_code=200)
async def vincular_processo(cliente_id: uuid.UUID, processo_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("processos")
        .update({"cliente_id": str(cliente_id)})
        .eq("id", str(processo_id))
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Processo não encontrado")
    return {"ok": True}


@router.delete("/{cliente_id}/vincular-processo/{processo_id}", status_code=200)
async def desvincular_processo(cliente_id: uuid.UUID, processo_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("processos")
        .update({"cliente_id": None})
        .eq("id", str(processo_id))
        .eq("cliente_id", str(cliente_id))
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Vínculo não encontrado")
    return {"ok": True}
