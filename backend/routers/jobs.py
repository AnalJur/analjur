import uuid
from typing import Optional
from fastapi import APIRouter, HTTPException, Query

from ..database import get_supabase, sb_run
from ..schemas import JobOut

router = APIRouter(prefix="/jobs", tags=["Jobs / Fila"])


@router.get("", response_model=list[JobOut])
async def listar_jobs(
    status: Optional[str] = Query(None),
    tipo: Optional[str] = Query(None),
):
    sb = get_supabase()
    q = sb.table("jobs").select("*")
    if status:
        q = q.eq("status", status)
    if tipo:
        q = q.eq("tipo", tipo)
    q = q.order("created_at", desc=True).limit(100)
    result = await sb_run(q.execute)
    return result.data


@router.get("/fila/status")
async def status_fila():
    sb = get_supabase()
    result = await sb_run(lambda: sb.table("v_jobs_fila").select("*").execute())
    return result.data


@router.get("/{job_id}", response_model=JobOut)
async def obter_job(job_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("jobs").select("*").eq("id", str(job_id)).limit(1).execute()
    )
    if not result.data:
        raise HTTPException(404, "Job não encontrado")
    return result.data[0]
