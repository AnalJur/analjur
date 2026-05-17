import uuid
from fastapi import APIRouter, HTTPException, UploadFile, File

from ..database import get_supabase, sb_run
from ..schemas import DocumentoOut, PecaOut
from ..services.ingestao import processar_documento
from ..services import audit_svc, worker
from ..config import get_settings

router = APIRouter(prefix="/processos/{processo_id}/documentos", tags=["Documentos"])
settings = get_settings()

DEFAULT_TENANT = uuid.UUID(settings.default_tenant_id)
DEFAULT_USER   = uuid.UUID(settings.default_usuario_id)


@router.get("", response_model=list[DocumentoOut])
async def listar_documentos(processo_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("documentos").select("*")
        .eq("processo_id", str(processo_id))
        .order("uploaded_at", desc=True)
        .execute()
    )
    return result.data


@router.post("", response_model=DocumentoOut, status_code=202)
async def upload_documento(processo_id: uuid.UUID, file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Apenas arquivos PDF são aceitos")

    conteudo = await file.read()
    if len(conteudo) > 50 * 1024 * 1024:
        raise HTTPException(413, "Arquivo muito grande (máximo 50 MB)")

    try:
        doc = await processar_documento(
            processo_id=processo_id,
            tenant_id=DEFAULT_TENANT,
            nome_original=file.filename,
            conteudo=conteudo,
            uploaded_by=DEFAULT_USER,
        )
    except ValueError as e:
        raise HTTPException(409, str(e))

    await worker.enfileirar("snapshot", {
        "processo_id": str(processo_id),
        "trigger": "novo_documento",
        "criado_por": str(DEFAULT_USER),
    })

    await audit_svc.registrar("criar", "documento", doc["id"],
                               dados_depois={"nome": file.filename, "status": doc["status"]},
                               usuario_id=DEFAULT_USER)
    return doc


@router.get("/{doc_id}", response_model=DocumentoOut)
async def obter_documento(processo_id: uuid.UUID, doc_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("documentos").select("*")
        .eq("id", str(doc_id))
        .eq("processo_id", str(processo_id))
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Documento não encontrado")
    return result.data[0]


@router.delete("/{doc_id}", status_code=204)
async def deletar_documento(processo_id: uuid.UUID, doc_id: uuid.UUID):
    sb = get_supabase()
    await audit_svc.registrar("deletar", "documento", doc_id, usuario_id=DEFAULT_USER)
    result = await sb_run(
        lambda: sb.table("documentos").delete()
        .eq("id", str(doc_id))
        .eq("processo_id", str(processo_id))
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Documento não encontrado")


@router.get("/{doc_id}/pecas", response_model=list[PecaOut])
async def listar_pecas_documento(processo_id: uuid.UUID, doc_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("pecas").select("*")
        .eq("documento_id", str(doc_id))
        .order("pagina_inicio", desc=False)
        .execute()
    )
    return result.data


@router.get("/{doc_id}/status")
async def status_documento(processo_id: uuid.UUID, doc_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("documentos").select("*")
        .eq("id", str(doc_id))
        .eq("processo_id", str(processo_id))
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Documento não encontrado")
    doc = result.data[0]
    return {
        "id":            doc["id"],
        "status":        doc["status"],
        "total_paginas": doc.get("total_paginas"),
        "ocr_utilizado": doc.get("ocr_utilizado", False),
        "erro_msg":      doc.get("erro_msg"),
        "processado_at": doc.get("processado_at"),
    }
