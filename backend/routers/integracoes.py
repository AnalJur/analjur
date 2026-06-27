"""
Router de integração — AnalJur ↔ sistemas externos.

Endpoints de leitura (Gestor 360 puxa dados):
  GET /api/integracoes/clientes
  GET /api/integracoes/processos
  GET /api/integracoes/honorarios-parcelas
  GET /api/integracoes/custas

Recebimento de eventos:
  POST /api/integracoes/eventos/financeiro

Monitoramento:
  GET /api/integracoes/status
  GET /api/integracoes/eventos
"""

from __future__ import annotations

import hashlib
import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from loguru import logger

from ..database import get_supabase, sb_run
from ..services import webhook_svc, integracoes_svc

router = APIRouter(prefix="/api/integracoes", tags=["integracoes"])


# ── Autenticação simples por API Key ──────────────────────────────────────────

async def _validar_api_key(x_api_key: str = Header(alias="X-Api-Key")) -> dict:
    """Verifica se a chave existe e está ativa. Retorna o registro da chave."""
    chave_hash = hashlib.sha256(x_api_key.encode()).hexdigest()
    sb = get_supabase()
    rows = await sb_run(
        sb.table("integracoes_chaves")
        .select("*")
        .eq("chave_hash", chave_hash)
        .eq("ativo", True)
        .limit(1)
    )
    if not rows:
        raise HTTPException(status_code=401, detail="API Key inválida ou inativa")

    chave = rows[0]
    # Atualiza ultimo_uso (fire-and-forget)
    try:
        await sb_run(
            sb.table("integracoes_chaves")
            .update({"ultimo_uso": datetime.now(timezone.utc).isoformat()})
            .eq("id", chave["id"])
        )
    except Exception:
        pass
    return chave


