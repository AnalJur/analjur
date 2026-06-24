"""
Atendimentos (reuniões/calls) e Timesheet por processo.
"""

import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..database import get_supabase, sb_run

router = APIRouter(tags=["Atendimentos & Timesheet"])


# ── Schemas ───────────────────────────────────────────────────────────────

class AtendimentoCreate(BaseModel):
    data_atendimento: date
    tipo: str = "presencial"          # presencial | videoconferencia | telefone | email
    duracao_min: int = 60
    assunto: str
    anotacoes: Optional[str] = None
    participantes: Optional[str] = None
    documentos_vinculados: list[dict] = []


class AtendimentoUpdate(BaseModel):
    data_atendimento: Optional[date] = None
    tipo: Optional[str] = None
    duracao_min: Optional[int] = None
    assunto: Optional[str] = None
    anotacoes: Optional[str] = None
    participantes: Optional[str] = None
    documentos_vinculados: Optional[list[dict]] = None


class TimesheetCreate(BaseModel):
    descricao: str
    tipo: str = "trabalho"            # trabalho | reuniao | pesquisa | audiencia | deslocamento
    duracao_min: int = 60
    data_lancamento: date
    tarefa_id: Optional[uuid.UUID] = None


# ── Atendimentos ──────────────────────────────────────────────────────────

@router.get("/processos/{processo_id}/atendimentos")
async def listar_atendimentos(processo_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("atendimentos")
        .select("*")
        .eq("processo_id", str(processo_id))
        .order("data_atendimento", desc=True)
        .execute()
    )
    return result.data or []


@router.post("/processos/{processo_id}/atendimentos", status_code=201)
async def criar_atendimento(processo_id: uuid.UUID, body: AtendimentoCreate):
    sb = get_supabase()
    row = {
        "processo_id":         str(processo_id),
        "data_atendimento":    body.data_atendimento.isoformat(),
        "tipo":                body.tipo,
        "duracao_min":         body.duracao_min,
        "assunto":             body.assunto,
        "anotacoes":           body.anotacoes,
        "participantes":       body.participantes,
        "documentos_vinculados": body.documentos_vinculados,
    }
    result = await sb_run(lambda: sb.table("atendimentos").insert(row).execute())
    if not result.data:
        raise HTTPException(500, "Erro ao criar atendimento")
    return result.data[0]


@router.patch("/processos/{processo_id}/atendimentos/{atendimento_id}")
async def atualizar_atendimento(
    processo_id: uuid.UUID, atendimento_id: uuid.UUID, body: AtendimentoUpdate
):
    sb = get_supabase()
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if "data_atendimento" in upd and hasattr(upd["data_atendimento"], "isoformat"):
        upd["data_atendimento"] = upd["data_atendimento"].isoformat()
    result = await sb_run(
        lambda: sb.table("atendimentos")
        .update(upd)
        .eq("id", str(atendimento_id))
        .eq("processo_id", str(processo_id))
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Atendimento não encontrado")
    return result.data[0]


@router.delete("/processos/{processo_id}/atendimentos/{atendimento_id}", status_code=204)
async def deletar_atendimento(processo_id: uuid.UUID, atendimento_id: uuid.UUID):
    sb = get_supabase()
    await sb_run(
        lambda: sb.table("atendimentos")
        .delete()
        .eq("id", str(atendimento_id))
        .eq("processo_id", str(processo_id))
        .execute()
    )


# ── Timesheet ─────────────────────────────────────────────────────────────

@router.get("/processos/{processo_id}/timesheet")
async def listar_timesheet(
    processo_id: uuid.UUID,
    tarefa_id: Optional[uuid.UUID] = Query(None),
):
    sb = get_supabase()
    q = (
        sb.table("timesheet")
        .select("*")
        .eq("processo_id", str(processo_id))
    )
    if tarefa_id:
        q = q.eq("tarefa_id", str(tarefa_id))
    result = await sb_run(lambda: q.order("data_lancamento", desc=True).execute())
    entries = result.data or []

    # Computa total de horas do processo
    total_min = sum(e.get("duracao_min", 0) for e in entries)
    return {
        "entries":    entries,
        "total_min":  total_min,
        "total_horas": round(total_min / 60, 1),
    }


@router.post("/processos/{processo_id}/timesheet", status_code=201)
async def lancar_horas(processo_id: uuid.UUID, body: TimesheetCreate):
    sb = get_supabase()
    row = {
        "processo_id":    str(processo_id),
        "descricao":      body.descricao,
        "tipo":           body.tipo,
        "duracao_min":    body.duracao_min,
        "data_lancamento": body.data_lancamento.isoformat(),
    }
    if body.tarefa_id:
        row["tarefa_id"] = str(body.tarefa_id)
    result = await sb_run(lambda: sb.table("timesheet").insert(row).execute())
    if not result.data:
        raise HTTPException(500, "Erro ao lançar horas")
    return result.data[0]


@router.delete("/processos/{processo_id}/timesheet/{entry_id}", status_code=204)
async def deletar_entry_timesheet(processo_id: uuid.UUID, entry_id: uuid.UUID):
    sb = get_supabase()
    await sb_run(
        lambda: sb.table("timesheet")
        .delete()
        .eq("id", str(entry_id))
        .eq("processo_id", str(processo_id))
        .execute()
    )
