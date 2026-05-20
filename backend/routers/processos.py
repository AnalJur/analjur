import uuid
from typing import Optional
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Query

from ..database import get_supabase, sb_run
from ..schemas import (
    ProcessoCreate, ProcessoUpdate, ProcessoOut,
    ParteCreate, ParteOut,
    CronologiaCreate, CronologiaUpdate, CronologiaOut,
    SnapshotOut,
)
from ..services import audit_svc, snapshot_svc
from ..config import get_settings

router = APIRouter(prefix="/processos", tags=["Processos"])
settings = get_settings()

DEFAULT_TENANT = settings.default_tenant_id
DEFAULT_USER   = settings.default_usuario_id


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("", response_model=list[ProcessoOut])
async def listar_processos(status: Optional[str] = Query(None)):
    sb = get_supabase()
    q = sb.table("v_processos").select("*").order("updated_at", desc=True).limit(200)
    if status:
        q = q.eq("status", status)
    result = await sb_run(q.execute)
    # Fallback responsavel via metadados para processos sem responsavel_id
    processos = result.data or []
    for p in processos:
        if not p.get("responsavel"):
            p["responsavel"] = (p.get("metadados") or {}).get("responsavel")
    return processos


@router.post("", response_model=ProcessoOut, status_code=201)
async def criar_processo(body: ProcessoCreate):
    sb = get_supabase()
    proc_data = {
        "id": str(uuid.uuid4()),
        "tenant_id": DEFAULT_TENANT,
        "created_by": DEFAULT_USER,
        **{k: v for k, v in body.model_dump().items() if v is not None},
    }
    ins = await sb_run(lambda: sb.table("processos").insert(proc_data).execute())
    new_id = ins.data[0]["id"]

    await audit_svc.registrar("criar", "processo", new_id,
                               dados_depois=body.model_dump(),
                               usuario_id=uuid.UUID(DEFAULT_USER))

    view = await sb_run(
        lambda: sb.table("v_processos").select("*").eq("id", new_id).limit(1).execute()
    )
    return view.data[0]


@router.get("/{processo_id}", response_model=ProcessoOut)
async def obter_processo(processo_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("v_processos").select("*").eq("id", str(processo_id)).limit(1).execute()
    )
    if not result.data:
        raise HTTPException(404, "Processo não encontrado")
    p = result.data[0]
    # Fallback: responsavel salvo em metadados (texto livre)
    if not p.get("responsavel"):
        p["responsavel"] = (p.get("metadados") or {}).get("responsavel")
    return p


@router.patch("/{processo_id}", response_model=ProcessoOut)
async def atualizar_processo(processo_id: uuid.UUID, body: ProcessoUpdate):
    sb = get_supabase()
    dados = body.model_dump(exclude_none=True)
    if not dados:
        raise HTTPException(400, "Nenhum campo para atualizar")

    # stringify UUID fields
    if "responsavel_id" in dados and dados["responsavel_id"]:
        dados["responsavel_id"] = str(dados["responsavel_id"])

    # responsavel como texto livre → merge em metadados["responsavel"]
    responsavel_nome: Optional[str] = dados.pop("responsavel", None)
    if responsavel_nome is not None:
        curr = await sb_run(
            lambda: sb.table("processos")
            .select("metadados")
            .eq("id", str(processo_id))
            .limit(1)
            .execute()
        )
        meta = (curr.data[0].get("metadados") or {}) if curr.data else {}
        meta["responsavel"] = responsavel_nome
        dados["metadados"] = meta

    upd = await sb_run(
        lambda: sb.table("processos").update(dados).eq("id", str(processo_id)).execute()
    )
    if not upd.data:
        raise HTTPException(404, "Processo não encontrado")

    await audit_svc.registrar("atualizar", "processo", processo_id,
                               dados_depois=dados, usuario_id=uuid.UUID(DEFAULT_USER))

    view = await sb_run(
        lambda: sb.table("v_processos").select("*").eq("id", str(processo_id)).limit(1).execute()
    )
    resultado = view.data[0]

    # Se a view não retorna responsavel (join nulo), usa o valor de metadados
    if not resultado.get("responsavel") and responsavel_nome:
        resultado["responsavel"] = responsavel_nome

    return resultado


@router.delete("/{processo_id}", status_code=204)
async def deletar_processo(processo_id: uuid.UUID):
    sb = get_supabase()
    check = await sb_run(
        lambda: sb.table("processos").select("id").eq("id", str(processo_id)).limit(1).execute()
    )
    if not check.data:
        raise HTTPException(404, "Processo não encontrado")
    await audit_svc.registrar("deletar", "processo", processo_id,
                               usuario_id=uuid.UUID(DEFAULT_USER))
    await sb_run(
        lambda: sb.table("processos").delete().eq("id", str(processo_id)).execute()
    )