def _cursor_decode(cursor: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """Decodifica cursor base64 → (updated_at, id)."""
    if not cursor:
        return None, None
    try:
        import base64
        decoded = base64.b64decode(cursor.encode()).decode()
        updated_at, row_id = decoded.split("|", 1)
        return updated_at, row_id
    except Exception:
        return None, None


def _cursor_encode(updated_at: str, row_id: str) -> str:
    import base64
    raw = f"{updated_at}|{row_id}"
    return base64.b64encode(raw.encode()).decode()


# ── Endpoints de leitura ──────────────────────────────────────────────────────

@router.get("/clientes")
async def listar_clientes(
    updated_since: Optional[str] = Query(None, description="ISO8601 — só registros alterados após esta data"),
    cursor: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    _key: dict = Depends(_validar_api_key),
):
    sb = get_supabase()
    q = sb.table("clientes").select(
        "id, nome, cpf_cnpj, email, telefone, tipo, ativo, created_at, updated_at"
    ).order("updated_at").order("id").limit(limit)

    cur_updated, cur_id = _cursor_decode(cursor)
    if cur_updated and cur_id:
        q = q.gt("updated_at", cur_updated)
    elif updated_since:
        q = q.gte("updated_at", updated_since)

    rows = await sb_run(q)
    next_cursor = None
    if len(rows) == limit:
        last = rows[-1]
        next_cursor = _cursor_encode(last["updated_at"], last["id"])

    return {"data": rows, "next_cursor": next_cursor, "has_more": next_cursor is not None}


@router.get("/processos")
async def listar_processos(
    updated_since: Optional[str] = Query(None),
    cursor: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    _key: dict = Depends(_validar_api_key),
):
    sb = get_supabase()
    q = sb.table("processos").select(
        "id, numero_processo, cliente_id, tipo_causa, comarca, vara, fase_processual, "
        "status, tenant_id, created_at, updated_at"
    ).order("updated_at").order("id").limit(limit)

    cur_updated, cur_id = _cursor_decode(cursor)
    if cur_updated and cur_id:
        q = q.gt("updated_at", cur_updated)
    elif updated_since:
        q = q.gte("updated_at", updated_since)

    rows = await sb_run(q)
    next_cursor = None
    if len(rows) == limit:
        last = rows[-1]
        next_cursor = _cursor_encode(last["updated_at"], last["id"])

    return {"data": rows, "next_cursor": next_cursor, "has_more": next_cursor is not None}


@router.get("/honorarios-parcelas")
async def listar_honorarios_parcelas(
    updated_since: Optional[str] = Query(None),
    cursor: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    _key: dict = Depends(_validar_api_key),
):
    sb = get_supabase()
    q = sb.table("parcelas_honorario").select(
        "id, honorario_id, numero_parcela, total_parcelas, valor, "
        "vencimento, status, tipo, descricao, created_at, updated_at"
    ).order("updated_at").order("id").limit(limit)

    cur_updated, cur_id = _cursor_decode(cursor)
    if cur_updated and cur_id:
        q = q.gt("updated_at", cur_updated)
    elif updated_since:
        q = q.gte("updated_at", updated_since)

    rows = await sb_run(q)
    next_cursor = None
    if len(rows) == limit:
        last = rows[-1]
        next_cursor = _cursor_encode(last["updated_at"], last["id"])

    return {"data": rows, "next_cursor": next_cursor, "has_more": next_cursor is not None}


@router.get("/custas")
async def listar_custas(
    updated_since: Optional[str] = Query(None),
    cursor: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    _key: dict = Depends(_validar_api_key),
):
    sb = get_supabase()
    q = sb.table("custas").select(
        "id, processo_id, descricao, valor, vencimento, status, tipo, created_at, updated_at"
    ).order("updated_at").order("id").limit(limit)

    cur_updated, cur_id = _cursor_decode(cursor)
    if cur_updated and cur_id:
        q = q.gt("updated_at", cur_updated)
    elif updated_since:
        q = q.gte("updated_at", updated_since)

    rows = await sb_run(q)
    next_cursor = None
    if len(rows) == limit:
        last = rows[-1]
        next_cursor = _cursor_encode(last["updated_at"], last["id"])

    return {"data": rows, "next_cursor": next_cursor, "has_more": next_cursor is not None}


# ── Recebimento de eventos externos ──────────────────────────────────────────

@router.post("/eventos/financeiro")
async def receber_evento_financeiro(
    request: Request,
    x_api_key: str = Header(alias="X-Api-Key"),
    x_event_id: str = Header(alias="X-Event-Id"),
    x_timestamp: str = Header(alias="X-Timestamp"),
    x_signature: str = Header(alias="X-Signature"),
):
    """Recebe eventos do Gestor 360 (pagamentos confirmados, etc.)."""
    chave_hash = hashlib.sha256(x_api_key.encode()).hexdigest()
    sb = get_supabase()
    chaves = await sb_run(
        sb.table("integracoes_chaves")
        .select("hmac_secret, permissoes")
        .eq("chave_hash", chave_hash)
        .eq("ativo", True)
        .limit(1)
    )
    if not chaves:
        raise HTTPException(status_code=401, detail="API Key inválida")

    chave = chaves[0]
    if "webhook_receive" not in (chave.get("permissoes") or []):
        raise HTTPException(status_code=403, detail="Chave sem permissão para receber webhooks")

    body_raw = await request.body()
    if not webhook_svc.verificar_hmac_recebido(
        body_raw, x_event_id, x_timestamp, x_signature, chave["hmac_secret"]
    ):
        raise HTTPException(status_code=401, detail="Assinatura HMAC inválida")

    import json
    payload = json.loads(body_raw)

    # Registra evento recebido (idempotente via event_id UNIQUE)
    try:
        await webhook_svc.enfileirar_evento(
            evento=payload.get("evento", "externo.evento"),
            payload=payload,
            direcao="recebido",
        )
    except Exception:
        pass  # Duplicate event_id → evento já processado

    logger.info(f"Evento recebido do Gestor 360: {x_event_id}")
    return {"status": "aceito", "event_id": x_event_id}


# ── Monitoramento ─────────────────────────────────────────────────────────────

@router.get("/status")
async def status_integracao(_key: dict = Depends(_validar_api_key)):
    """Resumo do estado atual da fila de eventos e mapeamentos."""
    sb = get_supabase()

    eventos = await sb_run(
        sb.table("integracoes_eventos")
        .select("status")
        .order("created_at", desc=True)
        .limit(1000)
    )
    contagem: dict[str, int] = {}
    for e in eventos:
        s = e["status"]
        contagem[s] = contagem.get(s, 0) + 1

    mapeamentos = await sb_run(
        sb.table("integracoes_externas")
        .select("status")
        .limit(1000)
    )
    map_contagem: dict[str, int] = {}
    for m in mapeamentos:
        s = m["status"]
        map_contagem[s] = map_contagem.get(s, 0) + 1

    return {
        "eventos": contagem,
        "mapeamentos": map_contagem,
        "webhook_url_configurada": bool(os.getenv("GESTOR360_WEBHOOK_URL")),
    }


@router.get("/eventos")
async def listar_eventos(
    status: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    _key: dict = Depends(_validar_api_key),
):
    sb = get_supabase()
    q = (
        sb.table("integracoes_eventos")
        .select("id, event_id, evento, direcao, status, tentativas, http_status, erro, created_at, processado_at")
        .order("created_at", desc=True)
        .limit(limit)
    )
    if status:
        q = q.eq("status", status)

    rows = await sb_run(q)
    return {"data": rows, "total": len(rows)}
