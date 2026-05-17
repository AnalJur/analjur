"""
Endpoints administrativos: audit log, dashboard operacional.
"""

import asyncio
import uuid
from typing import Optional
from fastapi import APIRouter, Query

from ..database import get_supabase, sb_run

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
