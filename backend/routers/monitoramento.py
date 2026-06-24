"""
Rotas de monitoramento DataJud.
"""

import uuid
from fastapi import APIRouter, HTTPException

from ..services.datajud_svc import sincronizar_processo, sincronizar_todos_ativos

router = APIRouter(tags=["Monitoramento DataJud"])


@router.post("/processos/{processo_id}/sync-datajud")
async def sync_processo_datajud(processo_id: uuid.UUID):
    """
    Sincroniza as movimentações de um processo com o DataJud (CNJ).
    Cria entradas de cronologia para eventos novos e atualiza metadados.
    """
    try:
        resultado = await sincronizar_processo(processo_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Erro ao consultar o DataJud: {e}",
        )
    return resultado


@router.post("/admin/sync-datajud-todos")
async def sync_todos_datajud():
    """
    Sincroniza todos os processos ativos com o DataJud.
    Use com moderação — cada processo faz uma chamada HTTP ao CNJ.
    """
    resultado = await sincronizar_todos_ativos()
    return resultado
