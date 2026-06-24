"""
Agenda — agrega prazos, atendimentos e tarefas num endpoint de calendário.
"""

import asyncio
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Query

from ..database import get_supabase, sb_run

router = APIRouter(prefix="/agenda", tags=["Agenda"])


def _cor_prazo(vencimento: str, status: str) -> str:
    if status in ("cumprido", "cancelado"):
        return "gray"
    try:
        d = date.fromisoformat(vencimento)
    except Exception:
        return "blue"
    dias = (d - date.today()).days
    if dias < 0:   return "red"
    if dias <= 2:  return "red"
    if dias <= 7:  return "orange"
    if dias <= 15: return "yellow"
    return "green"


def _cor_tarefa(prioridade: str, status: str) -> str:
    if status in ("aprovado", "cancelado"):
        return "gray"
    return {"urgente": "red", "alta": "orange", "normal": "purple", "baixa": "purple"}.get(prioridade, "purple")


@router.get("")
async def listar_eventos(
    inicio: date = Query(..., description="Data início do período (YYYY-MM-DD)"),
    fim:    date = Query(..., description="Data fim do período (YYYY-MM-DD)"),
):
    sb = get_supabase()
    inicio_s = inicio.isoformat()
    fim_s    = fim.isoformat()

    # Busca paralela: prazos + atendimentos + tarefas com deadline
    prazos_q = lambda: (
        sb.table("prazos")
        .select("id,titulo,descricao,vencimento,status,prioridade,processo_id")
        .gte("vencimento", inicio_s)
        .lte("vencimento", fim_s)
        .execute()
    )
    atend_q = lambda: (
        sb.table("atendimentos")
        .select("id,assunto,tipo,duracao_min,data_atendimento,participantes,processo_id")
        .gte("data_atendimento", inicio_s)
        .lte("data_atendimento", fim_s)
        .execute()
    )
    tarefas_q = lambda: (
        sb.table("tarefas_revisao")
        .select("id,titulo,status,prioridade,deadline,processo_id")
        .gte("deadline", inicio_s)
        .lte("deadline", fim_s)
        .not_.is_("deadline", "null")
        .execute()
    )
    proc_q = lambda: (
        sb.table("processos")
        .select("id,numero_cnj,assunto,tribunal")
        .execute()
    )

    prazos_r, atend_r, tarefas_r, proc_r = await asyncio.gather(
        sb_run(prazos_q),
        sb_run(atend_q),
        sb_run(tarefas_q),
        sb_run(proc_q),
    )

    # Mapa processo_id → info
    proc_map: dict = {p["id"]: p for p in (proc_r.data or [])}

    eventos = []

    for p in (prazos_r.data or []):
        proc = proc_map.get(p.get("processo_id", ""), {})
        eventos.append({
            "id":          p["id"],
            "tipo":        "prazo",
            "titulo":      p["titulo"],
            "descricao":   p.get("descricao"),
            "data":        p["vencimento"],
            "status":      p.get("status", "em_aberto"),
            "prioridade":  p.get("prioridade", "normal"),
            "processo_id": p.get("processo_id"),
            "numero_cnj":  proc.get("numero_cnj"),
            "assunto":     proc.get("assunto"),
            "tribunal":    proc.get("tribunal"),
            "cor":         _cor_prazo(p["vencimento"], p.get("status", "")),
            "extra":       None,
        })

    for a in (atend_r.data or []):
        proc = proc_map.get(a.get("processo_id", ""), {})
        eventos.append({
            "id":          a["id"],
            "tipo":        "atendimento",
            "titulo":      a["assunto"],
            "descricao":   a.get("participantes"),
            "data":        a["data_atendimento"],
            "status":      "agendado",
            "prioridade":  "normal",
            "processo_id": a.get("processo_id"),
            "numero_cnj":  proc.get("numero_cnj"),
            "assunto":     proc.get("assunto"),
            "tribunal":    proc.get("tribunal"),
            "cor":         "blue",
            "extra":       {"tipo_atend": a.get("tipo"), "duracao_min": a.get("duracao_min")},
        })

    for t in (tarefas_r.data or []):
        proc = proc_map.get(t.get("processo_id", ""), {})
        eventos.append({
            "id":          t["id"],
            "tipo":        "tarefa",
            "titulo":      t["titulo"],
            "descricao":   None,
            "data":        t["deadline"][:10] if t.get("deadline") else None,
            "status":      t.get("status", "pendente"),
            "prioridade":  t.get("prioridade", "normal"),
            "processo_id": t.get("processo_id"),
            "numero_cnj":  proc.get("numero_cnj"),
            "assunto":     proc.get("assunto"),
            "tribunal":    proc.get("tribunal"),
            "cor":         _cor_tarefa(t.get("prioridade", "normal"), t.get("status", "")),
            "extra":       None,
        })

    # Ordena por data
    eventos.sort(key=lambda e: (e["data"] or ""))

    # Resumo
    prazos_list  = [e for e in eventos if e["tipo"] == "prazo"]
    criticos     = [e for e in prazos_list if e["cor"] == "red"]
    resumo = {
        "total_prazos":       len(prazos_list),
        "prazos_criticos":    len(criticos),
        "total_atendimentos": len([e for e in eventos if e["tipo"] == "atendimento"]),
        "total_tarefas":      len([e for e in eventos if e["tipo"] == "tarefa"]),
    }

    return {"eventos": eventos, "resumo": resumo}
