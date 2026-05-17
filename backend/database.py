"""
Conexão via supabase-py (REST API / PostgREST).
Elimina asyncpg/IPv6 — todas as chamadas vão por HTTPS (IPv4).
"""

import asyncio
from supabase import create_client, Client
from .config import get_settings

settings = get_settings()

_supabase_client: Client | None = None


def get_supabase() -> Client:
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = create_client(
            settings.supabase_url, settings.supabase_service_key
        )
    return _supabase_client


async def sb_run(fn):
    """Executa uma chamada sync do supabase-py na thread pool."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, fn)
