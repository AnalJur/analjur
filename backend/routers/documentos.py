import hashlib
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile, File

from ..database import get_supabase, sb_run
from ..schemas import DocumentoOut, PecaOut, PecaUpdate
from ..services import ingestao, audit_svc, worker
from ..config import get_settings

router = APIRouter(prefix="/processos/{processo_id}/documentos", tags=["Documentos"])
settings = get_settings()

DEFAULT_TENANT = uuid.UUID(settings.default_tenant_id)
DEFAULT_USER   = uuid.UUID(settings.default_usuario_id)


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


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
async def upload_documento(
    processo_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Apenas arquivos PDF são aceitos")

    conteudo = await file.read()
    if len(conteudo) > 50 * 1024 * 1024:
        raise HTTPException(413, "Arquivo muito grande (máximo 50 MB)")

    content_hash = hashlib.sha256(conteudo).hexdigest()
    if await ingestao.verificar_duplicata(processo_id, content_hash):
        raise HTTPException(409, "Documento já existe no processo")
    # Remove registro anterior com erro para permitir re-upload limpo
    await ingestao.limpar_documento_com_erro(processo_id, content_hash)

    sb = get_supabase()
    doc_data = {
        "id": str(uuid.uuid4()),
        "processo_id": str(processo_id),
        "tenant_id": str(DEFAULT_TENANT),
        "nome_original": file.filename,
        "storage_path": "",
        "content_hash": content_hash,
        "tamanho_bytes": len(conteudo),
        "status": "processando",
        "uploaded_by": str(DEFAULT_USER),
        "uploaded_at": _utcnow(),
    }
    doc_r = await sb_run(lambda: sb.table("documentos").insert(doc_data).execute())
    doc = doc_r.data[0]

    background_tasks.add_task(
        ingestao.processar_conteudo,
        doc["id"],
        processo_id,
        DEFAULT_TENANT,
        file.filename,
        conteudo,
    )

    await worker.enfileirar("snapshot", {
        "processo_id": str(processo_id),
        "trigger": "novo_documento",
        "criado_por": str(DEFAULT_USER),
    })

    await audit_svc.registrar("criar", "documento", doc["id"],
                               dados_depois={"nome": file.filename, "status": "processando"},
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
    check = await sb_run(
        lambda: sb.table("documentos").select("id")
        .eq("id", str(doc_id))
        .eq("processo_id", str(processo_id))
        .limit(1)
        .execute()
    )
    if not check.data:
        raise HTTPException(404, "Documento não encontrado")
    await audit_svc.registrar("deletar", "documento", doc_id, usuario_id=DEFAULT_USER)
    await sb_run(
        lambda: sb.table("documentos").delete()
        .eq("id", str(doc_id))
        .eq("processo_id", str(processo_id))
        .execute()
    )


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


@router.patch("/{doc_id}/pecas/{peca_id}", response_model=PecaOut)
async def atualizar_peca(processo_id: uuid.UUID, doc_id: uuid.UUID, peca_id: uuid.UUID, body: PecaUpdate):
    sb = get_supabase()
    dados = body.model_dump(exclude_none=True)
    if not dados:
        raise HTTPException(400, "Nenhum campo para atualizar")
    result = await sb_run(
        lambda: sb.table("pecas").update(dados)
        .eq("id", str(peca_id))
        .eq("documento_id", str(doc_id))
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Peça não encontrada")
    await audit_svc.registrar("atualizar", "peca", peca_id, dados_depois=dados, usuario_id=DEFAULT_USER)
    return result.data[0]


@router.delete("/{doc_id}/pecas/{peca_id}", status_code=204)
async def deletar_peca(processo_id: uuid.UUID, doc_id: uuid.UUID, peca_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("pecas").delete()
        .eq("id", str(peca_id))
        .eq("documento_id", str(doc_id))
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Peça não encontrada")
    await audit_svc.registrar("deletar", "peca", peca_id, usuario_id=DEFAULT_USER)


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
