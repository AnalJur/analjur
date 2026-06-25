"""
Módulo Financeiro — honorários e parcelas.
"""

import uuid
from datetime import date, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ..database import get_supabase, sb_run

router = APIRouter(prefix="/financeiro", tags=["Financeiro"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class HonorarioCreate(BaseModel):
    cliente_id: str
    processo_id: Optional[str] = None
    tipo: str = "fixo"               # fixo | exito | parcelas | hora
    descricao: Optional[str] = None
    valor_total: float = 0.0
    percentual_exito: Optional[float] = None
    valor_causa: Optional[float] = None
    num_parcelas: int = 1            # gera parcelas automaticamente
    data_inicio: Optional[str] = None
    observacoes: Optional[str] = None


class HonorarioUpdate(BaseModel):
    descricao: Optional[str] = None
    valor_total: Optional[float] = None
    status: Optional[str] = None
    observacoes: Optional[str] = None
    data_fim: Optional[str] = None


class PagamentoCreate(BaseModel):
    valor_pago: float
    data_pagamento: str              # YYYY-MM-DD
    forma_pagamento: str = "pix"
    observacoes: Optional[str] = None


# ── Dashboard financeiro ──────────────────────────────────────────────────────

@router.get("/dashboard")
async def dashboard_financeiro():
    """KPIs e resumo do módulo financeiro."""
    sb = get_supabase()

    # Parcelas
    parcelas_res = await sb_run(
        lambda: sb.table("parcelas_honorario")
        .select("valor,valor_pago,status,vencimento,cliente_id")
        .execute()
    )
    parcelas = parcelas_res.data or []

    total_contratado = sum(p["valor"] for p in parcelas)
    total_recebido   = sum((p.get("valor_pago") or 0) for p in parcelas if p["status"] == "pago")
    total_pendente   = sum(p["valor"] for p in parcelas if p["status"] == "pendente")
    total_vencido    = sum(p["valor"] for p in parcelas if p["status"] == "vencido")

    # Próximos 30 dias
    hoje   = date.today()
    limite = hoje + timedelta(days=30)
    proximos = [
        p for p in parcelas
        if p["status"] == "pendente" and p.get("vencimento")
        and hoje <= date.fromisoformat(p["vencimento"]) <= limite
    ]
    valor_proximos = sum(p["valor"] for p in proximos)

    # Timesheet acumulado (horas × valor)
    ts_res = await sb_run(
        lambda: sb.table("timesheet").select("valor_total").execute()
    )
    valor_timesheet = sum((r.get("valor_total") or 0) for r in (ts_res.data or []))

    return {
        "total_contratado": total_contratado,
        "total_recebido":   total_recebido,
        "total_pendente":   total_pendente,
        "total_vencido":    total_vencido,
        "valor_proximos_30d": valor_proximos,
        "qtd_proximos_30d":   len(proximos),
        "valor_timesheet_acumulado": valor_timesheet,
        "taxa_inadimplencia": round(total_vencido / total_contratado * 100, 1) if total_contratado else 0,
    }


# ── Honorários ────────────────────────────────────────────────────────────────

@router.get("/honorarios")
async def listar_honorarios(
    cliente_id: Optional[str] = None,
    processo_id: Optional[str] = None,
    status: Optional[str] = None,
):
    sb = get_supabase()
    q = sb.table("honorarios").select(
        "*, clientes(nome), processos(numero_cnj, assunto)"
    )
    if cliente_id:  q = q.eq("cliente_id", cliente_id)
    if processo_id: q = q.eq("processo_id", processo_id)
    if status:      q = q.eq("status", status)
    res = await sb_run(lambda: q.order("created_at", desc=True).execute())
    return res.data or []


@router.post("/honorarios", status_code=201)
async def criar_honorario(body: HonorarioCreate):
    sb = get_supabase()
    hid = str(uuid.uuid4())
    inicio = body.data_inicio or date.today().isoformat()

    row = {
        "id":               hid,
        "cliente_id":       body.cliente_id,
        "processo_id":      body.processo_id,
        "tipo":             body.tipo,
        "descricao":        body.descricao,
        "valor_total":      body.valor_total,
        "percentual_exito": body.percentual_exito,
        "valor_causa":      body.valor_causa,
        "status":           "ativo",
        "data_inicio":      inicio,
        "observacoes":      body.observacoes,
    }
    res = await sb_run(lambda: sb.table("honorarios").insert(row).execute())
    honorario = res.data[0]

    # ── Gera parcelas automaticamente ────────────────────────────────────────
    if body.num_parcelas >= 1 and body.valor_total > 0:
        n     = body.num_parcelas
        valor_parcela = round(body.valor_total / n, 2)
        data_base     = date.fromisoformat(inicio)
        parcelas = []
        for i in range(n):
            # Parcela i vence no mesmo dia dos meses seguintes
            mes = data_base.month - 1 + i
            ano = data_base.year + mes // 12
            mes = (mes % 12) + 1
            try:
                venc = date(ano, mes, data_base.day)
            except ValueError:
                # Dia inexistente no mês (ex: 31 de fevereiro) → último dia
                import calendar
                venc = date(ano, mes, calendar.monthrange(ano, mes)[1])
            parcelas.append({
                "id":            str(uuid.uuid4()),
                "honorario_id":  hid,
                "cliente_id":    body.cliente_id,
                "processo_id":   body.processo_id,
                "numero_parcela": i + 1,
                "valor":         valor_parcela,
                "vencimento":    venc.isoformat(),
                "status":        "pendente",
            })
        if parcelas:
            await sb_run(lambda: sb.table("parcelas_honorario").insert(parcelas).execute())

    return honorario


@router.patch("/honorarios/{honorario_id}")
async def atualizar_honorario(honorario_id: str, body: HonorarioUpdate):
    sb = get_supabase()
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "Nenhum campo para atualizar")
    updates["updated_at"] = "NOW()"
    res = await sb_run(
        lambda: sb.table("honorarios").update(updates).eq("id", honorario_id).execute()
    )
    if not res.data:
        raise HTTPException(404, "Honorário não encontrado")
    return res.data[0]


@router.delete("/honorarios/{honorario_id}", status_code=204)
async def deletar_honorario(honorario_id: str):
    sb = get_supabase()
    await sb_run(lambda: sb.table("parcelas_honorario").delete().eq("honorario_id", honorario_id).execute())
    await sb_run(lambda: sb.table("honorarios").delete().eq("id", honorario_id).execute())


# ── Parcelas ──────────────────────────────────────────────────────────────────

@router.get("/honorarios/{honorario_id}/parcelas")
async def listar_parcelas(honorario_id: str):
    sb = get_supabase()
    res = await sb_run(
        lambda: sb.table("parcelas_honorario")
        .select("*")
        .eq("honorario_id", honorario_id)
        .order("numero_parcela")
        .execute()
    )
    return res.data or []


@router.get("/parcelas")
async def listar_todas_parcelas(
    cliente_id: Optional[str] = None,
    status: Optional[str] = None,
    vencimento_ate: Optional[str] = None,
):
    sb = get_supabase()
    q = sb.table("parcelas_honorario").select("*")
    if cliente_id:     q = q.eq("cliente_id", cliente_id)
    if status:         q = q.eq("status", status)
    if vencimento_ate: q = q.lte("vencimento", vencimento_ate)
    res = await sb_run(lambda: q.order("vencimento").execute())
    return res.data or []


@router.post("/parcelas/{parcela_id}/pagar", status_code=200)
async def registrar_pagamento(parcela_id: str, body: PagamentoCreate):
    """Registra o pagamento de uma parcela."""
    sb = get_supabase()
    res = await sb_run(
        lambda: sb.table("parcelas_honorario").update({
            "status":           "pago",
            "data_pagamento":   body.data_pagamento,
            "valor_pago":       body.valor_pago,
            "forma_pagamento":  body.forma_pagamento,
            "observacoes":      body.observacoes,
            "updated_at":       "NOW()",
        }).eq("id", parcela_id).execute()
    )
    if not res.data:
        raise HTTPException(404, "Parcela não encontrada")
    return res.data[0]


@router.post("/parcelas/{parcela_id}/cancelar", status_code=200)
async def cancelar_parcela(parcela_id: str):
    sb = get_supabase()
    res = await sb_run(
        lambda: sb.table("parcelas_honorario").update({
            "status": "cancelado", "updated_at": "NOW()"
        }).eq("id", parcela_id).execute()
    )
    if not res.data:
        raise HTTPException(404, "Parcela não encontrada")
    return res.data[0]


# ── Gerar honorário a partir do timesheet ────────────────────────────────────

@router.post("/honorarios/from-timesheet/{processo_id}", status_code=201)
async def honorario_from_timesheet(processo_id: str):
    """
    Converte as horas lançadas no timesheet de um processo em um honorário 'hora'.
    """
    sb = get_supabase()

    # Busca processo
    proc_res = await sb_run(
        lambda: sb.table("processos")
        .select("numero_cnj,assunto,cliente_id")
        .eq("id", processo_id)
        .limit(1)
        .execute()
    )
    if not proc_res.data:
        raise HTTPException(404, "Processo não encontrado")
    proc = proc_res.data[0]
    if not proc.get("cliente_id"):
        raise HTTPException(400, "Processo sem cliente vinculado. Vincule um cliente primeiro.")

    # Busca timesheet
    ts_res = await sb_run(
        lambda: sb.table("timesheet")
        .select("duracao_min,valor_hora,valor_total,descricao")
        .eq("processo_id", processo_id)
        .execute()
    )
    entradas = ts_res.data or []
    if not entradas:
        raise HTTPException(400, "Nenhum lançamento de tempo encontrado para este processo.")

    total_min   = sum(e.get("duracao_min", 0) for e in entradas)
    total_valor = sum(e.get("valor_total", 0) for e in entradas)

    hid = str(uuid.uuid4())
    label = proc.get("numero_cnj") or proc.get("assunto") or processo_id[:8]
    row = {
        "id":          hid,
        "cliente_id":  proc["cliente_id"],
        "processo_id": processo_id,
        "tipo":        "hora",
        "descricao":   f"Honorários por horas — {label} ({round(total_min/60, 1)}h)",
        "valor_total": round(total_valor, 2),
        "status":      "ativo",
        "data_inicio": date.today().isoformat(),
    }
    res = await sb_run(lambda: sb.table("honorarios").insert(row).execute())
    honorario = res.data[0]

    # Gera 1 parcela à vista
    parcela = {
        "id":            str(uuid.uuid4()),
        "honorario_id":  hid,
        "cliente_id":    proc["cliente_id"],
        "processo_id":   processo_id,
        "numero_parcela": 1,
        "valor":         round(total_valor, 2),
        "vencimento":    date.today().isoformat(),
        "status":        "pendente",
    }
    await sb_run(lambda: sb.table("parcelas_honorario").insert(parcela).execute())

    return {**honorario, "total_horas": round(total_min / 60, 2), "total_entradas": len(entradas)}
