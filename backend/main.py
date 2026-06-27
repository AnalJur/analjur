"""
AnalJur API — Entry point
"""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from .routers import processos, documentos, analises, revisao, minutas, jobs, admin, auth, prazos
from .routers.prazos import router_util as prazos_util
from .routers.monitoramento import router as monitoramento_router
from .routers.relatorio import router as relatorio_router
from .routers.atendimentos import router as atendimentos_router
from .routers.clientes import router as clientes_router
from .routers.agenda import router as agenda_router
from .routers.financeiro import router as financeiro_router
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
app.include_router(prazos.router)
app.include_router(prazos_util)
app.include_router(revisao.router)
app.include_router(minutas.router)
app.include_router(jobs.router)
app.include_router(admin.router)
app.include_router(monitoramento_router)
app.include_router(relatorio_router)
app.include_router(atendimentos_router)
app.include_router(clientes_router)
app.include_router(agenda_router)
app.include_router(financeiro_router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "3.0.0", "engine": "claude-direct"}


@app.get("/health/tavily")
async def health_tavily():
    """Verifica se a integração com Tavily está ativa e funcional."""
    from .config import get_settings
    from .services import jurisprudencia_svc

    cfg = get_settings()
    if not cfg.tavily_api_key:
        return {"status": "desativado", "motivo": "TAVILY_API_KEY não configurada"}

    try:
        resultados = await jurisprudencia_svc.buscar_jurisprudencia(
            teses=["responsabilidade civil dano moral"], area="civil", max_por_tese=1
        )
        return {
            "status": "ok",
            "configurada": True,
            "teste_resultados": len(resultados),
            "exemplo": resultados[0]["titulo"] if resultados else None,
        }
    except Exception as e:
        return {"status": "erro", "configurada": True, "detalhe": str(e)}


@app.get("/debug/db")
async def debug_db():
    from .database import get_supabase, sb_run
    try:
        sb = get_supabase()
        result = await sb_run(lambda: sb.table("processos").select("id", count="exact").limit(1).execute())
        return {"ok": True, "processos": result.count, "transport": "supabase-REST"}
    except Exception as e:
        return {"ok": False, "error": str(e)}
