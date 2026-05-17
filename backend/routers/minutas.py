import uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException

from ..database import get_supabase, sb_run
from ..schemas import MinutaSolicitacao, MinutaUpdate, MinutaOut
from ..services.minuta_svc import gerar_minuta, salvar_versao
from ..services import audit_svc
from ..config import get_settings

router = APIRouter(prefix="/processos/{processo_id}/minutas", tags=["Minutas"])
settings = get_settings()
DEFAULT_USER = uuid.UUID(settings.default_usuario_id)


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("", response_model=list[MinutaOut])
async def listar_minutas(processo_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("minutas").select("*")
        .eq("processo_id", str(processo_id))
        .order("created_at", desc=True)
        .execute()
    )
    return result.data


@router.post("", response_model=MinutaOut, status_code=201)
async def solicitar_minuta(processo_id: uuid.UUID, body: MinutaSolicitacao):
    try:
        minuta = await gerar_minuta(
            processo_id=processo_id,
            tipo=body.tipo,
            titulo=body.titulo,
            instrucoes=body.instrucoes,
            usuario_id=DEFAULT_USER,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    await audit_svc.registrar("criar", "minuta", minuta["id"],
                               dados_depois={"tipo": body.tipo, "titulo": body.titulo},
                               usuario_id=DEFAULT_USER)
    return minuta


@router.get("/{minuta_id}", response_model=MinutaOut)
async def obter_minuta(processo_id: uuid.UUID, minuta_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("minutas").select("*")
        .eq("id", str(minuta_id))
        .eq("processo_id", str(processo_id))
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Minuta não encontrada")
    return result.data[0]


@router.patch("/{minuta_id}", response_model=MinutaOut)
async def editar_minuta(processo_id: uuid.UUID, minuta_id: uuid.UUID, body: MinutaUpdate):
    sb = get_supabase()

    # Verifica existência
    chk = await sb_run(
        lambda: sb.table("minutas").select("id,processo_id,conteudo_md,versao")
        .eq("id", str(minuta_id)).eq("processo_id", str(processo_id)).limit(1).execute()
    )
    if not chk.data:
        raise HTTPException(404, "Minuta não encontrada")
    minuta = chk.data[0]

    if body.conteudo_md and body.conteudo_md != minuta["conteudo_md"]:
        updated = await salvar_versao(minuta_id, body.conteudo_md, DEFAULT_USER)
    else:
        upd_data: dict = {}
        if body.titulo:
            upd_data["titulo"] = body.titulo
        if body.status:
            upd_data["status"] = body.status
            if body.status == "aprovado":
                upd_data["revisado_por"] = str(DEFAULT_USER)
                upd_data["revisado_at"] = _utcnow()

        upd_r = await sb_run(
            lambda: sb.table("minutas").update(upd_data).eq("id", str(minuta_id)).execute()
        )
        updated = upd_r.data[0]

    await audit_svc.registrar("atualizar", "minuta", minuta_id,
                               dados_depois=body.model_dump(exclude_none=True),
                               usuario_id=DEFAULT_USER)
    return updated


@router.delete("/{minuta_id}", status_code=204)
async def deletar_minuta(processo_id: uuid.UUID, minuta_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("minutas").delete()
        .eq("id", str(minuta_id))
        .eq("processo_id", str(processo_id))
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Minuta não encontrada")
