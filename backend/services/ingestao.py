"""
Pipeline completo de ingestão via supabase-py.
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
from .ocr import extrair_texto_pdf, contar_paginas
from .chunker import chunkar_paginas
from .classificador import classificar_peca
from .embeddings import embeddings_documentos

settings = get_settings()


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def calcular_hash(conteudo: bytes) -> str:
    return hashlib.sha256(conteudo).hexdigest()


async def verificar_duplicata(processo_id: uuid.UUID, content_hash: str) -> bool:
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("documentos")
        .select("id")
        .eq("processo_id", str(processo_id))
        .eq("content_hash", content_hash)
        .limit(1)
        .execute()
    )
    return bool(result.data)


async def processar_conteudo(
    doc_id: str,
    processo_id: uuid.UUID,
    tenant_id: uuid.UUID,
    nome_original: str,
    conteudo: bytes,
) -> None:
    """Processa OCR/classificação/embeddings de um documento já registrado no banco.
    Chamado como background task — atualiza o status diretamente."""
    sb = get_supabase()

    tmp_path = Path(tempfile.gettempdir()) / f"{uuid.uuid4()}.pdf"
    tmp_path.write_bytes(conteudo)

    try:
        logger.info(f"Extraindo texto de {nome_original}")
        paginas, ocr_utilizado = extrair_texto_pdf(tmp_path)
        texto_completo = "\n".join(paginas)

        classificacao = classificar_peca(texto_completo)
        logger.info(f"Peça classificada como {classificacao.tipo_peca} ({classificacao.confianca:.0%})")

        peca_data = {
            "id": str(uuid.uuid4()),
            "documento_id": doc_id,
            "processo_id": str(processo_id),
            "tipo_peca": classificacao.tipo_peca,
            "pagina_inicio": 1,
            "pagina_fim": len(paginas),
            "conteudo_texto": texto_completo[:50_000],
            "confianca_classificacao": classificacao.confianca,
        }
        peca_r = await sb_run(lambda: sb.table("pecas").insert(peca_data).execute())
        peca = peca_r.data[0]

        chunks_raw = chunkar_paginas(
            paginas,
            tokens_por_chunk=settings.chunk_tokens,
            overlap=settings.chunk_overlap,
        )
        logger.info(f"{len(chunks_raw)} chunks gerados")

        textos = [c.conteudo for c in chunks_raw]
        vetores = await embeddings_documentos(textos)

        lote_sb = [
            {
                "id": str(uuid.uuid4()),
                "peca_id": peca["id"],
                "processo_id": str(processo_id),
                "tenant_id": str(tenant_id),
                "conteudo": c.conteudo,
                "embedding": vetor,
                "pagina": c.pagina,
                "chunk_index": c.index,
                "tokens": c.tokens,
            }
            for c, vetor in zip(chunks_raw, vetores)
        ]

        LOTE = 50
        for i in range(0, len(lote_sb), LOTE):
            lote = lote_sb[i: i + LOTE]
            await sb_run(lambda lote=lote: sb.table("chunks").insert(lote).execute())
            logger.debug(f"Chunks inseridos {i}–{i + LOTE}")

        await sb_run(
            lambda: sb.table("documentos").update({
                "status": "processado",
                "total_paginas": len(paginas),
                "ocr_utilizado": ocr_utilizado,
                "processado_at": _utcnow(),
            }).eq("id", doc_id).execute()
        )
        logger.success(f"Documento {nome_original} processado — {len(chunks_raw)} chunks")

    except Exception as e:
        await sb_run(
            lambda: sb.table("documentos").update({
                "status": "erro",
                "erro_msg": str(e),
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
    """Cria o registro e processa sincronamente (usado pelo worker)."""
    sb = get_supabase()

    content_hash = calcular_hash(conteudo)
    if await verificar_duplicata(processo_id, content_hash):
        raise ValueError(f"Documento já existe no processo (hash {content_hash[:8]}…)")

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
    doc_id = doc["id"]

    await processar_conteudo(doc_id, processo_id, tenant_id, nome_original, conteudo)

    result = await sb_run(
        lambda: sb.table("documentos").select("*").eq("id", doc_id).limit(1).execute()
    )
    return result.data[0]
