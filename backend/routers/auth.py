"""
Auth router — login/logout via Supabase Auth.
"""
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..config import get_settings

router = APIRouter(prefix="/auth", tags=["Auth"])
settings = get_settings()


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/login")
async def login(body: LoginRequest):
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{settings.supabase_url}/auth/v1/token?grant_type=password",
            headers={
                "apikey": settings.supabase_service_key,
                "Content-Type": "application/json",
            },
            json={"email": body.email, "password": body.password},
            timeout=10.0,
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Credenciais inválidas")

    data = resp.json()
    return {
        "access_token": data["access_token"],
        "refresh_token": data.get("refresh_token"),
        "token_type": "bearer",
        "user": {
            "id": data["user"]["id"],
            "email": data["user"]["email"],
        },
    }


@router.post("/logout")
async def logout():
    # Token revocation is client-side only for now
    return {"ok": True}
