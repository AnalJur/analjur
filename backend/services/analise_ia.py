"""
Análises jurídicas via Claude — texto completo + sumarização hierárquica para processos grandes.
"""

import uuid
import json
import functools
from datetime import date as date_type
from typing import Optional

import anthropic
import tiktoken
from loguru import logger

from ..config import get_settings
from ..database import get_supabase, sb_run

settings = get_settings()

_enc = tiktoken.get_encoding("cl100k_base")
MAX_TOKENS_DIRECT = 150_000
PECAS_PRIORITARIAS = {"sentenca", "acordao", "decisao_interlocutoria", "peticao_inicial"}


def _utcnow():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _contar_tokens(texto: str) -> int:
    return len(_enc.encode(texto))


SYSTEM_BASE = """Você é um assistente jurídico com conhecimento e perspectiva de advogado sênior especialista com 20 anos de experiência em direito brasileiro.
Analise os documentos com profundidade, precisão e senso crítico.
REGRAS:
- Baseie-se APENAS no conteúdo fornecido. Nunca invente fatos.
- Cite sempre a fonte (tipo de peça, página) de informações relevantes.
- Sinalize explicitamente qualquer incerteza.
- Não tome decisões jurídicas — analise e recomende para revisão humana.
- Responda SEMPRE em JSON válido conforme o schema solicitado."""


PROMPTS = {
    "estado_atual": {
        "instrucao": """Analise os documentos e retorne o estado atual completo do processo.

JSON schema:
{
  "fase_processual": "string",
  "ultima_movimentacao": {"data": "YYYY-MM-DD ou null", "descricao": "string"},
  "partes": {"autor": ["string"], "reu": ["string"], "advogados": ["string"]},
  "pedidos_principais": ["string"],
  "decisoes_relevantes": [{"data": "YYYY-MM-DD ou null", "tipo": "string", "resumo": "string"}],
  "pendencias": ["string"],
  "prazos_identificados": [{"descricao": "string", "data": "YYYY-MM-DD ou null", "critico": true}],
  "inconsistencias_documentais": ["string"],
  "confianca": 0.0
}""",
    },
    "resumo_executivo": {
        "instrucao": """Gere um resumo executivo completo para um advogado sênior.

JSON schema:
{
  "titulo": "string",
  "resumo": "string",
  "pontos_chave": ["string"],
  "situacao_atual": "string",
  "alertas": ["string"],
  "recomendacoes_imediatas": ["string"],
  "confianca": 0.0
}""",
    },
    "riscos": {
        "instrucao": """Identifique e classifique todos os riscos jurídicos do processo.

JSON schema:
{
  "riscos": [{"categoria": "prazo | probatorio | legal | estrategico | financeiro",
    "descricao": "string", "severidade": "baixa | media | alta | critica",
    "probabilidade": "baixa | media | alta", "mitigacao_sugerida": "string", "fonte": "string"}],
  "exposicao_financeira": {"estimativa": "string", "base": "string"},
  "prazo_mais_urgente": {"descricao": "string", "data": "YYYY-MM-DD ou null"},
  "confianca": 0.0
}""",
    },
    "teses": {
        "instrucao": """Identifique as teses jurídicas presentes e potenciais.

JSON schema:
{
  "teses_autor": [{"tese": "string", "fundamento_legal": "string", "status": "acolhida | pendente | rejeitada", "evidencia": "string"}],
  "teses_reu": [{"tese": "string", "fundamento_legal": "string", "status": "acolhida | pendente | rejeitada", "evidencia": "string"}],
  "questoes_ordem_publica": ["string"],
  "teses_potenciais": ["string"],
  "confianca": 0.0
}""",
    },
    "cronologia": {
        "instrucao": """Extraia a cronologia completa de todos os eventos do processo.

JSON schema:
{
  "eventos": [{"data": "YYYY-MM-DD ou null", "data_aproximada": false,
    "tipo": "protocolo | despacho | decisao | sentenca | acordao | prazo | audiencia | pericia | recurso | publicacao",
    "descricao": "string", "relevancia": "baixa | media | alta | critica", "fonte_peca": "string"}],
  "confianca": 0.0
}""",
    },
    "proximos_passos": {
        "instrucao": """Identifique todas as ações jurídicas necessárias nos próximos 90 dias.

JSON schema:
{
  "acoes": [{"acao": "string", "tipo": "prazo_legal | diligencia | peticao | audiencia | recurso",
    "urgencia": "normal | alta | urgente | critica", "prazo": "YYYY-MM-DD ou null",
    "responsavel_sugerido": "string ou null", "fundamento": "string"}],
  "alertas_prazo": ["string"],
  "confianca": 0.0
}""",
    },
    "estrategia": {
        "instrucao": """Sugira estratégias jurídicas. Apenas sugestões para revisão humana.

JSON schema:
{
  "aviso": "Sugestões geradas por IA — revisão humana obrigatória.",
  "estrategias": [{"estrategia": "string", "justificativa": "string",
    "vantagens": ["string"], "riscos": ["string"], "evidencias": ["string"]}],
  "pontos_fortes": ["string"],
  "pontos_fracos": ["string"],
  "confianca": 0.0
}""",
    },
    "impacto_atualizacao": {
        "instrucao": """Compare os documentos e identifique mudanças e novos elementos.

JSON schema:
{
  "novos_documentos": ["string"], "mudancas_fase": "string ou null",
  "novas_decisoes": [{"tipo": "string", "resumo": "string"}],
  "novos_prazos": [{"descricao": "string", "data": "YYYY-MM-DD ou null"}],
  "impacto_estrategia": "string",
  "acoes_recomendadas": [{"acao": "string", "urgencia": "normal | alta | urgente", "prazo": "string ou null"}],
  "confianca": 0.0
}""",
    },
}


