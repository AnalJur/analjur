import uuid
import json
from typing import Optional
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Query

import anthropic

from ..database import get_supabase, sb_run
from ..schemas import (
    ProcessoCreate, ProcessoUpdate, ProcessoOut,
    ParteCreate, ParteOut,
    PecaOut,
    CronologiaCreate, CronologiaUpdate, CronologiaOut,
    SnapshotOut,
)
from ..services import audit_svc, snapshot_svc
from ..config import get_settings

router = APIRouter(prefix="/processos", tags=["Processos"])
settings = get_settings()

DEFAULT_TENANT = settings.default_tenant_id
DEFAULT_USER   = settings.default_usuario_id


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("", response_model=list[ProcessoOut])
async def listar_processos(status: Optional[str] = Query(None)):
    sb = get_supabase()
    q = sb.table("v_processos").select("*").order("updated_at", desc=True).limit(200)
    if status:
        q = q.eq("status", status)
    result = await sb_run(q.execute)
    processos = result.data or []

    # Fallback responsavel via metadados
    for p in processos:
        if not p.get("responsavel"):
            p["responsavel"] = (p.get("metadados") or {}).get("responsavel")

    # Enriquece com cliente_nome via batch lookup
    cliente_ids = list({p["cliente_id"] for p in processos if p.get("cliente_id")})
    if cliente_ids:
        cl_result = await sb_run(
            lambda: sb.table("clientes").select("id,nome").in_("id", cliente_ids).execute()
        )
        nome_map = {c["id"]: c["nome"] for c in (cl_result.data or [])}
        for p in processos:
            if p.get("cliente_id"):
                p["cliente_nome"] = nome_map.get(p["cliente_id"])

    return processos


@router.post("", response_model=ProcessoOut, status_code=201)
async def criar_processo(body: ProcessoCreate):
    sb = get_supabase()
    proc_data = {
        "id": str(uuid.uuid4()),
        "tenant_id": DEFAULT_TENANT,
        "created_by": DEFAULT_USER,
        **{k: v for k, v in body.model_dump().items() if v is not None},
    }
    ins = await sb_run(lambda: sb.table("processos").insert(proc_data).execute())
    new_id = ins.data[0]["id"]

    await audit_svc.registrar("criar", "processo", new_id,
                               dados_depois=body.model_dump(),
                               usuario_id=uuid.UUID(DEFAULT_USER))

    view = await sb_run(
        lambda: sb.table("v_processos").select("*").eq("id", new_id).limit(1).execute()
    )
    return view.data[0]


@router.get("/{processo_id}", response_model=ProcessoOut)
async def obter_processo(processo_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("v_processos").select("*").eq("id", str(processo_id)).limit(1).execute()
    )
    if not result.data:
        raise HTTPException(404, "Processo não encontrado")
    p = result.data[0]
    # Fallback: responsavel salvo em metadados (texto livre)
    if not p.get("responsavel"):
        p["responsavel"] = (p.get("metadados") or {}).get("responsavel")
    return p


@router.patch("/{processo_id}", response_model=ProcessoOut)
async def atualizar_processo(processo_id: uuid.UUID, body: ProcessoUpdate):
    sb = get_supabase()
    dados = body.model_dump(exclude_none=True)
    if not dados:
        raise HTTPException(400, "Nenhum campo para atualizar")

    # stringify UUID fields
    if "responsavel_id" in dados and dados["responsavel_id"]:
        dados["responsavel_id"] = str(dados["responsavel_id"])

    # responsavel como texto livre → merge em metadados["responsavel"]
    responsavel_nome: Optional[str] = dados.pop("responsavel", None)
    if responsavel_nome is not None:
        curr = await sb_run(
            lambda: sb.table("processos")
            .select("metadados")
            .eq("id", str(processo_id))
            .limit(1)
            .execute()
        )
        meta = (curr.data[0].get("metadados") or {}) if curr.data else {}
        meta["responsavel"] = responsavel_nome
        dados["metadados"] = meta

    upd = await sb_run(
        lambda: sb.table("processos").update(dados).eq("id", str(processo_id)).execute()
    )
    if not upd.data:
        raise HTTPException(404, "Processo não encontrado")

    await audit_svc.registrar("atualizar", "processo", processo_id,
                               dados_depois=dados, usuario_id=uuid.UUID(DEFAULT_USER))

    view = await sb_run(
        lambda: sb.table("v_processos").select("*").eq("id", str(processo_id)).limit(1).execute()
    )
    resultado = view.data[0]

    # Se a view não retorna responsavel (join nulo), usa o valor de metadados
    if not resultado.get("responsavel") and responsavel_nome:
        resultado["responsavel"] = responsavel_nome

    return resultado