# ── Partes ────────────────────────────────────────────────────────────────

@router.get("/{processo_id}/partes", response_model=list[ParteOut])
async def listar_partes(processo_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("partes").select("*").eq("processo_id", str(processo_id)).execute()
    )
    return result.data


@router.post("/{processo_id}/partes", response_model=ParteOut, status_code=201)
async def adicionar_parte(processo_id: uuid.UUID, body: ParteCreate):
    sb = get_supabase()
    parte_data = {
        "id": str(uuid.uuid4()),
        "processo_id": str(processo_id),
        **body.model_dump(),
    }
    result = await sb_run(lambda: sb.table("partes").insert(parte_data).execute())
    return result.data[0]


# ── Cronologia ────────────────────────────────────────────────────────────

@router.get("/{processo_id}/cronologia", response_model=list[CronologiaOut])
async def obter_cronologia(processo_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("cronologia").select("*")
        .eq("processo_id", str(processo_id))
        .order("data_evento", desc=False)
        .execute()
    )
    return result.data


@router.post("/{processo_id}/cronologia", response_model=CronologiaOut, status_code=201)
async def criar_evento(processo_id: uuid.UUID, body: CronologiaCreate):
    sb = get_supabase()
    data = {
        "id": str(uuid.uuid4()),
        "processo_id": str(processo_id),
        "fonte": body.fonte or "manual",
        **{k: (str(v) if hasattr(v, 'isoformat') else v)
           for k, v in body.model_dump(exclude_none=True).items()},
    }
    result = await sb_run(lambda: sb.table("cronologia").insert(data).execute())
    return result.data[0]


@router.patch("/{processo_id}/cronologia/{evento_id}", response_model=CronologiaOut)
async def atualizar_evento(processo_id: uuid.UUID, evento_id: uuid.UUID, body: CronologiaUpdate):
    sb = get_supabase()
    dados = {k: (str(v) if hasattr(v, 'isoformat') else v)
             for k, v in body.model_dump(exclude_none=True).items()}
    if not dados:
        raise HTTPException(400, "Nenhum campo para atualizar")
    result = await sb_run(
        lambda: sb.table("cronologia").update(dados)
        .eq("id", str(evento_id))
        .eq("processo_id", str(processo_id))
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Evento não encontrado")
    return result.data[0]


@router.patch("/{processo_id}/cronologia/{evento_id}/validar", response_model=CronologiaOut)
async def validar_evento(processo_id: uuid.UUID, evento_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("cronologia").update({"validado": True})
        .eq("id", str(evento_id))
        .eq("processo_id", str(processo_id))
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Evento não encontrado")
    return result.data[0]


@router.delete("/{processo_id}/cronologia/{evento_id}", status_code=204)
async def deletar_evento(processo_id: uuid.UUID, evento_id: uuid.UUID):
    sb = get_supabase()
    check = await sb_run(
        lambda: sb.table("cronologia").select("id")
        .eq("id", str(evento_id))
        .eq("processo_id", str(processo_id))
        .limit(1)
        .execute()
    )
    if not check.data:
        raise HTTPException(404, "Evento não encontrado")
    await sb_run(
        lambda: sb.table("cronologia").delete()
        .eq("id", str(evento_id))
        .execute()
    )


# ── Snapshots ─────────────────────────────────────────────────────────────

@router.get("/{processo_id}/snapshots", response_model=list[SnapshotOut])
async def listar_snapshots(processo_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("snapshots").select("*")
        .eq("processo_id", str(processo_id))
        .order("versao", desc=True)
        .execute()
    )
    return result.data


@router.post("/{processo_id}/snapshots", response_model=SnapshotOut, status_code=201)
async def criar_snapshot(processo_id: uuid.UUID):
    snap = await snapshot_svc.criar_snapshot(
        processo_id, "manual", uuid.UUID(DEFAULT_USER)
    )
    return snap


@router.get("/{processo_id}/snapshots/{snap_id}", response_model=SnapshotOut)
async def obter_snapshot(processo_id: uuid.UUID, snap_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("snapshots").select("*")
        .eq("id", str(snap_id))
        .eq("processo_id", str(processo_id))
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Snapshot não encontrado")
    return result.data[0]


@router.get("/{processo_id}/snapshots/comparar/{snap_a}/{snap_b}")
async def comparar(processo_id: uuid.UUID, snap_a: uuid.UUID, snap_b: uuid.UUID):
    return await snapshot_svc.comparar_snapshots(snap_a, snap_b)