async def _buscar_pecas(processo_id: uuid.UUID) -> list[dict]:
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("pecas")
        .select("id,tipo_peca,pagina_inicio,pagina_fim,conteudo_texto,confianca_classificacao")
        .eq("processo_id", str(processo_id))
        .order("pagina_inicio", desc=False)
        .execute()
    )
    return result.data or []


def _resumir_peca_sync(peca: dict, client: anthropic.Anthropic) -> str:
    texto = peca.get("conteudo_texto") or ""
    tipo = peca.get("tipo_peca", "peca")
    pags = f"pág. {peca.get('pagina_inicio')}-{peca.get('pagina_fim')}"
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=600,
        messages=[{
            "role": "user",
            "content": (
                f"Resuma esta peça processual ({tipo}, {pags}) em até 400 palavras. "
                f"Preserve: datas, valores, decisões, prazos, nomes das partes e fundamentos legais.\n\n"
                f"{texto[:80_000]}"
            ),
        }],
    )
    return f"[{tipo.upper()} — {pags}]\n{msg.content[0].text.strip()}"


def _montar_contexto_direto(pecas: list[dict]) -> str:
    partes = []
    for p in pecas:
        tipo = p.get("tipo_peca", "peca").upper()
        pags = f"pág. {p.get('pagina_inicio')}-{p.get('pagina_fim')}"
        texto = p.get("conteudo_texto") or "(sem texto)"
        partes.append(f"=== {tipo} ({pags}) ===\n{texto}")
    return "\n\n".join(partes)


async def _montar_contexto_hierarquico(pecas: list[dict], client: anthropic.Anthropic) -> str:
    import asyncio
    partes = []
    tokens_usados = 0

    prioritarias = [p for p in pecas if p.get("tipo_peca") in PECAS_PRIORITARIAS]
    secundarias = [p for p in pecas if p.get("tipo_peca") not in PECAS_PRIORITARIAS]

    for p in prioritarias:
        texto = p.get("conteudo_texto") or ""
        toks = _contar_tokens(texto)
        tipo = p.get("tipo_peca", "peca").upper()
        pags = f"pág. {p.get('pagina_inicio')}-{p.get('pagina_fim')}"
        if tokens_usados + toks <= MAX_TOKENS_DIRECT:
            partes.append(f"=== {tipo} — COMPLETO ({pags}) ===\n{texto}")
            tokens_usados += toks
        else:
            loop = asyncio.get_event_loop()
            resumo = await loop.run_in_executor(None, functools.partial(_resumir_peca_sync, p, client))
            partes.append(resumo)

    resumos_sec = []
    loop = asyncio.get_event_loop()
    for p in secundarias:
        resumo = await loop.run_in_executor(None, functools.partial(_resumir_peca_sync, p, client))
        resumos_sec.append(resumo)

    if resumos_sec:
        partes.append("=== DEMAIS PEÇAS (resumidas) ===\n" + "\n\n".join(resumos_sec))

    return "\n\n".join(partes)


async def _claude_async(client: anthropic.Anthropic, **kwargs) -> anthropic.types.Message:
    import asyncio
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, functools.partial(client.messages.create, **kwargs))


