"""
Lógica de negócio para integração AnalJur ↔ sistemas externos.

- Upsert de mapeamentos (integracoes_externas)
- Construção de payloads padronizados
- Disparo de eventos financeiros para sistemas externos
"""

from __future__ import annotations

import uuid
import hashlib
import json
from datetime import datetime, timezone
from typing import Optional

from loguru import logger

from ..config import get_settings
from ..database import get_supabase, sb_run
from . import webhook_svc

settings = get_settings()


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _idempotency_key(*partes: str) -> str:
    return hashlib.sha256("|".join(partes).encode()).hexdigest()[:32]


# ── Mapeamentos ───────────────────────────────────────────────────────────────

async def buscar_mapeamento(
    origem_sistema: str,
    origem_tipo: str,
    origem_id: str,
) -> Optional[dict]:
    sb = get_supabase()
    rows = await sb_run(
        sb.table("integracoes_externas")
        .select("*")
        .eq("origem_sistema", origem_sistema)
        .eq("origem_tipo", origem_tipo)
        .eq("origem_id", origem_id)
        .limit(1)
    )
    return rows[0] if rows else None


async def upsert_mapeamento(
    origem_sistema: str,
    origem_tipo: str,
    origem_id: str,
    destino_sistema: str,
    destino_tipo: str,
    destino_id: Optional[str] = None,
    dados_enviados: Optional[dict] = None,
) -> dict:
    sb = get_supabase()
    chave = _idempotency_key(origem_sistema, origem_tipo, origem_id)

    existente = await buscar_mapeamento(origem_sistema, origem_tipo, origem_id)
    if existente:
        upd: dict = {"updated_at": _utcnow()}
        if destino_id:
            upd["destino_id"] = destino_id
            upd["status"] = "sincronizado"
            upd["ultimo_sync"] = _utcnow()
        if dados_enviados:
            upd["dados_enviados"] = dados_enviados
        rows = await sb_run(
            sb.table("integracoes_externas")
            .update(upd)
            .eq("id", existente["id"])
            .select()
        )
        return rows[0]

    rows = await sb_run(
        sb.table("integracoes_externas").insert({
            "origem_sistema":  origem_sistema,
            "origem_tipo":     origem_tipo,
            "origem_id":       origem_id,
            "destino_sistema": destino_sistema,
            "destino_tipo":    destino_tipo,
            "destino_id":      destino_id,
            "idempotency_key": chave,
            "status":          "sincronizado" if destino_id else "pendente",
            "dados_enviados":  dados_enviados,
        }).select()
    )
    return rows[0]


async def marcar_erro(integracao_id: str, erro: str, tentativas: int) -> None:
    sb = get_supabase()
    await sb_run(
        sb.table("integracoes_externas")
        .update({"status": "erro", "erro": erro, "tentativas": tentativas})
        .eq("id", integracao_id)
    )


# ── Construtores de payload ───────────────────────────────────────────────────

async def _enriquecer_processo(processo_id: str) -> dict:
    sb = get_supabase()
    rows = await sb_run(
        sb.table("processos")
        .select("id, numero_processo, cliente_id, tenant_id")
        .eq("id", processo_id)
        .limit(1)
    )
    if not rows:
        return {}
    p = rows[0]
    return {
        "processo_id":     p["id"],
        "processo_numero": p.get("numero_processo", ""),
        "empresa_id":      p.get("tenant_id", settings.default_tenant_id),
    }


async def construir_payload_parcela(parcela: dict) -> dict:
    """Monta payload padrão para honorario_parcela."""
    extra = await _enriquecer_processo(parcela.get("processo_id", ""))
    return {
        "event_id":       f"evt_honorario_parcela_{parcela['id']}_{uuid.uuid4().hex[:8]}",
        "evento":         "honorario_parcela.updated",
        "timestamp":      _utcnow(),
        "origem_sistema": "analjur",
        "origem_tipo":    "honorario_parcela",
        "origem_id":      parcela["id"],
        "updated_at":     parcela.get("updated_at", _utcnow()),
        "dados": {
            **extra,
            "honorario_id":   parcela.get("honorario_id"),
            "parcela_id":     parcela["id"],
            "numero_parcela": parcela.get("numero_parcela"),
            "total_parcelas": parcela.get("total_parcelas"),
            "valor":          float(parcela.get("valor", 0)),
            "vencimento":     parcela.get("vencimento"),
            "status":         parcela.get("status", "em_aberto"),
            "tipo":           parcela.get("tipo", "honorario"),
            "descricao":      parcela.get("descricao"),
        },
    }


async def construir_payload_custa(custa: dict) -> dict:
    """Monta payload padrão para custa processual."""
    extra = await _enriquecer_processo(custa.get("processo_id", ""))
    return {
        "event_id":       f"evt_custa_{custa['id']}_{uuid.uuid4().hex[:8]}",
        "evento":         "custa.updated",
        "timestamp":      _utcnow(),
        "origem_sistema": "analjur",
        "origem_tipo":    "custa",
        "origem_id":      custa["id"],
        "updated_at":     custa.get("updated_at", _utcnow()),
        "dados": {
            **extra,
            "custa_id":   custa["id"],
            "descricao":  custa.get("descricao"),
            "valor":      float(custa.get("valor", 0)),
            "vencimento": custa.get("vencimento"),
            "status":     custa.get("status", "pendente"),
            "tipo":       custa.get("tipo", "custa"),
        },
    }


# ── Disparo de evento financeiro ──────────────────────────────────────────────

async def disparar_evento_financeiro(
    tipo: str,       # 'honorario_parcela' | 'custa'
    registro: dict,
) -> Optional[str]:
    """
    Constrói payload, cria mapeamento e enfileira evento para entrega.
    Retorna event_id ou None se não há destino configurado.
    """
    if tipo == "honorario_parcela":
        payload = await construir_payload_parcela(registro)
    elif tipo == "custa":
        payload = await construir_payload_custa(registro)
    else:
        logger.warning(f"Tipo desconhecido para disparo: {tipo}")
        return None

    mapeamento = await upsert_mapeamento(
        origem_sistema="analjur",
        origem_tipo=tipo,
        origem_id=registro["id"],
        destino_sistema="gestor360",
        destino_tipo="lancamento",
        dados_enviados=payload,
    )

    event_id = await webhook_svc.enfileirar_evento(
        evento=payload["evento"],
        payload=payload,
        integracao_id=mapeamento["id"],
        correlation_id=payload.get("dados", {}).get("processo_id"),
    )
    return event_id
