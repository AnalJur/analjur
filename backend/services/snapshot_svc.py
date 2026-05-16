"""
Versionamento de estados do processo.
Cada snapshot é um JSON imutável do estado completo naquele momento.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from loguru import logger

from ..models import Snapshot, Processo, Documento, Peca, Cronologia, Analise


async def criar_snapshot(
    db: AsyncSession,
    processo_id: uuid.UUID,
    trigger: str,
    criado_por: Optional[uuid.UUID] = None,
    resumo_mudancas: Optional[str] = None,
) -> Snapshot:
    """Cria um snapshot versionado do estado atual do processo."""

    # Próxima versão
    result = await db.execute(
        text("SELECT proximo_snapshot(:pid)").bindparams(pid=processo_id)
    )
    versao = result.scalar_one()

    # Monta estado atual
    estado = await _montar_estado(db, processo_id)

    # IDs de documentos processados
    docs_result = await db.execute(
        select(Documento.id).where(
            Documento.processo_id == processo_id,
            Documento.status == "processado",
        )
    )
    docs_ids = [str(r) for r in docs_result.scalars().all()]

    snap = Snapshot(
        processo_id=processo_id,
        versao=versao,
        trigger=trigger,
        estado_json=estado,
        resumo_mudancas=resumo_mudancas,
        documentos_ids=docs_ids,
        criado_por=criado_por,
    )
    db.add(snap)
    await db.flush()

    logger.info(f"Snapshot v{versao} criado para processo {processo_id}")
    return snap


async def _montar_estado(db: AsyncSession, processo_id: uuid.UUID) -> dict:
    """Serializa o estado atual do processo para JSON."""

    # Processo base
    proc = await db.get(Processo, processo_id)
    if not proc:
        return {}

    # Documentos
    docs_r = await db.execute(
        select(Documento).where(Documento.processo_id == processo_id)
    )
    docs = [
        {"id": str(d.id), "nome": d.nome_original, "status": d.status, "total_paginas": d.total_paginas}
        for d in docs_r.scalars().all()
    ]

    # Peças
    pecas_r = await db.execute(
        select(Peca).where(Peca.processo_id == processo_id)
    )
    pecas = [
        {"id": str(p.id), "tipo": p.tipo_peca, "data": str(p.data_documento), "paginas": f"{p.pagina_inicio}-{p.pagina_fim}"}
        for p in pecas_r.scalars().all()
    ]

    # Cronologia (últimos 50 eventos)
    cron_r = await db.execute(
        select(Cronologia)
        .where(Cronologia.processo_id == processo_id)
        .order_by(Cronologia.data_evento.asc().nullslast())
        .limit(50)
    )
    cronologia = [
        {"data": str(c.data_evento), "tipo": c.tipo_evento, "descricao": c.descricao, "relevancia": c.relevancia}
        for c in cron_r.scalars().all()
    ]

    # Última análise de estado_atual aprovada
    analise_r = await db.execute(
        select(Analise)
        .where(
            Analise.processo_id == processo_id,
            Analise.tipo == "estado_atual",
        )
        .order_by(Analise.created_at.desc())
        .limit(1)
    )
    analise = analise_r.scalar_one_or_none()
    estado_atual = analise.conteudo_json if analise else {}

    return {
        "gerado_em":  datetime.utcnow().isoformat(),
        "processo": {
            "id": str(proc.id),
            "numero_cnj": proc.numero_cnj,
            "tribunal": proc.tribunal,
            "assunto": proc.assunto,
            "status": proc.status,
        },
        "documentos":  docs,
        "pecas":       pecas,
        "cronologia":  cronologia,
        "estado_atual": estado_atual,
    }


async def comparar_snapshots(
    db: AsyncSession, snap_a_id: uuid.UUID, snap_b_id: uuid.UUID
) -> dict:
    """Retorna diff simplificado entre dois snapshots."""
    a = await db.get(Snapshot, snap_a_id)
    b = await db.get(Snapshot, snap_b_id)
    if not a or not b:
        raise ValueError("Snapshot não encontrado")

    ea, eb = a.estado_json, b.estado_json

    docs_a = {d["id"] for d in ea.get("documentos", [])}
    docs_b = {d["id"] for d in eb.get("documentos", [])}

    return {
        "versao_base": a.versao,
        "versao_nova": b.versao,
        "documentos_adicionados": len(docs_b - docs_a),
        "documentos_removidos":   len(docs_a - docs_b),
        "pecas_base":  len(ea.get("pecas", [])),
        "pecas_nova":  len(eb.get("pecas", [])),
        "eventos_base": len(ea.get("cronologia", [])),
        "eventos_nova": len(eb.get("cronologia", [])),
        "gerado_em": datetime.utcnow().isoformat(),
    }
