"""
AnalJur API — Entry point
"""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from .routers import processos, documentos, analises, revisao, minutas, jobs, admin, auth
from .services.worker import loop_worker


@asynccontextmanager
async def lifespan(app: FastAPI):
    worker_task = asyncio.create_task(loop_worker(intervalo_sec=3.0))
    logger.info("AnalJur API iniciada")
    yield
    worker_task.cancel()
    logger.info("AnalJur API encerrada")


app = FastAPI(
    title="AnalJur API",
    description="Sistema jurídico-operacional de análise inteligente de processos",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "https://analjur.vercel.app",
        "https://analjur-git-master-analjur.vercel.app",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(processos.router)
app.include_router(documentos.router)
app.include_router(analises.router)
app.include_router(revisao.router)
app.include_router(minutas.router)
app.include_router(jobs.router)
app.include_router(admin.router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "3.0.0", "engine": "claude-direct"}


@app.get("/debug/db")
async def debug_db():
    from .database import get_supabase, sb_run
    try:
        sb = get_supabase()
        result = await sb_run(lambda: sb.table("processos").select("id", count="exact").limit(1).execute())
        return {"ok": True, "processos": result.count, "transport": "supabase-REST"}
    except Exception as e:
        return {"ok": False, "error": str(e)}
