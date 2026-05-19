"""
Análises jurídicas via Claude.

Estratégias por tamanho:
  ≤ 185K tokens  → contexto direto (tudo enviado de uma vez)
  >  185K tokens → sumarização hierárquica por peça
  cronologia grande → multi-pass por blocos de 80K tokens + consolidação
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

# Claude 3.x suporta até 200K tokens de contexto;
# usamos 185K como teto seguro (deixa margem pro prompt + resposta).
MAX_TOKENS_DIRECT  = 185_000
CHUNK_TOKENS_CRON  = 80_000   # bloco para multi-pass de cronologia
CHUNK_OVERLAP      = 2_000    # sobreposição entre blocos
RESUMO_MAX_TOKENS  = 2_500    # tokens de saída por peça resumida (era 600)

PECAS_PRIORITARIAS = {
    "sentenca", "acordao", "decisao_interlocutoria", "peticao_inicial",
    "contestacao", "recurso",
}


def _utcnow():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _contar_tokens(texto: str) -> int:
    return len(_enc.encode(texto))


SYSTEM_BASE = """Você é um assistente jurídico com conhecimento e perspectiva de advogado sênior especialista \
com 20 anos de experiência em direito brasileiro.
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
    "tipo": "protocolo | despacho | decisao | sentenca | acordao | prazo | audiencia | pericia | recurso | publicacao | citacao | intimacao | outro",
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


# ── Busca de peças ─────────────────────────────────────────────────────────────

async def _buscar_pecas(
    processo_id: uuid.UUID,
    documento_ids: Optional[list[uuid.UUID]] = None,
) -> list[dict]:
    sb = get_supabase()
    q = (sb.table("pecas")
         .select("id,documento_id,tipo_peca,pagina_inicio,pagina_fim,conteudo_texto,confianca_classificacao")
         .eq("processo_id", str(processo_id))
         .order("pagina_inicio", desc=False))
    if documento_ids:
        ids_str = [str(d) for d in documento_ids]
        q = q.in_("documento_id", ids_str)
    result = await sb_run(q.execute)
    return result.data or []


# ── Montagem de contexto ──────────────────────────────────────────────────────

def _montar_contexto_direto(pecas: list[dict]) -> str:
    """Concatena todas as peças com cabeçalho. Usado quando cabem no contexto."""
    partes = []
    for p in pecas:
        tipo  = p.get("tipo_peca", "peca").upper()
        pags  = f"pág. {p.get('pagina_inicio')}-{p.get('pagina_fim')}"
        texto = p.get("conteudo_texto") or "(sem texto)"
        partes.append(f"=== {tipo} ({pags}) ===\n{texto}")
    return "\n\n".join(partes)


def _resumir_peca_sync(peca: dict, client: anthropic.Anthropic) -> str:
    """Resume uma peça individual usando Haiku (rápido, barato)."""
    texto = peca.get("conteudo_texto") or ""
    tipo  = peca.get("tipo_peca", "peca")
    pags  = f"pág. {peca.get('pagina_inicio')}-{peca.get('pagina_fim')}"
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=RESUMO_MAX_TOKENS,
        messages=[{
            "role": "user",
            "content": (
                f"Resuma esta peça processual ({tipo}, {pags}) preservando TODOS os detalhes importantes: "
                f"datas (DD/MM/AAAA), valores monetários, nomes das partes e advogados, "
                f"fundamentos legais citados, decisões, prazos e determinações. "
                f"Seja extenso o suficiente para que a análise posterior não perca informação crucial.\n\n"
                f"{texto[:100_000]}"
            ),
        }],
    )
    return f"[{tipo.upper()} — {pags}]\n{msg.content[0].text.strip()}"


