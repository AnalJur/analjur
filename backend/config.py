from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
from pathlib import Path

# Localiza o .env relativo a este arquivo (backend/config.py → ../env)
_ENV_FILE = Path(__file__).parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
        env_ignore_empty=True,   # ignora vars de ambiente vazias; usa o .env
    )

    anthropic_api_key: str = ""
    voyage_api_key: str = ""
    supabase_url: str = ""
    supabase_service_key: str = ""
    database_url: str = ""
    next_public_api_url: str = "http://localhost:8000"

    chunk_tokens: int = 1000
    chunk_overlap: int = 150
    embedding_model: str = "voyage-law-2"
    llm_model: str = "claude-sonnet-4-20250514"
    rag_top_k: int = 8

    default_tenant_id: str = "00000000-0000-0000-0000-000000000001"
    default_usuario_id: str = "00000000-0000-0000-0000-000000000002"

    def get_db_url(self) -> str:
        url = self.database_url
        if not url:
            ref = self.supabase_url.replace("https://", "").replace(".supabase.co", "")
            url = f"postgresql+asyncpg://postgres:{ref}@db.{ref}.supabase.co:6543/postgres"
        # Remove ?ssl=require — handled via connect_args in database.py
        return url.split("?")[0]


@lru_cache
def get_settings() -> Settings:
    return Settings()
