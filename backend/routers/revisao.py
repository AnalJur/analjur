import uuid
from typing import Optional
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Query

from ..database import get_supabase, sb_run
from ..schemas import TarefaCreate, TarefaUpdate, TarefaOut
from ..services import audit_svc
from ..config import get_settings

router = APIRouter(prefix="/revisao", tags=["Revisão Humana"])
settings = get_settings()
DEFAULT_USER = uuid.UUID(settings.default_usuario_id)


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("/tarefas", response_model=list[TarefaOut])
async def listar_tarefas(
    status: Optional[str] = Query(None),
    processo_id: Optional[uuid.UUID] = Query(None),
    prioridade: Optional[str] = Query(None),
):
    sb = get_supabase()
    q = sb.table("tarefas_revisao").select("*")
    if status:
        q = q.eq("status", status)
    if processo_id:
        q = q.eq("processo_id", str(processo_id))
    if prioridade:
        q = q.eq("prioridade", prioridade)
    q = q.order("created_at", desc=True).limit(200)
    result = await sb_run(q.execute)
    return result.data


@router.post("/tarefas", response_model=TarefaOut, status_code=201)
async def criar_tarefa(body: TarefaCreate):
    sb = get_supabase()
    tarefa_data = {
        "id": str(uuid.uuid4()),
        "atribuido_por": str(DEFAULT_USER),
        **{k: (str(v) if isinstance(v, uuid.UUID) else v)
           for k, v in body.model_dump(exclude_none=True).items()},
    }
    result = await sb_run(lambda: sb.table("tarefas_revisao").insert(tarefa_data).execute())
    return result.data[0]


@router.get("/tarefas/{tarefa_id}", response_model=TarefaOut)
async def obter_tarefa(tarefa_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("tarefas_revisao").select("*")
        .eq("id", str(tarefa_id))
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Tarefa não encontrada")
    return result.data[0]


@router.patch("/tarefas/{tarefa_id}", response_model=TarefaOut)
async def atualizar_tarefa(tarefa_id: uuid.UUID, body: TarefaUpdate):
    sb = get_supabase()

    dados = body.model_dump(exclude_none=True)
    if body.status in ("aprovado", "rejeitado", "cancelado"):
        dados["concluido_por"] = str(DEFAULT_USER)
        dados["concluido_at"] = _utcnow()

    upd = await sb_run(
        lambda: sb.table("tarefas_revisao").update(dados)
        .eq("id", str(tarefa_id))
        .execute()
    )
    if not upd.data:
        raise HTTPException(404, "Tarefa não encontrada")

    await audit_svc.registrar("atualizar", "tarefa", tarefa_id,
                               dados_depois=dados, usuario_id=DEFAULT_USER)
    return upd.data[0]


@router.delete("/tarefas/{tarefa_id}", status_code=204)
async def deletar_tarefa(tarefa_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("tarefas_revisao").delete().eq("id", str(tarefa_id)).execute()
    )
    if not result.data:
        raise HTTPException(404, "Tarefa não encontrada")
    await audit_svc.registrar("deletar", "tarefa", tarefa_id, usuario_id=DEFAULT_USER)


@router.get("/resumo")
async def resumo_revisao():
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("tarefas_revisao").select("status,prioridade").execute()
    )
    contagem: dict = {}
    for r in (result.data or []):
        key = (r["status"], r["prioridade"])
        contagem[key] = contagem.get(key, 0) + 1
    return [
        {"status": s, "prioridade": p, "total": t}
        for (s, p), t in contagem.items()
    ]