async def _montar_contexto_hierarquico(pecas: list[dict], client: anthropic.Anthropic) -> str:
    """
    Para documentos que não cabem no contexto direto:
    - Peças prioritárias: texto completo (se couber) ou resumo longo
    - Demais peças: resumo detalhado
    """
    import asyncio
    partes = []
    tokens_usados = 0

    prioritarias = [p for p in pecas if p.get("tipo_peca") in PECAS_PRIORITARIAS]
    secundarias  = [p for p in pecas if p.get("tipo_peca") not in PECAS_PRIORITARIAS]

    # Peças prioritárias: tenta texto completo
    for p in prioritarias:
        texto = p.get("conteudo_texto") or ""
        toks  = _contar_tokens(texto)
        tipo  = p.get("tipo_peca", "peca").upper()
        pags  = f"pág. {p.get('pagina_inicio')}-{p.get('pagina_fim')}"

        # Reserva 30K de margem para o prompt de análise + resposta
        if tokens_usados + toks <= MAX_TOKENS_DIRECT - 30_000:
            partes.append(f"=== {tipo} — COMPLETO ({pags}) ===\n{texto}")
            tokens_usados += toks
        else:
            loop = asyncio.get_event_loop()
            resumo = await loop.run_in_executor(None, functools.partial(_resumir_peca_sync, p, client))
            partes.append(resumo)

    # Peças secundárias: sempre resumidas
    loop = asyncio.get_event_loop()
    resumos_sec = []
    for p in secundarias:
        resumo = await loop.run_in_executor(None, functools.partial(_resumir_peca_sync, p, client))
        resumos_sec.append(resumo)

    if resumos_sec:
        partes.append("=== DEMAIS PEÇAS (resumidas) ===\n" + "\n\n".join(resumos_sec))

    return "\n\n".join(partes)


# ── Multi-pass para cronologia ────────────────────────────────────────────────

_INSTRUCAO_CHUNK_CRON = """Extraia TODOS os eventos cronológicos deste trecho do processo judicial.
Inclua: protocolos, decisões, despachos, publicações, prazos, audiências, citações, intimações, recursos, perícias.

Responda SOMENTE com JSON válido:
{
  "eventos": [
    {
      "data": "YYYY-MM-DD ou null",
      "data_aproximada": false,
      "tipo": "protocolo | despacho | decisao | sentenca | acordao | prazo | audiencia | pericia | recurso | publicacao | citacao | intimacao | outro",
      "descricao": "descrição completa do evento",
      "relevancia": "baixa | media | alta | critica",
      "fonte_peca": "tipo e página de origem"
    }
  ]
}

Se não há eventos neste trecho, retorne {"eventos": []}."""


async def _cronologia_multipass(
    pecas: list[dict],
    client: anthropic.Anthropic,
) -> list[dict]:
    """
    Processa o documento em blocos de CHUNK_TOKENS_CRON tokens.
    Extrai eventos de cada bloco com Haiku (rápido) e consolida.
    """
    import asyncio

    # Concatena tudo em ordem de página
    texto_total = ""
    for p in pecas:
        tipo  = p.get("tipo_peca", "peca").upper()
        pags  = f"pág. {p.get('pagina_inicio')}-{p.get('pagina_fim')}"
        texto = p.get("conteudo_texto") or ""
        texto_total += f"\n\n=== {tipo} ({pags}) ===\n{texto}"

    tokens_total = _enc.encode(texto_total)
    total = len(tokens_total)
    logger.info(f"Cronologia multi-pass: {total:,} tokens totais")

    if total == 0:
        return []

    # Divide em blocos com sobreposição
    blocos: list[str] = []
    step = CHUNK_TOKENS_CRON - CHUNK_OVERLAP
    for inicio in range(0, total, step):
        fim = min(inicio + CHUNK_TOKENS_CRON, total)
        blocos.append(_enc.decode(tokens_total[inicio:fim]))

    logger.info(f"Cronologia multi-pass: {len(blocos)} bloco(s)")

    todos_eventos: list[dict] = []

    async def processar_bloco(idx: int, bloco: str) -> list[dict]:
        try:
            loop = asyncio.get_event_loop()
            msg = await loop.run_in_executor(
                None,
                functools.partial(
                    client.messages.create,
                    model="claude-haiku-4-5-20251001",
                    max_tokens=4096,
                    system=SYSTEM_BASE,
                    messages=[{
                        "role": "user",
                        "content": (
                            f"TRECHO {idx + 1}/{len(blocos)} DO PROCESSO:\n\n"
                            f"{bloco}\n\nTAREFA:\n{_INSTRUCAO_CHUNK_CRON}"
                        ),
                    }],
                ),
            )
            raw = msg.content[0].text.strip()
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
            data = json.loads(raw)
            evs = data.get("eventos", [])
            logger.info(f"  Bloco {idx + 1}: {len(evs)} eventos")
            return evs
        except Exception as e:
            logger.warning(f"  Bloco {idx + 1} falhou: {e}")
            return []

    # Processa blocos sequencialmente para não sobrecarregar a API
    for idx, bloco in enumerate(blocos):
        evs = await processar_bloco(idx, bloco)
        todos_eventos.extend(evs)

    # Deduplicação simples: remove eventos com mesma data+tipo+descricao_inicio
    seen: set[tuple] = set()
    dedup: list[dict] = []
    for ev in todos_eventos:
        chave = (
            ev.get("data") or "",
            ev.get("tipo") or "",
            (ev.get("descricao") or "")[:60],
        )
        if chave not in seen:
            seen.add(chave)
            dedup.append(ev)

    logger.info(f"Cronologia multi-pass: {len(todos_eventos)} eventos → {len(dedup)} após dedup")
    return dedup


