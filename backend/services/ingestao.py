"""
Pipeline de ingestão — extrai texto e classifica peças. Sem embeddings.
"""

import hashlib
import uuid
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from loguru import logger

from ..config import get_settings
from ..database import get_supabase, sb_run
from .ocr import extrair_texto_pdf
from .classificador import classificar_peca

settings = get_settings()


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def calcular_hash(conteudo: bytes) -> str:
    return hashlib.sha256(conteudo).hexdigest()


async def verificar_duplicata(processo_id: uuid.UUID, content_hash: str) -> bool:
    """Retorna True apenas se já existe documento processado com o mesmo hash.
    Documentos com status 'erro' são ignorados — permite re-upload."""
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("documentos")
        .select("id,status")
        .eq("processo_id", str(processo_id))
        .eq("content_hash", content_hash)
        .limit(1)
        .execute()
    )
    if not result.data:
        return False
    return result.data[0].get("status") != "erro"


async def limpar_documento_com_erro(processo_id: uuid.UUID, content_hash: str) -> None:
    """Remove registro de documento com erro para permitir re-upload limpo."""
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("documentos")
        .select("id")
        .eq("processo_id", str(processo_id))
        .eq("content_hash", content_hash)
        .eq("status", "erro")
        .limit(1)
        .execute()
    )
    if result.data:
        doc_id = result.data[0]["id"]
        await sb_run(lambda: sb.table("pecas").delete().eq("documento_id", doc_id).execute())
        await sb_run(lambda: sb.table("documentos").delete().eq("id", doc_id).execute())
        logger.info(f"Documento com erro removido para re-upload: {doc_id}")


async def processar_conteudo(
    doc_id: str,
    processo_id: uuid.UUID,
    tenant_id: uuid.UUID,
    nome_original: str,
    conteudo: bytes,
) -> None:
    """Processa OCR e classificação em background. Sem embeddings."""
    sb = get_supabase()

    tmp_path = Path(tempfile.gettempdir()) / f"{uuid.uuid4()}.pdf"
    tmp_path.write_bytes(conteudo)

    try:
        logger.info(f"Extraindo texto de {nome_original}")
        paginas, ocr_utilizado = extrair_texto_pdf(tmp_path)
        texto_completo = "\n\n".join(p for p in paginas if p.strip())

        classificacao = classificar_peca(texto_completo)
        logger.info(f"Peça: {classificacao.tipo_peca} ({classificacao.confianca:.0%})")

        peca_data = {
            "id": str(uuid.uuid4()),
            "documento_id": doc_id,
            "processo_id": str(processo_id),
            "tipo_peca": classificacao.tipo_peca,
            "pagina_inicio": 1,
            "pagina_fim": len(paginas),
            "conteudo_texto": texto_completo[:500_000],
            "confianca_classificacao": classificacao.confianca,
        }
        await sb_run(lambda: sb.table("pecas").insert(peca_data).execute())

        await sb_run(
            lambda: sb.table("documentos").update({
                "status": "processado",
                "total_paginas": len(paginas),
                "ocr_utilizado": ocr_utilizado,
                "processado_at": _utcnow(),
            }).eq("id", doc_id).execute()
        )
        logger.success(f"Documento {nome_original} processado — {len(paginas)} páginas")

    except Exception as e:
        await sb_run(
            lambda: sb.table("documentos").update({
                "status": "erro",
                "erro_msg": str(e)[:500],
            }).eq("id", doc_id).execute()
        )
        logger.error(f"Erro ao processar {nome_original}: {e}")

    finally:
        tmp_path.unlink(missing_ok=True)


async def processar_documento(
    processo_id: uuid.UUID,
    tenant_id: uuid.UUID,
    nome_original: str,
    conteudo: bytes,
    uploaded_by: Optional[uuid.UUID] = None,
    tmp_path: Optional[Path] = None,
) -> dict:
    """Cria registro e processa sincronamente (compatibilidade com worker)."""
    sb = get_supabase()

    content_hash = calcular_hash(conteudo)
    if await verificar_duplicata(processo_id, content_hash):
        raise ValueError(f"Documento já existe (hash {content_hash[:8]}…)")

    doc_data = {
        "id": str(uuid.uuid4()),
        "processo_id": str(processo_id),
        "tenant_id": str(tenant_id),
        "nome_original": nome_original,
        "storage_path": "",
        "content_hash": content_hash,
        "tamanho_bytes": len(conteudo),
        "status": "processando",
        "uploaded_by": str(uploaded_by) if uploaded_by else None,
        "uploaded_at": _utcnow(),
    }
    doc_r = await sb_run(lambda: sb.table("documentos").insert(doc_data).execute())
    doc = doc_r.data[0]

    await processar_conteudo(doc["id"], processo_id, tenant_id, nome_original, conteudo)

    result = await sb_run(
        lambda: sb.table("documentos").select("*").eq("id", doc["id"]).limit(1).execute()
    )
    return result.data[0]
