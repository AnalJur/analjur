"""
main.py — FastAPI: endpoints da API de análise processual

Endpoints:
  POST /upload          — faz upload e processa PDF
  GET  /processos       — lista processos cadastrados
  POST /analisar        — análise estruturada RAG
  POST /chat            — chat livre sobre o processo
  DELETE /processo/{id} — remove processo
"""

import os
import uuid
import asyncio
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from loguru import logger
from dotenv import load_dotenv

from ingestao import processar_pdf
from embeddings import gerar_embeddings_chunks
from database import inserir_chunks, listar_processos, deletar_processo
from analise import analisar, chat_processual

load_dotenv()

app = FastAPI(
    title="Analisador de Processos Jurídicos",
    description="API para análise de processos judiciais com RAG + Claude",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://seu-dominio.vercel.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Status dos processos sendo ingeridos
status_ingestao: dict[str, dict] = {}


# ---------------------------------------------------------------------------
# Models Pydantic
# ---------------------------------------------------------------------------

class AnalisarRequest(BaseModel):
    processo_id: str
    query: str = "Faça uma análise completa do processo"
    tipo_analise: str = "analise_completa"  # analise_completa | teses | cronologia | riscos
    top_k: int = 10
    tipo_peca: Optional[str] = None


class ChatRequest(BaseModel):
    processo_id: str
    mensagem: str
    historico: list[dict] = []


# ---------------------------------------------------------------------------
# Background task: ingestão completa
# ---------------------------------------------------------------------------

async def _pipeline_ingestao(processo_id: str, caminho_pdf: str):
    """Executa ingestão em background: extração → embeddings → banco."""
    try:
        status_ingestao[processo_id] = {"status": "extraindo", "progresso": 10}

        # 1. Extração e chunking (pode demorar para PDFs grandes)
        loop = asyncio.get_event_loop()
        resultado = await loop.run_in_executor(
            None, processar_pdf, caminho_pdf, processo_id
        )

        status_ingestao[processo_id] = {
            "status": "gerando_embeddings",
            "progresso": 40,
            "chunks": resultado.total_chunks,
        }

        if not resultado.chunks:
            raise ValueError("Nenhum texto extraído do PDF")

        # 2. Gerar embeddings
        chunks_com_emb = await loop.run_in_executor(
            None, gerar_embeddings_chunks, resultado.chunks
        )

        status_ingestao[processo_id] = {
            "status": "salvando",
            "progresso": 80,
            "chunks": len(chunks_com_emb),
        }

        # 3. Salvar no banco
        inseridos = await loop.run_in_executor(
            None, inserir_chunks, chunks_com_emb
        )

        status_ingestao[processo_id] = {
            "status": "concluido",
            "progresso": 100,
            "total_paginas": resultado.total_paginas,
            "total_chunks": inseridos,
            "tem_ocr": resultado.tem_ocr,
            "erros": resultado.erros,
        }

        logger.info(f"Ingestão concluída: {processo_id} | {inseridos} chunks")

    except Exception as e:
        logger.error(f"Falha na ingestão de {processo_id}: {e}")
        status_ingestao[processo_id] = {
            "status": "erro",
            "progresso": 0,
            "erro": str(e),
        }
    finally:
        # Limpar arquivo temporário
        try:
            Path(caminho_pdf).unlink(missing_ok=True)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    return {"msg": "Analisador de Processos Jurídicos API", "versao": "1.0.0"}


@app.post("/upload")
async def upload_pdf(
    background_tasks: BackgroundTasks,
    arquivo: UploadFile = File(...),
    processo_id: Optional[str] = None,
):
    """
    Faz upload de PDF e inicia ingestão em background.
    Retorna processo_id para acompanhar o status.
    """
    if not arquivo.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Apenas arquivos PDF são aceitos")

    pid = processo_id or str(uuid.uuid4())[:8]

    # Salvar PDF temporariamente
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        conteudo = await arquivo.read()
        tmp.write(conteudo)
        caminho_tmp = tmp.name

    tamanho_mb = len(conteudo) / (1024 * 1024)
    logger.info(f"Upload recebido: {arquivo.filename} ({tamanho_mb:.1f} MB) → {pid}")

    # Iniciar ingestão em background
    status_ingestao[pid] = {"status": "iniciando", "progresso": 0}
    background_tasks.add_task(_pipeline_ingestao, pid, caminho_tmp)

    return {
        "processo_id": pid,
        "arquivo": arquivo.filename,
        "tamanho_mb": round(tamanho_mb, 2),
        "status": "ingestão iniciada — acompanhe em /status/{processo_id}",
    }


@app.get("/status/{processo_id}")
def status(processo_id: str):
    """Retorna o status da ingestão de um processo."""
    if processo_id not in status_ingestao:
        raise HTTPException(status_code=404, detail="Processo não encontrado")
    return {"processo_id": processo_id, **status_ingestao[processo_id]}


@app.get("/processos")
def get_processos():
    """Lista todos os processos cadastrados no banco."""
    return listar_processos()


@app.post("/analisar")
async def post_analisar(req: AnalisarRequest):
    """
    Análise estruturada do processo usando RAG + Claude.

    tipo_analise:
    - analise_completa: teses, pontos frágeis, contradições, jurisprudência, riscos
    - teses: foca nas teses das partes
    - cronologia: linha do tempo dos eventos
    - riscos: avaliação de riscos jurídicos
    """
    loop = asyncio.get_event_loop()
    resultado = await loop.run_in_executor(
        None,
        lambda: analisar(
            processo_id=req.processo_id,
            query=req.query,
            tipo_analise=req.tipo_analise,
            top_k=req.top_k,
            tipo_peca=req.tipo_peca,
        ),
    )
    return resultado


@app.post("/chat")
async def post_chat(req: ChatRequest):
    """Chat livre sobre o processo com contexto RAG."""
    loop = asyncio.get_event_loop()
    resposta = await loop.run_in_executor(
        None,
        lambda: chat_processual(
            processo_id=req.processo_id,
            mensagem=req.mensagem,
            historico=req.historico,
        ),
    )
    return {"resposta": resposta}


@app.delete("/processo/{processo_id}")
def delete_processo(processo_id: str):
    """Remove um processo e todos os seus chunks do banco."""
    ok = deletar_processo(processo_id)
    if not ok:
        raise HTTPException(status_code=500, detail="Erro ao remover processo")
    return {"msg": f"Processo {processo_id} removido com sucesso"}


# ---------------------------------------------------------------------------
# Iniciar servidor
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
