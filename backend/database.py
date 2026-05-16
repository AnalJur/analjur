"""
Conexão dupla:
- SQLAlchemy async (asyncpg) → CRUD relacional em todas as tabelas novas
- supabase-py → RPC de busca vetorial (pgvector via Supabase Functions)
"""

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from supabase import create_client, Client
from .config import get_settings

settings = get_settings()

# --- SQLAlchemy -----------------------------------------------------------
_db_url = settings.get_db_url()
_connect_args = {"ssl": "require"} if "supabase.co" in _db_url else {}

engine = create_async_engine(
    _db_url,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,
    echo=False,
    connect_args=_connect_args,
)

AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


class Base(DeclarativeBase):
    __allow_unmapped__ = True


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# --- Supabase client (para busca vetorial via RPC) -------------------------
_supabase_client: Client | None = None


def get_supabase() -> Client:
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = create_client(
            settings.supabase_url, settings.supabase_service_key
        )
    return _supabase_client