# ── Wrapper assíncrono para Claude ────────────────────────────────────────────

async def _claude_async(client: anthropic.Anthropic, **kwargs) -> anthropic.types.Message:
    import asyncio
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, functools.partial(client.messages.create, **kwargs))


# ── Função principal ──────────────────────────────────────────────────────────

async def gerar_analise(
    processo_id: uuid.UUID,
    tipo: str,
    usuario_id: Optional[uuid.UUID] = None,
    contexto_extra: Optional[str] = None,
    documento_ids: Optional[list[uuid.UUID]] = None,
) -> dict:
    if tipo not in PROMPTS:
        raise ValueError(f"Tipo de análise inválido: {tipo}")

    sb  = get_supabase()
    cfg = PROMPTS[tipo]

    pecas = await _buscar_pecas(processo_id, documento_ids=documento_ids)
    if not pecas:
        raise ValueError("Nenhuma peça encontrada. Faça o upload de documentos primeiro.")

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    total_tokens = sum(_contar_tokens(p.get("conteudo_texto") or "") for p in pecas)
    logger.info(
        f"Processo {processo_id}: {len(pecas)} peça(s), ~{total_tokens:,} tokens — "
        f"tipo '{tipo}'"
    )

    # ── Estratégia de contexto ────────────────────────────────────────────────
    conteudo_json: dict = {}
    tokens_input  = 0
    tokens_output = 0
    estrategia    = "desconhecida"

    if tipo == "cronologia" and total_tokens > MAX_TOKENS_DIRECT:
        # Multi-pass: extrai eventos de cada bloco e consolida
        logger.info("Cronologia: usando multi-pass para documento grande")
        eventos = await _cronologia_multipass(pecas, client)
        estrategia = "multipass"

        # Consolidação final com o modelo principal
        resumo_eventos = json.dumps({"eventos": eventos[:300]}, ensure_ascii=False, indent=2)
        consolidar_prompt = (
            f"Abaixo estão eventos cronológicos extraídos de um processo judicial por blocos.\n"
            f"Organize-os em ordem cronológica, corrija duplicatas e classifique a relevância.\n\n"
            f"{resumo_eventos}\n\n"
            f"Retorne o JSON final com o schema:\n{cfg['instrucao']}"
        )
        msg_final = await _claude_async(
            client,
            model=settings.llm_model,
            max_tokens=4096,
            system=SYSTEM_BASE,
            messages=[{"role": "user", "content": consolidar_prompt}],
        )
        tokens_input  = msg_final.usage.input_tokens
        tokens_output = msg_final.usage.output_tokens
        raw = msg_final.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
        try:
            conteudo_json = json.loads(raw)
        except json.JSONDecodeError:
            # Se consolidação falhar, usa os eventos brutos
            conteudo_json = {"eventos": eventos, "confianca": 0.7}

    else:
        # Fluxo normal: direto ou hierárquico
        if total_tokens <= MAX_TOKENS_DIRECT:
            contexto   = _montar_contexto_direto(pecas)
            estrategia = "direto"
        else:
            logger.info("Documento grande — sumarização hierárquica")
            contexto   = await _montar_contexto_hierarquico(pecas, client)
            estrategia = "hierarquico"

        user_content  = f"DOCUMENTOS DO PROCESSO:\n\n{contexto}"
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
        tokens_input  = msg.usage.input_tokens
        tokens_output = msg.usage.output_tokens
        raw = msg.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
        try:
            conteudo_json = json.loads(raw)
        except json.JSONDecodeError:
            conteudo_json = {"raw": raw, "parse_error": True}

    confianca = float(conteudo_json.get("confianca", 0.7))

    # ── Persiste análise ──────────────────────────────────────────────────────
    analise_data = {
        "id":             str(uuid.uuid4()),
        "processo_id":    str(processo_id),
        "tipo":           tipo,
        "conteudo_json":  conteudo_json,
        "modelo_ia":      settings.llm_model,
        "tokens_input":   tokens_input,
        "tokens_output":  tokens_output,
        "confianca":      confianca,
        "status_revisao": "pendente",
        "created_by":     str(usuario_id) if usuario_id else None,
    }
    analise_r = await sb_run(lambda: sb.table("analises").insert(analise_data).execute())
    analise   = analise_r.data[0]

    # ── Popula tabela de cronologia ───────────────────────────────────────────
    if tipo == "cronologia" and "eventos" in conteudo_json:
        cron_rows = []
        for ev in conteudo_json["eventos"]:
            data_val = None
            if ev.get("data"):
                try:
                    data_val = ev["data"]
                    date_type.fromisoformat(data_val)
                except ValueError:
                    data_val = None
            cron_rows.append({
                "id":             str(uuid.uuid4()),
                "processo_id":    str(processo_id),
                "data_evento":    data_val,
                "data_aproximada": ev.get("data_aproximada", False),
                "tipo_evento":    ev.get("tipo", "outro"),
                "descricao":      ev.get("descricao", ""),
                "relevancia":     ev.get("relevancia", "media"),
                "fonte":          "ia",
                "validado":       False,
            })
        if cron_rows:
            LOTE = 50
            for i in range(0, len(cron_rows), LOTE):
                lote = cron_rows[i:i + LOTE]
                await sb_run(lambda: sb.table("cronologia").insert(lote).execute())
            logger.success(f"Cronologia: {len(cron_rows)} eventos salvos")

    # ── Cria tarefa de revisão ────────────────────────────────────────────────
    tarefa_data = {
        "id":           str(uuid.uuid4()),
        "processo_id":  str(processo_id),
        "analise_id":   analise["id"],
        "tipo":         "analise",
        "titulo":       f"Revisar análise: {tipo.replace('_', ' ').title()}",
        "descricao":    f"Análise gerada por IA (estratégia={estrategia}) com confiança {confianca:.0%}. Revisão obrigatória.",
        "prioridade":   "alta" if confianca < 0.7 else "normal",
        "status":       "pendente",
        "atribuido_para": str(usuario_id) if usuario_id else None,
        "atribuido_por":  str(usuario_id) if usuario_id else None,
    }
    await sb_run(lambda: sb.table("tarefas_revisao").insert(tarefa_data).execute())

    logger.success(
        f"Análise '{tipo}' ({estrategia}) — "
        f"confiança {confianca:.0%} — "
        f"{tokens_input + tokens_output:,} tokens"
    )
    return analise


# ── Chat ──────────────────────────────────────────────────────────────────────

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

    system  = SYSTEM_BASE + f"\n\nCONTEXTO DO PROCESSO:\n\n{contexto}"
    ultima  = mensagens[-1]["content"] if mensagens else ""

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
