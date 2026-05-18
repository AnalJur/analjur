from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
from pathlib import Path

_ENV_FILE = Path(__file__).parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
        env_ignore_empty=True,
    )

    anthropic_api_key: str = ""
    supabase_url: str = ""
    supabase_service_key: str = ""
    database_url: str = ""
    next_public_api_url: str = "http://localhost:8000"

    llm_model: str = "claude-sonnet-4-20250514"

    default_tenant_id: str = "00000000-0000-0000-0000-000000000001"
    default_usuario_id: str = "00000000-0000-0000-0000-000000000002"


@lru_cache
def get_settings() -> Settings:
    return Settings()
