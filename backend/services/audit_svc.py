"""
Registro de auditoria para todas as ações críticas.
"""

import uuid
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from ..models import AuditLog
from ..config import get_settings

settings = get_settings()


async def registrar(
    db: AsyncSession,
    acao: str,
    entidade: str,
    entidade_id: Optional[uuid.UUID] = None,
    dados_antes: Optional[dict] = None,
    dados_depois: Optional[dict] = None,
    usuario_id: Optional[uuid.UUID] = None,
    tenant_id: Optional[uuid.UUID] = None,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> None:
    log = AuditLog(
        tenant_id=tenant_id or uuid.UUID(settings.default_tenant_id),
        usuario_id=usuario_id,
        acao=acao,
        entidade=entidade,
        entidade_id=entidade_id,
        dados_antes=dados_antes,
        dados_depois=dados_depois,
        ip=ip,
        user_agent=user_agent,
    )
    db.add(log)
    # Não faz flush aqui — o commit da sessão englobante persiste tudo junto
