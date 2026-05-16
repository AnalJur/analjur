import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..database import get_db
from ..models import Documento, Peca
from ..schemas import DocumentoOut, PecaOut
from ..services.ingestao import processar_documento
from ..services import audit_svc, worker
from ..config import get_settings

router = APIRouter(prefix="/processos/{processo_id}/documentos", tags=["Documentos"])
settings = get_settings()

DEFAULT_TENANT = uuid.UUID(settings.default_tenant_id)
DEFAULT_USER   = uuid.UUID(settings.default_usuario_id)


@router.get("", response_model=list[DocumentoOut])
async def listar_documentos(processo_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Documento)
        .where(Documento.processo_id == processo_id)
        .order_by(Documento.uploaded_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=DocumentoOut, status_code=202)
async def upload_documento(
    processo_id: uuid.UUID,
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: AsyncSession = Depends(get_db),
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Apenas arquivos PDF são aceitos")

    conteudo = await file.read()
    if len(conteudo) > 50 * 1024 * 1024:
        raise HTTPException(413, "Arquivo muito grande (máximo 50 MB)")

    try:
        doc = await processar_documento(
            db=db,
            processo_id=processo_id,
            tenant_id=DEFAULT_TENANT,
            nome_original=file.filename,
            conteudo=conteudo,
            uploaded_by=DEFAULT_USER,
        )
    except ValueError as e:
        raise HTTPException(409, str(e))   # duplicata

    # Enfileira snapshot automático após ingesta
    await worker.enfileirar(db, "snapshot", {
        "processo_id": str(processo_id),
        "trigger": "novo_documento",
        "criado_por": str(DEFAULT_USER),
    })

    await audit_svc.registrar(db, "criar", "documento", doc.id,
                               dados_depois={"nome": file.filename, "status": doc.status},
                               usuario_id=DEFAULT_USER)
    await db.commit()
    await db.refresh(doc)
    return doc


@router.get("/{doc_id}", response_model=DocumentoOut)
async def obter_documento(
    processo_id: uuid.UUID, doc_id: uuid.UUID, db: AsyncSession = Depends(get_db)
):
    doc = await db.get(Documento, doc_id)
    if not doc or doc.processo_id != processo_id:
        raise HTTPException(404, "Documento não encontrado")
    return doc


@router.delete("/{doc_id}", status_code=204)
async def deletar_documento(
    processo_id: uuid.UUID, doc_id: uuid.UUID, db: AsyncSession = Depends(get_db)
):
    doc = await db.get(Documento, doc_id)
    if not doc or doc.processo_id != processo_id:
        raise HTTPException(404, "Documento não encontrado")
    await audit_svc.registrar(db, "deletar", "documento", doc_id, usuario_id=DEFAULT_USER)
    await db.delete(doc)
    await db.commit()


@router.get("/{doc_id}/pecas", response_model=list[PecaOut])
async def listar_pecas_documento(
    processo_id: uuid.UUID, doc_id: uuid.UUID, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Peca).where(Peca.documento_id == doc_id).order_by(Peca.pagina_inicio)
    )
    return result.scalars().all()


# Status polling (para o frontend fazer polling após upload)
@router.get("/{doc_id}/status")
async def status_documento(
    processo_id: uuid.UUID, doc_id: uuid.UUID, db: AsyncSession = Depends(get_db)
):
    doc = await db.get(Documento, doc_id)
    if not doc or doc.processo_id != processo_id:
        raise HTTPException(404, "Documento não encontrado")
    return {
        "id":            str(doc.id),
        "status":        doc.status,
        "total_paginas": doc.total_paginas,
        "ocr_utilizado": doc.ocr_utilizado,
        "erro_msg":      doc.erro_msg,
        "processado_at": doc.processado_at,
    }
