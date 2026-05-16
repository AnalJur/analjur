import uuid
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from ..database import get_db
from ..models import Job
from ..schemas import JobOut

router = APIRouter(prefix="/jobs", tags=["Jobs / Fila"])


@router.get("", response_model=list[JobOut])
async def listar_jobs(
    status: str | None = Query(None),
    tipo: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    q = select(Job)
    if status:
        q = q.where(Job.status == status)
    if tipo:
        q = q.where(Job.tipo == tipo)
    q = q.order_by(Job.created_at.desc()).limit(100)
    result = await db.execute(q)
    return result.scalars().all()


@router.get("/fila/status")
async def status_fila(db: AsyncSession = Depends(get_db)):
    result = await db.execute(text("SELECT * FROM v_jobs_fila"))
    return [dict(r) for r in result.mappings().all()]


@router.get("/{job_id}", response_model=JobOut)
async def obter_job(job_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    job = await db.get(Job, job_id)
    if not job:
        from fastapi import HTTPException
        raise HTTPException(404, "Job não encontrado")
    return job
