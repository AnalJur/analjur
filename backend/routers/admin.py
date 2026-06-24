"""
Endpoints administrativos: audit log, dashboard operacional, alertas de prazos.
"""

import asyncio
import uuid
from datetime import date, timedelta
from typing import Optional
from fastapi import APIRouter, Query

from ..database import get_supabase, sb_run
from ..services.feriados import dias_uteis_ate

router = APIRouter(prefix="/admin", tags=["Admin / Governança"])


@router.get("/dashboard")
async def dashboard_operacional():
    sb = get_supabase()

    proc_r, doc_r, tar_r, ana_r = await asyncio.gather(
        sb_run(lambda: sb.table("processos").select("id", count="exact").limit(1).execute()),
        sb_run(lambda: sb.table("documentos").select("id", count="exact").eq("status", "processado").limit(1).execute()),
        sb_run(lambda: sb.table("tarefas_revisao").select("id", count="exact").eq("status", "pendente").limit(1).execute()),
        sb_run(lambda: sb.table("analises").select("id", count="exact").eq("status_revisao", "pendente").limit(1).execute()),
    )

    return {
        "total_processos":            proc_r.count or 0,
        "total_documentos":           doc_r.count or 0,
        "tarefas_pendentes":          tar_r.count or 0,
        "analises_pendentes_revisao": ana_r.count or 0,
    }


@router.get("/alertas")
async def alertas_prazos(uf: Optional[str] = Query(None, description="UF para cálculo de feriados estaduais")):
    """
    Retorna prazos em aberto agrupados por urgência:
      criticos  → vencidos ou vencendo HOJE
      urgentes  → vencendo em 1-7 dias corridos
      atencao   → vencendo em 8-15 dias corridos
      monitorar → vencendo em 16-30 dias corridos
    """
    sb = get_supabase()
    hoje = date.today()
    limite = (hoje + timedelta(days=30)).isoformat()

    result = await sb_run(
        lambda: sb.table("prazos")
        .select("id, titulo, descricao, vencimento, prioridade, responsavel, processo_id, tipo")
        .eq("status", "em_aberto")
        .lte("vencimento", limite)
        .order("vencimento", desc=False)
        .execute()
    )

    # Busca dados dos processos vinculados
    prazos_raw = result.data or []
    processo_ids = list({p["processo_id"] for p in prazos_raw if p.get("processo_id")})

    processos_map: dict[str, dict] = {}
    if processo_ids:
        procs_r = await sb_run(
            lambda: sb.table("processos")
            .select("id, numero_cnj, assunto, tribunal, vara")
            .in_("id", processo_ids)
            .execute()
        )
        processos_map = {p["id"]: p for p in (procs_r.data or [])}

    criticos: list[dict] = []
    urgentes: list[dict] = []
    atencao: list[dict] = []
    monitorar: list[dict] = []

    for p in prazos_raw:
        try:
            venc = date.fromisoformat(p["vencimento"])
        except (TypeError, ValueError):
            continue

        delta_corridos = (venc - hoje).days
        dias_uteis = dias_uteis_ate(hoje, venc, uf)

        proc = processos_map.get(p["processo_id"], {})
        item = {
            "id":             p["id"],
            "titulo":         p["titulo"],
            "descricao":      p.get("descricao"),
            "vencimento":     p["vencimento"],
            "prioridade":     p.get("prioridade", "normal"),
            "responsavel":    p.get("responsavel"),
            "tipo":           p.get("tipo"),
            "processo_id":    p["processo_id"],
            "numero_cnj":     proc.get("numero_cnj"),
            "assunto":        proc.get("assunto"),
            "tribunal":       proc.get("tribunal"),
            "vara":           proc.get("vara"),
            "dias_corridos":  delta_corridos,
            "dias_uteis":     dias_uteis,
        }

        if delta_corridos <= 0:
            criticos.append(item)
        elif delta_corridos <= 7:
            urgentes.append(item)
        elif delta_corridos <= 15:
            atencao.append(item)
        else:
            monitorar.append(item)

    return {
        "hoje": hoje.isoformat(),
        "total": len(prazos_raw),
        "criticos":  {"count": len(criticos),  "items": criticos},
        "urgentes":  {"count": len(urgentes),  "items": urgentes},
        "atencao":   {"count": len(atencao),   "items": atencao},
        "monitorar": {"count": len(monitorar), "items": monitorar},
    }


@router.get("/audit")
async def listar_audit(
    entidade: Optional[str] = Query(None),
    usuario_id: Optional[uuid.UUID] = Query(None),
    limit: int = Query(50, le=500),
):
    sb = get_supabase()
    q = sb.table("audit_log").select("*")
    if entidade:
        q = q.eq("entidade", entidade)
    if usuario_id:
        q = q.eq("usuario_id", str(usuario_id))
    q = q.order("created_at", desc=True).limit(limit)
    result = await sb_run(q.execute)

    return [
        {
            "id":          r["id"],
            "acao":        r["acao"],
            "entidade":    r["entidade"],
            "entidade_id": r.get("entidade_id"),
            "usuario_id":  r.get("usuario_id"),
            "created_at":  r["created_at"],
        }
        for r in (result.data or [])
    ]
