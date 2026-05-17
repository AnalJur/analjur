"""
Registro de auditoria para todas as ações críticas.
"""

import uuid
from typing import Optional
from ..database import get_supabase, sb_run
from ..config import get_settings

settings = get_settings()


async def registrar(
    acao: str,
    entidade: str,
    entidade_id=None,
    dados_antes: Optional[dict] = None,
    dados_depois: Optional[dict] = None,
    usuario_id: Optional[uuid.UUID] = None,
    tenant_id: Optional[uuid.UUID] = None,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> None:
    sb = get_supabase()
    log_data = {
        "id": str(uuid.uuid4()),
        "tenant_id": str(tenant_id) if tenant_id else settings.default_tenant_id,
        "usuario_id": str(usuario_id) if usuario_id else None,
        "acao": acao,
        "entidade": entidade,
        "entidade_id": str(entidade_id) if entidade_id else None,
        "dados_antes": dados_antes,
        "dados_depois": dados_depois,
        "ip": ip,
        "user_agent": user_agent,
    }
    try:
        await sb_run(lambda: sb.table("audit_log").insert(log_data).execute())
    except Exception:
        pass  # audit nunca deve quebrar o fluxo principal
