import uuid
import json as _json
from typing import Optional
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..database import get_supabase, sb_run
from ..schemas import AnaliseSolicitacao, AnaliseOut, ChatRequest, ChatResponse
from ..services.analise_ia import gerar_analise, gerar_analise_stream, chat_processo
from ..services import audit_svc
from ..config import get_settings

router = APIRouter(prefix="/processos/{processo_id}/analises", tags=["Análises"])
settings = get_settings()
DEFAULT_USER = uuid.UUID(settings.default_usuario_id)


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("", response_model=list[AnaliseOut])
async def listar_analises(processo_id: uuid.UUID, tipo: Optional[str] = Query(None)):
    sb = get_supabase()
    q = sb.table("analises").select("*").eq("processo_id", str(processo_id))
    if tipo:
        q = q.eq("tipo", tipo)
    q = q.order("created_at", desc=True)
    result = await sb_run(q.execute)
    return result.data


@router.post("", response_model=AnaliseOut, status_code=201)
async def solicitar_analise(processo_id: uuid.UUID, body: AnaliseSolicitacao):
    try:
        analise = await gerar_analise(
            processo_id, body.tipo,
            usuario_id=DEFAULT_USER,
            contexto_extra=body.contexto_extra,
            documento_ids=body.documento_ids or None,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    await audit_svc.registrar("criar", "analise", analise["id"],
                               dados_depois={"tipo": body.tipo}, usuario_id=DEFAULT_USER)
    return analise


@router.post("/stream")
async def solicitar_analise_stream(processo_id: uuid.UUID, body: AnaliseSolicitacao):
    """Gera análise e envia progresso via Server-Sent Events (text/event-stream)."""

    async def generate():
        try:
            async for evento in gerar_analise_stream(
                processo_id, body.tipo,
                usuario_id=DEFAULT_USER,
                contexto_extra=body.contexto_extra,
                documento_ids=body.documento_ids or None,
            ):
                if evento.get("type") == "done":
                    await audit_svc.registrar(
                        "criar", "analise", evento["analise"]["id"],
                        dados_depois={"tipo": body.tipo},
                        usuario_id=DEFAULT_USER,
                    )
                line = f"data: {_json.dumps(evento, ensure_ascii=False)}\n\n"
                yield line.encode("utf-8")
        except Exception as exc:
            err = _json.dumps({"type": "error", "msg": str(exc)}, ensure_ascii=False)
            yield f"data: {err}\n\n".encode("utf-8")

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/{analise_id}", response_model=AnaliseOut)
async def obter_analise(processo_id: uuid.UUID, analise_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("analises").select("*")
        .eq("id", str(analise_id))
        .eq("processo_id", str(processo_id))
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Análise não encontrada")
    return result.data[0]


@router.post("/{analise_id}/aprovar", response_model=AnaliseOut)
async def aprovar_analise(processo_id: uuid.UUID, analise_id: uuid.UUID,
                           comentario: Optional[str] = None):
    sb = get_supabase()
    upd_data = {
        "status_revisao": "aprovada",
        "revisado_por": str(DEFAULT_USER),
        "revisado_at": _utcnow(),
    }
    if comentario:
        upd_data["comentario_revisao"] = comentario

    result = await sb_run(
        lambda: sb.table("analises").update(upd_data)
        .eq("id", str(analise_id))
        .eq("processo_id", str(processo_id))
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Análise não encontrada")

    await audit_svc.registrar("aprovar", "analise", analise_id,
                               dados_depois={"status": "aprovada"}, usuario_id=DEFAULT_USER)
    return result.data[0]


@router.post("/{analise_id}/rejeitar", response_model=AnaliseOut)
async def rejeitar_analise(processo_id: uuid.UUID, analise_id: uuid.UUID, comentario: str):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("analises").update({
            "status_revisao": "rejeitada",
            "revisado_por": str(DEFAULT_USER),
            "revisado_at": _utcnow(),
            "comentario_revisao": comentario,
        })
        .eq("id", str(analise_id))
        .eq("processo_id", str(processo_id))
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Análise não encontrada")

    await audit_svc.registrar("rejeitar", "analise", analise_id,
                               dados_depois={"status": "rejeitada", "comentario": comentario},
                               usuario_id=DEFAULT_USER)
    return result.data[0]


@router.delete("/{analise_id}", status_code=204)
async def deletar_analise(processo_id: uuid.UUID, analise_id: uuid.UUID):
    sb = get_supabase()
    check = await sb_run(
        lambda: sb.table("analises").select("id")
        .eq("id", str(analise_id))
        .eq("processo_id", str(processo_id))
        .limit(1)
        .execute()
    )
    if not check.data:
        raise HTTPException(404, "Análise não encontrada")
    # Remove tarefas_revisao vinculadas (FK constraint)
    await sb_run(
        lambda: sb.table("tarefas_revisao").delete()
        .eq("analise_id", str(analise_id))
        .execute()
    )
    await sb_run(
        lambda: sb.table("analises").delete()
        .eq("id", str(analise_id))
        .execute()
    )
    await audit_svc.registrar("deletar", "analise", analise_id, usuario_id=DEFAULT_USER)


@router.post("/chat", response_model=ChatResponse, tags=["Chat"])
async def chat(body: ChatRequest):
    try:
        resposta, fontes, tokens = await chat_processo(
            processo_id=body.processo_id,
            mensagens=[m.model_dump() for m in body.mensagens],
            tipo_peca=body.tipo_peca,
            usar_sonnet=body.usar_sonnet,
        )
    except Exception as e:
        raise HTTPException(500, str(e))
    return ChatResponse(resposta=resposta, fontes=fontes, tokens=tokens)
