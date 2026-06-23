"""
Auth router — login/logout via Supabase Auth (supabase-py client).
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..database import get_supabase, sb_run

router = APIRouter(prefix="/auth", tags=["Auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/login")
async def login(body: LoginRequest):
    try:
        sb = get_supabase()
        result = await sb_run(
            lambda: sb.auth.sign_in_with_password(
                {"email": body.email, "password": body.password}
            )
        )
    except Exception as exc:
        msg = str(exc)
        # supabase-py raises AuthApiError with message "Invalid login credentials"
        if "invalid" in msg.lower() or "credentials" in msg.lower() or "email" in msg.lower():
            raise HTTPException(status_code=401, detail="Credenciais inválidas")
        raise HTTPException(status_code=503, detail=f"Serviço de autenticação indisponível: {msg}")

    if not result or not result.session:
        raise HTTPException(status_code=401, detail="Credenciais inválidas")

    return {
        "access_token": result.session.access_token,
        "refresh_token": result.session.refresh_token,
        "token_type": "bearer",
        "user": {
            "id": str(result.user.id),
            "email": result.user.email,
        },
    }


@router.post("/logout")
async def logout():
    # Token revocation is client-side only for now
    return {"ok": True}