async def gerar_analise(
    processo_id: uuid.UUID,
    tipo: str,
    usuario_id: Optional[uuid.UUID] = None,
    contexto_extra: Optional[str] = None,
) -> dict:
    if tipo not in PROMPTS:
        raise ValueError(f"Tipo de análise inválido: {tipo}")

    sb = get_supabase()
    cfg = PROMPTS[tipo]

    pecas = await _buscar_pecas(processo_id)
    if not pecas:
        raise ValueError("Nenhuma peça encontrada. Faça o upload de documentos primeiro.")

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    total_tokens = sum(_contar_tokens(p.get("conteudo_texto") or "") for p in pecas)
    logger.info(f"Processo {processo_id}: {len(pecas)} peças, ~{total_tokens:,} tokens")

    if total_tokens <= MAX_TOKENS_DIRECT:
        contexto = _montar_contexto_direto(pecas)
        estrategia = "direto"
    else:
        logger.info("Processo grande — sumarização hierárquica")
        contexto = await _montar_contexto_hierarquico(pecas, client)
        estrategia = "hierarquico"

    user_content = f"DOCUMENTOS DO PROCESSO:\n\n{contexto}"
    if contexto_extra:
        user_content += f"\n\nINSTRUÇÕES ADICIONAIS:\n{contexto_extra}"
    user_content += f"\n\nTAREFA:\n{cfg['instrucao']}"

    logger.info(f"Gerando análise '{tipo}' via {estrategia}")
    msg = await _claude_async(
        client,
        model=settings.llm_model,
        max_tokens=4096,
        system=SYSTEM_BASE,
        messages=[{"role": "user", "content": user_content}],
    )

    raw = msg.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]

    try:
        conteudo = json.loads(raw)
    except json.JSONDecodeError:
        conteudo = {"raw": raw, "parse_error": True}

    confianca = float(conteudo.get("confianca", 0.7))

    analise_data = {
        "id": str(uuid.uuid4()),
        "processo_id": str(processo_id),
        "tipo": tipo,
        "conteudo_json": conteudo,
        "modelo_ia": settings.llm_model,
        "tokens_input": msg.usage.input_tokens,
        "tokens_output": msg.usage.output_tokens,
        "confianca": confianca,
        "status_revisao": "pendente",
        "created_by": str(usuario_id) if usuario_id else None,
    }
    analise_r = await sb_run(lambda: sb.table("analises").insert(analise_data).execute())
    analise = analise_r.data[0]

    if tipo == "cronologia" and "eventos" in conteudo:
        cron_rows = []
        for ev in conteudo["eventos"]:
            data = None
            if ev.get("data"):
                try:
                    data = ev["data"]
                    date_type.fromisoformat(data)
                except ValueError:
                    data = None
            cron_rows.append({
                "id": str(uuid.uuid4()),
                "processo_id": str(processo_id),
                "data_evento": data,
                "data_aproximada": ev.get("data_aproximada", False),
                "tipo_evento": ev.get("tipo", "outros"),
                "descricao": ev.get("descricao", ""),
                "relevancia": ev.get("relevancia", "media"),
                "fonte": "ia",
                "validado": False,
            })
        if cron_rows:
            await sb_run(lambda: sb.table("cronologia").insert(cron_rows).execute())

    tarefa_data = {
        "id": str(uuid.uuid4()),
        "processo_id": str(processo_id),
        "analise_id": analise["id"],
        "tipo": "analise",
        "titulo": f"Revisar análise: {tipo.replace('_', ' ').title()}",
        "descricao": f"Análise gerada por IA com confiança {confianca:.0%}. Revisão obrigatória.",
        "prioridade": "alta" if confianca < 0.7 else "normal",
        "status": "pendente",
        "atribuido_para": str(usuario_id) if usuario_id else None,
        "atribuido_por": str(usuario_id) if usuario_id else None,
    }
    await sb_run(lambda: sb.table("tarefas_revisao").insert(tarefa_data).execute())

    logger.success(f"Análise '{tipo}' ({estrategia}) — confiança {confianca:.0%}")
    return analise


async def chat_processo(
    processo_id: uuid.UUID,
    mensagens: list[dict],
    tipo_peca: Optional[str] = None,
) -> tuple[str, list[dict], int]:
    pecas = await _buscar_pecas(processo_id)
    if tipo_peca:
        filtradas = [p for p in pecas if p.get("tipo_peca") == tipo_peca]
        pecas = filtradas or pecas

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    total_tokens = sum(_contar_tokens(p.get("conteudo_texto") or "") for p in pecas)
    if total_tokens <= MAX_TOKENS_DIRECT:
        contexto = _montar_contexto_direto(pecas)
    else:
        contexto = await _montar_contexto_hierarquico(pecas, client)

    system = SYSTEM_BASE + f"\n\nCONTEXTO DO PROCESSO:\n\n{contexto}"
    ultima = mensagens[-1]["content"] if mensagens else ""

    msg = await _claude_async(
        client,
        model=settings.llm_model,
        max_tokens=2048,
        system=system,
        messages=[{"role": "user", "content": ultima}],
    )

    fontes = [
        {"tipo_peca": p.get("tipo_peca"), "paginas": f"{p.get('pagina_inicio')}-{p.get('pagina_fim')}"}
        for p in pecas
    ]
    tokens = msg.usage.input_tokens + msg.usage.output_tokens
    return msg.content[0].text.strip(), fontes, tokens
