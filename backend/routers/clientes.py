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

    # Tenta pela view com aggregates
    result = await sb_run(
        lambda: sb.table("v_clientes").select("*").eq("id", str(cliente_id)).limit(1).execute()
    )
    if result.data:
        return result.data[0]

    # Fallback: tabela direta + calcula aggregates manualmente
    raw = await sb_run(
        lambda: sb.table("clientes").select("*").eq("id", str(cliente_id)).limit(1).execute()
    )
    if not raw.data:
        raise HTTPException(404, "Cliente não encontrado")

    c = raw.data[0]
    procs = await sb_run(
        lambda: sb.table("processos")
        .select("id,status,updated_at")
        .eq("cliente_id", str(cliente_id))
        .execute()
    )
    ps = procs.data or []
    ativos = sum(1 for p in ps if p.get("status") == "ativo")
    ultima = max((p["updated_at"] for p in ps), default=None)
    return {
        **c,
        "total_processos": len(ps),
        "processos_ativos": ativos,
        "ultima_movimentacao": ultima,
        "cliente_nome": c.get("nome"),
    }


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
    # Tenta v_processos (tem agregados); v_processos pode não ter cliente_id se criada antes da migration
    try:
        view = await sb_run(
            lambda: sb.table("v_processos")
            .select("*")
            .eq("cliente_id", str(cliente_id))
            .order("updated_at", desc=True)
            .execute()
        )
        if view.data:
            return view.data
    except Exception:
        pass
    # Fallback: tabela direta
    raw = await sb_run(
        lambda: sb.table("processos")
        .select("*")
        .eq("cliente_id", str(cliente_id))
        .order("updated_at", desc=True)
        .execute()
    )
    return raw.data or []


@router.get("/{cliente_id}/resumo")
async def resumo_cliente(cliente_id: uuid.UUID):
    """Retorna horas trabalhadas e resumo financeiro do cliente."""
    sb = get_supabase()

    # IDs dos processos do cliente
    procs = await sb_run(
        lambda: sb.table("processos").select("id").eq("cliente_id", str(cliente_id)).execute()
    )
    proc_ids = [p["id"] for p in (procs.data or [])]

    total_horas = 0.0
    total_honorarios = 0.0
    total_recebido = 0.0
    total_pendente = 0.0

    if proc_ids:
        # Horas de timesheet
        try:
            ts = await sb_run(
                lambda: sb.table("timesheet").select("duracao_min").in_("processo_id", proc_ids).execute()
            )
            total_horas = round(sum(r.get("duracao_min", 0) for r in (ts.data or [])) / 60.0, 1)
        except Exception:
            pass

    # Honorários por cliente
    try:
        hon = await sb_run(
            lambda: sb.table("honorarios")
            .select("id, valor_total")
            .eq("cliente_id", str(cliente_id))
            .execute()
        )
        for h in (hon.data or []):
            total_honorarios += h.get("valor_total", 0) or 0

        hon_ids = [h["id"] for h in (hon.data or [])]
        if hon_ids:
            parc = await sb_run(
                lambda: sb.table("parcelas_honorario")
                .select("valor, status")
                .in_("honorario_id", hon_ids)
                .execute()
            )
            for p in (parc.data or []):
                v = p.get("valor", 0) or 0
                if p.get("status") == "pago":
                    total_recebido += v
                elif p.get("status") in ("pendente", "vencido"):
                    total_pendente += v
    except Exception:
        pass

    return {
        "total_horas": total_horas,
        "total_honorarios": round(total_honorarios, 2),
        "total_recebido": round(total_recebido, 2),
        "total_pendente": round(total_pendente, 2),
    }


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