@router.delete("/{processo_id}", status_code=204)
async def deletar_processo(processo_id: uuid.UUID):
    sb = get_supabase()
    check = await sb_run(
        lambda: sb.table("processos").select("id").eq("id", str(processo_id)).limit(1).execute()
    )
    if not check.data:
        raise HTTPException(404, "Processo não encontrado")
    await audit_svc.registrar("deletar", "processo", processo_id,
                               usuario_id=uuid.UUID(DEFAULT_USER))
    await sb_run(
        lambda: sb.table("processos").delete().eq("id", str(processo_id)).execute()
    )


# ── Partes ────────────────────────────────────────────────────────────────

@router.get("/{processo_id}/partes", response_model=list[ParteOut])
async def listar_partes(processo_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("partes").select("*").eq("processo_id", str(processo_id)).execute()
    )
    return result.data


@router.post("/{processo_id}/partes", response_model=ParteOut, status_code=201)
async def adicionar_parte(processo_id: uuid.UUID, body: ParteCreate):
    sb = get_supabase()
    parte_data = {
        "id": str(uuid.uuid4()),
        "processo_id": str(processo_id),
        **body.model_dump(),
    }
    result = await sb_run(lambda: sb.table("partes").insert(parte_data).execute())
    return result.data[0]


# ── Peças (nível processo) ────────────────────────────────────────────────

@router.get("/{processo_id}/pecas", response_model=list[PecaOut])
async def listar_pecas_processo(processo_id: uuid.UUID):
    """Retorna todas as peças de todos os documentos do processo, com conteúdo."""
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("pecas")
        .select("id,documento_id,tipo_peca,pagina_inicio,pagina_fim,data_documento,autor,resumo,conteudo_texto,confianca_classificacao,created_at")
        .eq("processo_id", str(processo_id))
        .order("pagina_inicio", desc=False)
        .execute()
    )
    return result.data or []


# ── Cronologia ────────────────────────────────────────────────────────────

@router.get("/{processo_id}/cronologia", response_model=list[CronologiaOut])
async def obter_cronologia(processo_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("cronologia").select("*")
        .eq("processo_id", str(processo_id))
        .order("data_evento", desc=False)
        .execute()
    )
    return result.data


@router.post("/{processo_id}/cronologia", response_model=CronologiaOut, status_code=201)
async def criar_evento(processo_id: uuid.UUID, body: CronologiaCreate):
    sb = get_supabase()
    data = {
        "id": str(uuid.uuid4()),
        "processo_id": str(processo_id),
        "fonte": body.fonte or "manual",
        **{k: (str(v) if hasattr(v, 'isoformat') else v)
           for k, v in body.model_dump(exclude_none=True).items()},
    }
    result = await sb_run(lambda: sb.table("cronologia").insert(data).execute())
    return result.data[0]


