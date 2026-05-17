"""
Versionamento de estados do processo via supabase-py.
"""

import uuid
from datetime import datetime, timezone
from typing import Optional

from loguru import logger

from ..database import get_supabase, sb_run


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


async def criar_snapshot(
    processo_id: uuid.UUID,
    trigger: str,
    criado_por: Optional[uuid.UUID] = None,
    resumo_mudancas: Optional[str] = None,
) -> dict:
    sb = get_supabase()

    # Próxima versão = max(versao) + 1
    ver_r = await sb_run(
        lambda: sb.table("snapshots")
        .select("versao")
        .eq("processo_id", str(processo_id))
        .order("versao", desc=True)
        .limit(1)
        .execute()
    )
    versao = (ver_r.data[0]["versao"] + 1) if ver_r.data else 1

    estado = await _montar_estado(sb, processo_id)

    docs_r = await sb_run(
        lambda: sb.table("documentos")
        .select("id")
        .eq("processo_id", str(processo_id))
        .eq("status", "processado")
        .execute()
    )
    docs_ids = [r["id"] for r in (docs_r.data or [])]

    snap_data = {
        "id": str(uuid.uuid4()),
        "processo_id": str(processo_id),
        "versao": versao,
        "trigger": trigger,
        "estado_json": estado,
        "resumo_mudancas": resumo_mudancas,
        "documentos_ids": docs_ids,
        "criado_por": str(criado_por) if criado_por else None,
    }
    result = await sb_run(lambda: sb.table("snapshots").insert(snap_data).execute())
    snap = result.data[0]
    logger.info(f"Snapshot v{versao} criado para processo {processo_id}")
    return snap


async def _montar_estado(sb, processo_id: uuid.UUID) -> dict:
    pid = str(processo_id)

    proc_r = await sb_run(
        lambda: sb.table("processos").select("*").eq("id", pid).limit(1).execute()
    )
    if not proc_r.data:
        return {}
    proc = proc_r.data[0]

    docs_r = await sb_run(
        lambda: sb.table("documentos").select("id,nome_original,status,total_paginas")
        .eq("processo_id", pid).execute()
    )
    docs = [
        {"id": d["id"], "nome": d["nome_original"], "status": d["status"], "total_paginas": d["total_paginas"]}
        for d in (docs_r.data or [])
    ]

    pecas_r = await sb_run(
        lambda: sb.table("pecas").select("id,tipo_peca,data_documento,pagina_inicio,pagina_fim")
        .eq("processo_id", pid).execute()
    )
    pecas = [
        {"id": p["id"], "tipo": p["tipo_peca"], "data": str(p["data_documento"]),
         "paginas": f"{p['pagina_inicio']}-{p['pagina_fim']}"}
        for p in (pecas_r.data or [])
    ]

    cron_r = await sb_run(
        lambda: sb.table("cronologia")
        .select("data_evento,tipo_evento,descricao,relevancia")
        .eq("processo_id", pid)
        .order("data_evento", desc=False)
        .limit(50)
        .execute()
    )
    cronologia = [
        {"data": str(c["data_evento"]), "tipo": c["tipo_evento"],
         "descricao": c["descricao"], "relevancia": c["relevancia"]}
        for c in (cron_r.data or [])
    ]

    analise_r = await sb_run(
        lambda: sb.table("analises")
        .select("conteudo_json")
        .eq("processo_id", pid)
        .eq("tipo", "estado_atual")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    estado_atual = analise_r.data[0]["conteudo_json"] if analise_r.data else {}

    return {
        "gerado_em": _utcnow(),
        "processo": {
            "id": proc["id"],
            "numero_cnj": proc.get("numero_cnj"),
            "tribunal": proc.get("tribunal"),
            "assunto": proc.get("assunto"),
            "status": proc.get("status"),
        },
        "documentos": docs,
        "pecas": pecas,
        "cronologia": cronologia,
        "estado_atual": estado_atual,
    }


async def comparar_snapshots(snap_a_id: uuid.UUID, snap_b_id: uuid.UUID) -> dict:
    sb = get_supabase()

    r = await sb_run(
        lambda: sb.table("snapshots")
        .select("id,versao,estado_json")
        .in_("id", [str(snap_a_id), str(snap_b_id)])
        .execute()
    )
    rows = {row["id"]: row for row in (r.data or [])}
    a = rows.get(str(snap_a_id))
    b = rows.get(str(snap_b_id))
    if not a or not b:
        raise ValueError("Snapshot não encontrado")

    ea, eb = a["estado_json"], b["estado_json"]
    docs_a = {d["id"] for d in ea.get("documentos", [])}
    docs_b = {d["id"] for d in eb.get("documentos", [])}

    return {
        "versao_base": a["versao"],
        "versao_nova": b["versao"],
        "documentos_adicionados": len(docs_b - docs_a),
        "documentos_removidos": len(docs_a - docs_b),
        "pecas_base": len(ea.get("pecas", [])),
        "pecas_nova": len(eb.get("pecas", [])),
        "eventos_base": len(ea.get("cronologia", [])),
        "eventos_nova": len(eb.get("cronologia", [])),
        "gerado_em": _utcnow(),
    }
