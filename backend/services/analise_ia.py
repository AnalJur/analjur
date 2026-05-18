"""
Análises jurídicas via Claude.
"""

import uuid
import json
from datetime import datetime, timezone
from typing import Optional

import anthropic
from loguru import logger

from ..config import get_settings
from ..database import get_supabase, sb_run
from .rag import buscar_chunks, formatar_contexto

settings = get_settings()


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


SYSTEM_BASE = """Você é um assistente jurídico especializado em análise de processos brasileiros.
Sua função é analisar documentos jurídicos e extrair informações estruturadas.
IMPORTANTE:
- Baseie-se APENAS no conteúdo fornecido, nunca invente fatos.
- Indique sempre a fonte (número da peça/página) de cada informação.
- Quando houver incerteza, sinalize explicitamente.
- Nunca tome decisões jurídicas; apenas analise e sugira para revisão humana.
- Responda SEMPRE em JSON válido conforme o schema solicitado."""


PROMPTS = {
    "estado_atual": {
        "instrucao": """Analise os documentos e retorne o estado atual do processo.

JSON schema esperado:
{
  "fase_processual": "string",
  "ultima_movimentacao": {"data": "YYYY-MM-DD ou null", "descricao": "string"},
  "partes": {"autor": ["string"], "reu": ["string"], "advogados": ["string"]},
  "pedidos_principais": ["string"],
  "decisoes_relevantes": [{"data": "YYYY-MM-DD ou null", "tipo": "string", "resumo": "string"}],
  "pendencias": ["string"],
  "prazos_identificados": [{"descricao": "string", "data": "YYYY-MM-DD ou null", "critico": true/false}],
  "inconsistencias_documentais": ["string"],
  "confianca": 0.0
}""",
        "query_rag": "estado atual fase processual partes pedidos decisões",
    },
    "resumo_executivo": {
        "instrucao": """Gere um resumo executivo do processo para um advogado sênior.

JSON schema esperado:
{
  "titulo": "string",
  "resumo": "string (max 500 chars)",
  "pontos_chave": ["string"],
  "situacao_atual": "string",
  "alertas": ["string"],
  "recomendacoes_imediatas": ["string"],
  "confianca": 0.0
}""",
        "query_rag": "resumo processo situação atual pontos importantes",
    },
    "riscos": {
        "instrucao": """Identifique e classifique os riscos jurídicos do processo.

JSON schema esperado:
{
  "riscos": [{"categoria": "prazo | probatorio | legal | estrategico | financeiro",
    "descricao": "string", "severidade": "baixa | media | alta | critica",
    "probabilidade": "baixa | media | alta", "mitigacao_sugerida": "string", "fonte": "string"}],
  "exposicao_financeira": {"estimativa": "string", "base": "string"},
  "prazo_mais_urgente": {"descricao": "string", "data": "YYYY-MM-DD ou null"},
  "confianca": 0.0
}""",
        "query_rag": "riscos prazos vencimentos decisões contrárias",
    },
    "teses": {
        "instrucao": """Identifique as teses jurídicas presentes e potenciais no processo.

JSON schema esperado:
{
  "teses_autor": [{"tese": "string", "fundamento_legal": "string",
    "status": "acolhida | pendente | rejeitada", "evidencia": "string"}],
  "teses_reu": [{"tese": "string", "fundamento_legal": "string",
    "status": "acolhida | pendente | rejeitada", "evidencia": "string"}],
  "questoes_ordem_publica": ["string"],
  "teses_potenciais": ["string"],
  "confianca": 0.0
}""",
        "query_rag": "teses jurídicas fundamentos legais argumentos contestação",
    },
    "cronologia": {
        "instrucao": """Extraia a cronologia completa de eventos do processo.

JSON schema esperado:
{
  "eventos": [{"data": "YYYY-MM-DD ou null", "data_aproximada": true/false,
    "tipo": "protocolo | despacho | decisao | sentenca | acordao | prazo | audiencia | pericia | recurso | publicacao",
    "descricao": "string", "relevancia": "baixa | media | alta | critica", "fonte_peca": "string"}],
  "confianca": 0.0
}""",
        "query_rag": "datas eventos cronologia protocolos decisões publicações",
    },
    "impacto_atualizacao": {
        "instrucao": """Compare os documentos mais recentes com o estado anterior e identifique mudanças.

JSON schema esperado:
{
  "novos_documentos": ["string"], "mudancas_fase": "string ou null",
  "novas_decisoes": [{"tipo": "string", "resumo": "string"}],
  "novos_prazos": [{"descricao": "string", "data": "YYYY-MM-DD ou null"}],
  "impacto_estrategia": "string",
  "acoes_recomendadas": [{"acao": "string", "urgencia": "normal | alta | urgente", "prazo": "string ou null"}],
  "confianca": 0.0
}""",
        "query_rag": "atualização mudanças novas decisões novos documentos",
    },
    "proximos_passos": {
        "instrucao": """Identifique as ações jurídicas necessárias nos próximos 90 dias.

JSON schema esperado:
{
  "acoes": [{"acao": "string", "tipo": "prazo_legal | diligencia | peticao | audiencia | recurso",
    "urgencia": "normal | alta | urgente | critica", "prazo": "YYYY-MM-DD ou null",
    "responsavel_sugerido": "string ou null", "fundamento": "string"}],
  "alertas_prazo": ["string"],
  "confianca": 0.0
}""",
        "query_rag": "próximas ações prazos diligências recursos",
    },
    "estrategia": {
        "instrucao": """Sugira estratégias jurídicas para o processo. IMPORTANTE: apenas sugestões para revisão humana.

JSON schema esperado:
{
  "aviso": "Sugestões geradas por IA — revisão humana obrigatória antes de qualquer decisão.",
  "estrategias": [{"estrategia": "string", "justificativa": "string",
    "vantagens": ["string"], "riscos": ["string"], "evidencias": ["string"]}],
  "pontos_fortes": ["string"],
  "pontos_fracos": ["string"],
  "confianca": 0.0
}""",
        "query_rag": "estratégia teses favoráveis jurisprudência argumentos",
    },
}


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

    chunks = await buscar_chunks(processo_id, cfg["query_rag"], top_k=settings.rag_top_k)
    if not chunks:
        raise ValueError("Nenhum chunk encontrado para o processo. Faça o upload de documentos primeiro.")

    contexto = formatar_contexto(chunks)
    user_content = f"CONTEXTO DO PROCESSO:\n\n{contexto}"
    if contexto_extra:
        user_content += f"\n\nINSTRUÇÕES ADICIONAIS:\n{contexto_extra}"
    user_content += f"\n\nTAREFA:\n{cfg['instrucao']}"

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    logger.info(f"Gerando análise '{tipo}' para processo {processo_id}")
    msg = client.messages.create(
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

    # Persiste cronologia extraída
    if tipo == "cronologia" and "eventos" in conteudo:
        from datetime import date as date_type
        cron_rows = []
        for ev in conteudo["eventos"]:
            data = None
            if ev.get("data"):
                try:
                    data = ev["data"]
                    date_type.fromisoformat(data)  # valida formato
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

    # Tarefa de revisão humana
    tarefa_data = {
        "id": str(uuid.uuid4()),
        "processo_id": str(processo_id),
        "analise_id": analise["id"],
        "tipo": "analise",
        "titulo": f"Revisar análise: {tipo.replace('_', ' ').title()}",
        "descricao": f"Análise gerada por IA com confiança {confianca:.0%}. Revisão humana obrigatória.",
        "prioridade": "alta" if confianca < 0.7 else "normal",
        "status": "pendente",
        "atribuido_para": str(usuario_id) if usuario_id else None,
        "atribuido_por": str(usuario_id) if usuario_id else None,
    }
    await sb_run(lambda: sb.table("tarefas_revisao").insert(tarefa_data).execute())

    logger.success(f"Análise '{tipo}' gerada — confiança {confianca:.0%}")
    return analise


async def chat_processo(
    processo_id: uuid.UUID,
    mensagens: list[dict],
    tipo_peca: Optional[str] = None,
) -> tuple[str, list[dict], int]:
    ultima_query = mensagens[-1]["content"] if mensagens else ""
    chunks = await buscar_chunks(processo_id, ultima_query, top_k=settings.rag_top_k, tipo_peca=tipo_peca)
    contexto = formatar_contexto(chunks)

    system = SYSTEM_BASE + f"\n\nCONTEXTO DO PROCESSO (use apenas estas informações):\n\n{contexto}"

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    msg = client.messages.create(
        model=settings.llm_model,
        max_tokens=2048,
        system=system,
        messages=mensagens,
    )

    resposta = msg.content[0].text.strip()
    fontes = [
        {"tipo_peca": c.get("tipo_peca"), "pagina": c.get("pagina"), "similarity": round(c.get("similarity", 0), 3)}
        for c in chunks
    ]
    tokens = msg.usage.input_tokens + msg.usage.output_tokens
    return resposta, fontes, tokens
