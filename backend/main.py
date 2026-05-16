"""
AnalJur API — Entry point
"""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from .routers import processos, documentos, analises, revisao, minutas, jobs, admin
from .services.worker import loop_worker


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Inicia worker de jobs em background
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
    allow_origins=["http://localhost:3000", "http://localhost:3001", "https://*.vercel.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(processos.router)
app.include_router(documentos.router)
app.include_router(analises.router)
app.include_router(revisao.router)
app.include_router(minutas.router)
app.include_router(jobs.router)
app.include_router(admin.router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "2.0.0"}
