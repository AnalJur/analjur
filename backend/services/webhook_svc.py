"""
Serviço de webhooks — AnalJur ↔ sistemas externos.

Responsabilidades:
- Assinar payloads com HMAC-SHA256 para envio
- Verificar assinaturas recebidas
- Enfileirar e entregar eventos com retry exponencial
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx
from loguru import logger

from ..database import get_supabase, sb_run


# Backoff exponencial: 30s, 5min, 30min, 2h, 24h
_RETRY_DELAYS_SEC = [30, 300, 1800, 7200, 86400]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _signing_string(timestamp: str, event_id: str, body_raw: bytes) -> str:
    body_hash = hashlib.sha256(body_raw).hexdigest()
    return f"{timestamp}.{event_id}.{body_hash}"


def assinar_payload(payload: dict, hmac_secret: str, event_id: Optional[str] = None) -> dict:
    """
    Retorna os headers necessários para um webhook autenticado.
    Signing string: timestamp.event_id.sha256(body)
    """
    if event_id is None:
        event_id = str(uuid.uuid4())
    timestamp = str(int(time.time()))
    body_raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    signing = _signing_string(timestamp, event_id, body_raw)
    signature = hmac.new(
        hmac_secret.encode("utf-8"),
        signing.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return {
        "X-Event-Id": event_id,
        "X-Timestamp": timestamp,
        "X-Signature": signature,
        "Content-Type": "application/json",
    }


def verificar_hmac_recebido(
    body_raw: bytes,
    event_id: str,
    timestamp: str,
    signature_recebida: str,
    hmac_secret: str,
    janela_seg: int = 300,
) -> bool:
    """Valida HMAC de webhook recebido. Rejeita se fora da janela de 5 minutos."""
    try:
        ts = int(timestamp)
    except (ValueError, TypeError):
        return False

    if abs(int(time.time()) - ts) > janela_seg:
        logger.warning("Webhook rejeitado: timestamp fora da janela")
        return False

    signing = _signing_string(timestamp, event_id, body_raw)
    esperada = hmac.new(
        hmac_secret.encode("utf-8"),
        signing.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(esperada, signature_recebida)


async def _buscar_secret(sistema: str) -> Optional[str]:
    """Busca o hmac_secret da chave ativa para o sistema."""
    sb = get_supabase()
    rows = await sb_run(
        sb.table("integracoes_chaves")
        .select("hmac_secret")
        .eq("sistema", sistema)
        .eq("ativo", True)
        .limit(1)
    )
    if rows:
        return rows[0]["hmac_secret"]
    return None


async def enfileirar_evento(
    *,
    evento: str,
    payload: dict,
    integracao_id: Optional[str] = None,
    correlation_id: Optional[str] = None,
    direcao: str = "enviado",
) -> str:
    """
    Registra evento na fila. O worker processa e envia.
    Retorna o event_id gerado.
    """
    event_id = f"evt_{evento.replace('.', '_')}_{uuid.uuid4().hex[:12]}"
    sb = get_supabase()
    await sb_run(
        sb.table("integracoes_eventos").insert({
            "event_id": event_id,
            "integracao_id": integracao_id,
            "correlation_id": correlation_id,
            "evento": evento,
            "direcao": direcao,
            "payload": payload,
            "status": "pendente",
            "tentativas": 0,
            "proximo_retry": _utcnow().isoformat(),
        })
    )
    logger.info(f"Evento enfileirado: {event_id} ({evento})")
    return event_id


async def entregar_evento(evento_row: dict, destino_url: str, hmac_secret: str) -> bool:
    """
    Tenta entregar um evento via HTTP POST.
    Atualiza o registro com resultado (sucesso ou erro + próximo retry).
    """
    event_id = evento_row["event_id"]
    payload = evento_row["payload"]
    tentativas = evento_row.get("tentativas", 0)

    headers = assinar_payload(payload, hmac_secret, event_id=event_id)

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                destino_url,
                content=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                headers=headers,
            )
            sucesso = resp.status_code < 400
    except Exception as e:
        logger.warning(f"Webhook {event_id} falhou com exceção: {e}")
        sucesso = False
        resp = None

    sb = get_supabase()
    agora = _utcnow()

    if sucesso:
        await sb_run(
            sb.table("integracoes_eventos")
            .update({
                "status": "confirmado",
                "tentativas": tentativas + 1,
                "http_status": resp.status_code if resp else None,
                "processado_at": agora.isoformat(),
                "erro": None,
            })
            .eq("id", evento_row["id"])
        )
        logger.info(f"Webhook {event_id} entregue ({resp.status_code if resp else '?'})")
        return True

    nova_tentativa = tentativas + 1
    if nova_tentativa >= len(_RETRY_DELAYS_SEC):
        novo_status = "falhou"
        proximo = agora.isoformat()
    else:
        novo_status = "erro"
        delay = _RETRY_DELAYS_SEC[nova_tentativa - 1]
        from datetime import timedelta
        proximo = (agora + timedelta(seconds=delay)).isoformat()

    erro_msg = f"HTTP {resp.status_code}" if resp else "Timeout/conexão"
    await sb_run(
        sb.table("integracoes_eventos")
        .update({
            "status": novo_status,
            "tentativas": nova_tentativa,
            "http_status": resp.status_code if resp else None,
            "proximo_retry": proximo,
            "erro": erro_msg,
        })
        .eq("id", evento_row["id"])
    )
    logger.warning(f"Webhook {event_id} falhou ({erro_msg}), tentativa {nova_tentativa}")
    return False
