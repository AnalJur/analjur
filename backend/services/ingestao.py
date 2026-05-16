"""
Pipeline completo de ingestão:
1. Hash + deduplicação
2. Extração de texto (OCR se necessário)
3. Classificação de peças
4. Chunking
5. Embeddings
6. Persistência
7. Snapshot
"""

import hashlib
import uuid
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from loguru import logger

from ..models import Documento, Peca, Chunk, Processo
from ..config import get_settings
from .ocr import extrair_texto_pdf, contar_paginas
from .chunker import chunkar_paginas
from .classificador import classificar_peca
from .embeddings import embeddings_documentos
from ..database import get_supabase

settings = get_settings()


def calcular_hash(conteudo: bytes) -> str:
    return hashlib.sha256(conteudo).hexdigest()


async def verificar_duplicata(
    db: AsyncSession, processo_id: uuid.UUID, content_hash: str
) -> bool:
    result = await db.execute(
        select(Documento.id).where(
            Documento.processo_id == processo_id,
            Documento.content_hash == content_hash,
        )
    )
    return result.scalar_one_or_none() is not None


async def processar_documento(
    db: AsyncSession,
    processo_id: uuid.UUID,
    tenant_id: uuid.UUID,
    nome_original: str,
    conteudo: bytes,
    uploaded_by: Optional[uuid.UUID] = None,
    tmp_path: Optional[Path] = None,
) -> Documento:
    """
    Processa um PDF e persiste tudo no banco.
    Retorna o objeto Documento após processamento.
    """

    # 1. Hash + deduplicação
    content_hash = calcular_hash(conteudo)
    if await verificar_duplicata(db, processo_id, content_hash):
        raise ValueError(f"Documento já existe no processo (hash {content_hash[:8]}…)")

    # 2. Salva arquivo temporário se não fornecido
    if tmp_path is None:
        tmp_path = Path(tempfile.gettempdir()) / f"{uuid.uuid4()}.pdf"
        tmp_path.write_bytes(conteudo)
        tmp_criado = True
    else:
        tmp_criado = False

    # 3. Cria registro de documento
    doc = Documento(
        processo_id=processo_id,
        tenant_id=tenant_id,
        nome_original=nome_original,
        storage_path=str(tmp_path),   # em produção: Supabase Storage URL
        content_hash=content_hash,
        tamanho_bytes=len(conteudo),
        status="processando",
        uploaded_by=uploaded_by,
        uploaded_at=datetime.utcnow(),
    )
    db.add(doc)
    await db.flush()   # obtém doc.id

    try:
        # 4. Extração de texto
        logger.info(f"Extraindo texto de {nome_original}")
        paginas, ocr_utilizado = extrair_texto_pdf(tmp_path)
        doc.total_paginas = len(paginas)
        doc.ocr_utilizado = ocr_utilizado

        # 5. Classificação de peças
        # Estratégia simples: 1 peça = documento inteiro (refinável por lógica de seção)
        texto_completo = "\n".join(paginas)
        classificacao = classificar_peca(texto_completo)
        logger.info(f"Peça classificada como {classificacao.tipo_peca} ({classificacao.confianca:.0%})")

        peca = Peca(
            documento_id=doc.id,
            processo_id=processo_id,
            tipo_peca=classificacao.tipo_peca,
            pagina_inicio=1,
            pagina_fim=len(paginas),
            conteudo_texto=texto_completo[:50_000],   # limite de storage
            confianca_classificacao=classificacao.confianca,
        )
        db.add(peca)
        await db.flush()
        # Commit doc+peca antes de inserir chunks via supabase-py
        # (conexão PostgREST é separada e não vê transações abertas do SQLAlchemy)
        await db.commit()

        # 6. Chunking
        chunks_raw = chunkar_paginas(
            paginas,
            tokens_por_chunk=settings.chunk_tokens,
            overlap=settings.chunk_overlap,
        )
        logger.info(f"{len(chunks_raw)} chunks gerados")

        # 7. Embeddings em batch
        textos = [c.conteudo for c in chunks_raw]
        vetores = embeddings_documentos(textos)

        # 8. Persiste chunks via supabase-py (suporta VECTOR nativo)
        sb = get_supabase()
        lote_sb = [
            {
                "id":          str(uuid.uuid4()),
                "peca_id":     str(peca.id),
                "processo_id": str(processo_id),
                "tenant_id":   str(tenant_id),
                "conteudo":    c.conteudo,
                "embedding":   vetor,
                "pagina":      c.pagina,
                "chunk_index": c.index,
                "tokens":      c.tokens,
            }
            for c, vetor in zip(chunks_raw, vetores)
        ]

        LOTE = 50
        for i in range(0, len(lote_sb), LOTE):
            sb.table("chunks").insert(lote_sb[i : i + LOTE]).execute()
            logger.debug(f"Chunks inseridos {i}–{i + LOTE}")

        doc.status = "processado"
        doc.processado_at = datetime.utcnow()
        logger.success(f"Documento {nome_original} processado — {len(chunks_raw)} chunks")

    except Exception as e:
        doc.status = "erro"
        doc.erro_msg = str(e)
        logger.error(f"Erro ao processar {nome_original}: {e}")
        raise

    finally:
        if tmp_criado and tmp_path and tmp_path.exists():
            tmp_path.unlink(missing_ok=True)

    return doc