@router.patch("/{processo_id}/cronologia/{evento_id}", response_model=CronologiaOut)
async def atualizar_evento(processo_id: uuid.UUID, evento_id: uuid.UUID, body: CronologiaUpdate):
    sb = get_supabase()
    dados = {k: (str(v) if hasattr(v, 'isoformat') else v)
             for k, v in body.model_dump(exclude_none=True).items()}
    if not dados:
        raise HTTPException(400, "Nenhum campo para atualizar")
    result = await sb_run(
        lambda: sb.table("cronologia").update(dados)
        .eq("id", str(evento_id))
        .eq("processo_id", str(processo_id))
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Evento não encontrado")
    return result.data[0]


@router.patch("/{processo_id}/cronologia/{evento_id}/validar", response_model=CronologiaOut)
async def validar_evento(processo_id: uuid.UUID, evento_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("cronologia").update({"validado": True})
        .eq("id", str(evento_id))
        .eq("processo_id", str(processo_id))
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Evento não encontrado")
    return result.data[0]


@router.delete("/{processo_id}/cronologia/{evento_id}", status_code=204)
async def deletar_evento(processo_id: uuid.UUID, evento_id: uuid.UUID):
    sb = get_supabase()
    check = await sb_run(
        lambda: sb.table("cronologia").select("id")
        .eq("id", str(evento_id))
        .eq("processo_id", str(processo_id))
        .limit(1)
        .execute()
    )
    if not check.data:
        raise HTTPException(404, "Evento não encontrado")
    await sb_run(
        lambda: sb.table("cronologia").delete()
        .eq("id", str(evento_id))
        .execute()
    )


# ── Snapshots ─────────────────────────────────────────────────────────────

@router.get("/{processo_id}/snapshots", response_model=list[SnapshotOut])
async def listar_snapshots(processo_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("snapshots").select("*")
        .eq("processo_id", str(processo_id))
        .order("versao", desc=True)
        .execute()
    )
    return result.data


@router.post("/{processo_id}/snapshots", response_model=SnapshotOut, status_code=201)
async def criar_snapshot(processo_id: uuid.UUID):
    snap = await snapshot_svc.criar_snapshot(
        processo_id, "manual", uuid.UUID(DEFAULT_USER)
    )
    return snap


@router.get("/{processo_id}/snapshots/{snap_id}", response_model=SnapshotOut)
async def obter_snapshot(processo_id: uuid.UUID, snap_id: uuid.UUID):
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("snapshots").select("*")
        .eq("id", str(snap_id))
        .eq("processo_id", str(processo_id))
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Snapshot não encontrado")
    return result.data[0]


@router.get("/{processo_id}/snapshots/comparar/{snap_a}/{snap_b}")
async def comparar(processo_id: uuid.UUID, snap_a: uuid.UUID, snap_b: uuid.UUID):
    return await snapshot_svc.comparar_snapshots(snap_a, snap_b)


# ── Extração automática completa da petição inicial ──────────────────────────

_PROMPT_EXTRAIR_COMPLETO = """
Você é um assistente jurídico especializado em processos judiciais brasileiros.
Analise o texto abaixo (petição inicial ou documento processual) e extraia TODOS os dados relevantes.

Retorne APENAS um JSON válido com esta estrutura exata (sem texto antes ou depois):
{
  "processo": {
    "numero_cnj": "0000000-00.0000.0.00.0000 (ou null)",
    "tribunal": "TJGO, TJSP, TRF1, TST... (sigla oficial, ou null)",
    "vara": "nome completo da vara ou câmara (ou null)",
    "cidade": "cidade onde tramita o processo (ou null)",
    "assunto": "resumo do pedido principal em até 15 palavras (ou null)"
  },
  "polo_ativo": [
    {
      "nome": "Nome completo",
      "tipo": "pf",
      "cpf_cnpj": "000.000.000-00 (ou null)",
      "endereco": "endereço completo (ou null)",
      "email": "email (ou null)",
      "telefone": "telefone (ou null)",
      "qualificacao": "qualificação como aparece no texto (ou null)"
    }
  ],
  "polo_passivo": [
    {
      "nome": "Nome completo",
      "tipo": "pf",
      "cpf_cnpj": "000.000.000-00 (ou null)",
      "endereco": "endereço completo (ou null)",
      "email": "email (ou null)",
      "telefone": "telefone (ou null)",
      "qualificacao": "qualificação como aparece no texto (ou null)"
    }
  ],
  "advogados": [
    {
      "nome": "Nome completo",
      "oab": "OAB/UF 000000 (ou null)"
    }
  ]
}

Regras obrigatórias:
- "tipo": use "pf" para pessoa física, "pj" para pessoa jurídica
- Polo ativo = autor, requerente, exequente, reclamante, impetrante
- Polo passivo = réu, requerido, executado, reclamado, impetrado
- Se uma informação não aparecer no texto, use null — NUNCA invente
- Se houver múltiplas partes em um polo, inclua todas
- Número CNJ: formato exato 7-2.4.1.2.4 (ex: 5001234-56.2024.8.09.0051)
- Tribunal: derive do número CNJ se necessário (segmento: 8=TJ, 4=TRF, 5=TRT...)
- Retorne SOMENTE o JSON, nada mais

TEXTO DO DOCUMENTO:
"""


@router.post("/{processo_id}/extrair-partes")
async def extrair_partes_peticao(processo_id: uuid.UUID):
    """
    Extrai automaticamente via IA todos os dados da petição inicial:
    número CNJ, tribunal, vara, cidade, assunto + partes e advogados.
    Atualiza o processo com os metadados encontrados e retorna tudo.
    """
    sb = get_supabase()

    # Busca o processo atual para saber quais campos já estão preenchidos
    proc_res = await sb_run(
        lambda: sb.table("processos")
        .select("numero_cnj,tribunal,vara,assunto,cidade")
        .eq("id", str(processo_id))
        .limit(1)
        .execute()
    )
    proc_atual = proc_res.data[0] if proc_res.data else {}

    # Busca peças priorizando petição inicial
    pecas_res = await sb_run(
        lambda: sb.table("pecas")
        .select("id,tipo_peca,conteudo_texto,pagina_inicio")
        .eq("processo_id", str(processo_id))
        .not_.is_("conteudo_texto", "null")
        .order("pagina_inicio")
        .execute()
    )
    pecas = pecas_res.data or []

    if not pecas:
        raise HTTPException(
            404,
            "Nenhuma peça com texto encontrada. Faça o upload do PDF e aguarde o processamento concluir."
        )

    TIPOS_PRIORITARIOS = [
        "peticao_inicial", "petição inicial", "peticao inicial",
        "inicial", "exordial", "reclamacao_trabalhista",
        "mandado_seguranca", "acao", "requerimento",
    ]
    peca_alvo = None
    for t in TIPOS_PRIORITARIOS:
        for p in pecas:
            if t.lower() in (p.get("tipo_peca") or "").lower():
                peca_alvo = p
                break
        if peca_alvo:
            break

    if not peca_alvo:
        peca_alvo = pecas[0]

    # Usa as primeiras 10 000 chars — suficiente para cabeçalho + qualificação das partes
    texto = (peca_alvo.get("conteudo_texto") or "")[:10_000]

    if len(texto.strip()) < 100:
        raise HTTPException(
            422,
            "Texto da peça muito curto. Verifique se o documento foi processado corretamente (OCR pode ter falhado)."
        )

    settings_obj = get_settings()
    client = anthropic.Anthropic(api_key=settings_obj.anthropic_api_key)

    try:
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=2048,
            messages=[{"role": "user", "content": _PROMPT_EXTRAIR_COMPLETO + texto}],
        )
        raw = msg.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        dados = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(500, "Erro ao interpretar resposta da IA. Tente novamente.")
    except anthropic.APIError as e:
        raise HTTPException(502, f"Erro na API de IA: {e}")

    # ── Auto-atualiza o processo com os campos extraídos ─────────────────────
    proc_meta = dados.get("processo") or {}
    campos_atualizar = {}
    campos_preenchidos = []

    for campo in ("numero_cnj", "tribunal", "vara", "cidade", "assunto"):
        valor_extraido = proc_meta.get(campo)
        # Só preenche se veio algo e o campo estava vazio
        if valor_extraido and not proc_atual.get(campo):
            campos_atualizar[campo] = valor_extraido
            campos_preenchidos.append(campo)

    if campos_atualizar:
        await sb_run(
            lambda: sb.table("processos")
            .update(campos_atualizar)
            .eq("id", str(processo_id))
            .execute()
        )

    return {
        "peca_usada": {
            "id": str(peca_alvo["id"]),
            "tipo": peca_alvo.get("tipo_peca"),
            "pagina": peca_alvo.get("pagina_inicio"),
        },
        "processo_atualizado": campos_preenchidos,
        "processo": proc_meta,
        "polo_ativo":  dados.get("polo_ativo", []),
        "polo_passivo": dados.get("polo_passivo", []),
        "advogados":   dados.get("advogados", []),
    }
