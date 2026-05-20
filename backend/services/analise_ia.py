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


SYSTEM_BASE = """Você é um advogado sênior brasileiro com 25 anos de atuação em TJSP, TRF, TST, STJ e STF. \
Domina CPC/2015, CLT (pós-reforma 13.467/2017), CC/2002, CDC, Lei de Execuções, além de \
jurisprudência consolidada e teses vinculantes dos tribunais superiores.

MANDAMENTOS DE ANÁLISE:
1. BASE FACTUAL: use APENAS o que consta nos documentos. Nunca invente datas, partes ou decisões.
2. CITAÇÃO OBRIGATÓRIA: toda afirmação relevante deve ter fonte (tipo de peça + página).
3. HONESTIDADE CLÍNICA: avalie pontos fracos da tese do cliente com a mesma severidade dos pontos fortes. \
   Um cliente precisa de diagnóstico real, não de otimismo.
4. PROFUNDIDADE TÉCNICA: identifique nulidades, preclusões, questões de ordem pública, vícios \
   que a parte contrária pode arguir, e oportunidades que o advogado pode explorar.
5. PRATICIDADE: cada recomendação deve ser uma ação concreta (ex: "interpor agravo de instrumento \
   no prazo de 15 dias — art. 1.015, XI do CPC"), não uma observação genérica.
6. LÓGICA PROCESSUAL: respeite a ordem natural do processo — inicial precede contestação, \
   citação precede resposta, decisão precede recurso.
7. RESPONDA SEMPRE em JSON válido, sem markdown extra, exatamente no schema solicitado."""


PROMPTS = {

    # ── ESTADO ATUAL ─────────────────────────────────────────────────────────
    "estado_atual": {
        "instrucao": """Faça um diagnóstico completo do estado atual do processo como um advogado sênior faria \
antes de uma reunião com o cliente.

INSTRUÇÕES:
- Identifique a fase processual exata (CPC 2015: conhecimento / saneamento / instrução / sentença / \
  cumprimento de sentença / execução — ou CLT se trabalhista).
- Liste TODAS as partes com seus papéis processuais e representação.
- Mapeie os pedidos do autor e o grau em que cada um foi deferido/indeferido até agora.
- Aponte decisões relevantes com impacto no mérito ou na admissibilidade.
- Identifique NULIDADES, PRECLUSÕES e irregularidades processuais ainda não saneadas.
- Calcule ou estime prazos vivos a partir das datas encontradas.
- Sinalize inconsistências entre o que foi pedido e o que está documentado.

JSON schema:
{
  "tipo_causa": "string (trabalhista | civil | consumidor | tributario | criminal | administrativo | outro)",
  "fase_processual": "string",
  "instancia": "string (1ª instância | 2ª instância | STJ | STF | TST | outro)",
  "ultima_movimentacao": {"data": "YYYY-MM-DD ou null", "descricao": "string", "fonte": "string"},
  "partes": {
    "autor": [{"nome": "string", "advogado": "string ou null"}],
    "reu": [{"nome": "string", "advogado": "string ou null"}],
    "terceiros": ["string"]
  },
  "valor_causa": "string ou null",
  "pedidos": [{"pedido": "string", "status": "pendente | deferido | indeferido | parcial", "observacao": "string ou null"}],
  "decisoes_relevantes": [{"data": "YYYY-MM-DD ou null", "tipo": "string", "resumo": "string", "fonte": "string"}],
  "nulidades_identificadas": [{"descricao": "string", "gravidade": "sanavel | insanavel", "fundamento_legal": "string"}],
  "prazos_vivos": [{"descricao": "string", "data_base": "string ou null", "prazo_legal": "string", "vencimento_estimado": "YYYY-MM-DD ou null", "critico": true}],
  "pendencias_criticas": ["string"],
  "alertas": ["string"],
  "confianca": 0.0
}""",
    },

    # ── RESUMO EXECUTIVO ─────────────────────────────────────────────────────
    "resumo_executivo": {
        "instrucao": """Escreva um resumo executivo objetivo que um sócio de escritório leria em 3 minutos \
para entender a situação completa e o que precisa de atenção imediata.

INSTRUÇÕES:
- Comece com uma frase de situação: o que é o caso, quem é o cliente, onde está.
- Destaque os fatos jurídicos determinantes (não todos os fatos — os que importam para o desfecho).
- Avalie com honestidade as chances de êxito com base na jurisprudência dominante.
- Liste as 3-5 ações mais urgentes em ordem de prioridade.
- Não use linguagem vaga ("pode ser relevante", "talvez"): seja direto.

JSON schema:
{
  "titulo": "string",
  "tipo_causa": "string",
  "situacao_em_uma_linha": "string (ex: Ação de rescisão contratual — autor perdeu em 1ª instância — apelação pendente de julgamento no TJSP)",
  "fatos_determinantes": ["string"],
  "posicao_atual": "string",
  "avaliacao_chances": {
    "perspectiva": "favoravel | desfavoravel | incerta | equilibrada",
    "justificativa": "string",
    "jurisprudencia_dominante": "string"
  },
  "pontos_fortes_cliente": ["string"],
  "pontos_fracos_cliente": ["string"],
  "alertas_imediatos": ["string"],
  "acoes_prioritarias": [{"acao": "string", "prazo": "string ou null", "fundamento": "string"}],
  "confianca": 0.0
}""",
    },

    # ── RISCOS ───────────────────────────────────────────────────────────────
    "riscos": {
        "instrucao": """Faça uma análise de risco como um advogado sênior faria para definir se deve aceitar \
ou continuar o caso e quais medidas adotar.

INSTRUÇÕES:
- Separe riscos PROCESSUAIS (nulidades, preclusão, intempestividade) de riscos MATERIAIS (mérito fraco, \
  prova insuficiente) e FINANCEIROS (valor em risco, custas, honorários sucumbenciais).
- Para cada risco, indique SE e COMO ele pode ser mitigado com ação concreta.
- Identifique prazos de prescrição e decadência se aplicável.
- Avalie o risco de condenação em honorários sucumbenciais (art. 85 CPC ou CLT).
- Seja realista — um risco "crítico" mal avaliado pode custar o caso.

JSON schema:
{
  "nivel_risco_global": "baixo | medio | alto | critico",
  "riscos": [
    {
      "categoria": "prescricao | decadencia | nulidade_processual | prova | merito | prazo | sucumbencia | financeiro | estrategico",
      "descricao": "string",
      "severidade": "baixa | media | alta | critica",
      "probabilidade": "improvavel | possivel | provavel | quase_certo",
      "fundamento_legal": "string (artigo, súmula ou precedente aplicável)",
      "mitigacao": "string (ação concreta para reduzir o risco)",
      "fonte_no_processo": "string"
    }
  ],
  "exposicao_financeira": {
    "valor_principal": "string ou null",
    "juros_multas_estimados": "string ou null",
    "honorarios_sucumbenciais_estimados": "string ou null",
    "total_estimado": "string ou null",
    "base_calculo": "string"
  },
  "prescricao_decadencia": {
    "aplicavel": true,
    "prazo": "string ou null",
    "data_inicio": "string ou null",
    "vencimento": "YYYY-MM-DD ou null",
    "status": "em_prazo | a_vencer_em_breve | vencido | interrompido | suspenso | nao_identificado"
  },
  "prazo_mais_urgente": {"descricao": "string", "data": "YYYY-MM-DD ou null"},
  "confianca": 0.0
}""",
    },

    # ── TESES ────────────────────────────────────────────────────────────────
    "teses": {
        "instrucao": """Mapeie o campo de batalha jurídico: identifique as teses de cada parte, avalie sua força \
e aponte teses que deveriam ter sido levantadas mas não foram.

INSTRUÇÕES:
- Para cada tese, cite o FUNDAMENTO LEGAL ESPECÍFICO (artigo + lei, ou súmula, ou precedente vinculante).
- Avalie se a tese tem suporte na jurisprudência dominante do STJ/STF/TST.
- Identifique teses do adversário que são FORTES e merecem atenção.
- Aponte questões de ordem pública que o juiz pode conhecer de ofício.
- Identifique teses não levantadas que poderiam beneficiar o cliente.
- Diferencie teses processuais de teses de mérito.

JSON schema:
{
  "teses_autor": [
    {
      "tese": "string",
      "natureza": "processual | merito",
      "fundamento_legal": "string (ex: art. 186 CC/2002; Súmula 385 STJ)",
      "status": "acolhida | pendente | rejeitada | nao_apreciada",
      "forca": "solida | razoavel | fragil",
      "jurisprudencia_dominante": "string (favoravel | contraria | divergente | sem_precedente)",
      "evidencia_no_processo": "string"
    }
  ],
  "teses_reu": [
    {
      "tese": "string",
      "natureza": "processual | merito",
      "fundamento_legal": "string",
      "status": "acolhida | pendente | rejeitada | nao_apreciada",
      "forca": "solida | razoavel | fragil",
      "jurisprudencia_dominante": "string",
      "risco_para_autor": "alto | medio | baixo"
    }
  ],
  "questoes_ordem_publica": [{"questao": "string", "fundamento": "string"}],
  "teses_nao_levantadas_pelo_autor": [
    {
      "tese": "string",
      "fundamento_legal": "string",
      "potencial": "alto | medio | baixo",
      "observacao": "string"
    }
  ],
  "teses_nao_levantadas_pelo_reu": [
    {
      "tese": "string",
      "fundamento_legal": "string",
      "risco_para_autor": "alto | medio | baixo"
    }
  ],
  "confianca": 0.0
}""",
    },

    # ── CRONOLOGIA ───────────────────────────────────────────────────────────
    "cronologia": {
        "instrucao": """Extraia a cronologia de ATOS PROCESSUAIS deste processo em ordem cronológica.

⚠ REGRAS CRÍTICAS ANTI-CONTAMINAÇÃO DE DATAS:
- Extraia SOMENTE datas de atos praticados NESTE PROCESSO (protocolos, despachos, citações, \
  audiências, decisões, publicações, recursos, intimações).
- IGNORE completamente datas de: jurisprudência citada nos textos ("Acórdão de 2008..."), \
  referências legislativas ("Lei de 1943", "Código de 1973"), contratos e documentos \
  anexados como provas (que têm datas próprias anteriores ao processo), certidões de \
  outros processos, datas de nascimento ou de contratos mencionados na inicial.
- LÓGICA PROCESSUAL OBRIGATÓRIA que deve ser verificada:
    • Petição inicial SEMPRE é o primeiro ato (data de protocolo = data de propositura)
    • Despacho de recebimento vem APÓS a inicial
    • Citação ocorre APÓS o despacho que a determina
    • Contestação vem APÓS citação (prazo: 15 dias CPC / 8 dias CLT após citação)
    • Réplica vem APÓS contestação
    • Audiência de instrução vem APÓS encerramento da fase escrita
    • Sentença vem APÓS instrução
    • Recursos vêm APÓS a decisão impugnada
- Se encontrar datas que violam esta lógica, DESCARTE-AS e sinalize no campo "inconsistencias".

JSON schema:
{
  "eventos": [
    {
      "data": "YYYY-MM-DD ou null",
      "data_aproximada": false,
      "tipo": "protocolo_inicial | despacho | citacao | contestacao | replica | audiencia | pericia | decisao_interlocutoria | sentenca | acordao | recurso | contrarrazoes | publicacao | intimacao | cumprimento | outro",
      "descricao": "string (inclua quem praticou o ato e o resultado se houver)",
      "relevancia": "baixa | media | alta | critica",
      "fonte_peca": "string (tipo de peça + página)"
    }
  ],
  "inconsistencias": ["string (descreva datas descartadas e o motivo)"],
  "periodo_total": {"inicio": "YYYY-MM-DD ou null", "fim": "YYYY-MM-DD ou null", "duracao_aproximada": "string"},
  "confianca": 0.0
}""",
    },

    # ── PRÓXIMOS PASSOS ──────────────────────────────────────────────────────
    "proximos_passos": {
        "instrucao": """Identifique TODAS as ações concretas que o advogado responsável deve tomar, \
com prazo, fundamento legal e consequência de não agir.

INSTRUÇÕES:
- Liste ações em ordem de urgência (crítica → urgente → alta → normal).
- Para cada prazo processual, cite o artigo legal que o fundamenta.
- Identifique tutelas de urgência, cautelares ou medidas liminares que podem ser requeridas.
- Avalie a possibilidade de negociação/acordo e o momento ideal.
- Indique atos que a PARTE CONTRÁRIA provavelmente tomará em seguida.
- Sinalize se há risco de perda de prazo iminente que possa causar prejuízo irreparável.

JSON schema:
{
  "acoes": [
    {
      "acao": "string (ex: Interpor Apelação contra a sentença de fls. X)",
      "tipo": "recurso | peticao | diligencia | audiencia | acordo | cautelar | tutela | cumprimento | outro",
      "urgencia": "critica | urgente | alta | normal",
      "prazo_legal": "string (ex: 15 dias corridos — art. 1.003, §5º CPC)",
      "data_base": "YYYY-MM-DD ou null (data do ato que inicia o prazo)",
      "vencimento_estimado": "YYYY-MM-DD ou null",
      "fundamento": "string",
      "consequencia_inacao": "string (o que acontece se não agir)"
    }
  ],
  "movimentos_esperados_adversario": ["string"],
  "oportunidade_acordo": {
    "recomendado": true,
    "momento": "string",
    "faixa_sugerida": "string ou null",
    "justificativa": "string"
  },
  "alertas_criticos": ["string"],
  "confianca": 0.0
}""",
    },

    # ── ESTRATÉGIA ───────────────────────────────────────────────────────────
    "estrategia": {
        "instrucao": """Elabore um plano estratégico completo como um advogado sênior que precisa decidir \
o caminho a seguir para maximizar as chances do cliente.

INSTRUÇÕES:
- Primeiro: avalie o terreno — fase atual, forças, fraquezas, jurisprudência dominante.
- Depois: proponha 2-4 estratégias distintas com custo-benefício real.
- Para cada estratégia: seja específico sobre QUAIS PEÇAS protocolar, QUAIS ARGUMENTOS usar, \
  QUAIS PROVAS produzir, QUAIS PRECEDENTES citar.
- Identifique o "melhor cenário", "cenário mais provável" e "pior cenário".
- Avalie se acordo é mais vantajoso que litigância e em que condições.
- Cite súmulas e precedentes vinculantes que apoiam ou prejudicam cada estratégia.

JSON schema:
{
  "aviso": "Sugestões geradas por IA — validação obrigatória pelo advogado responsável.",
  "diagnostico": {
    "tipo_causa": "string",
    "fase": "string",
    "posicao_cliente": "favoravel | desfavoravel | equilibrada",
    "jurisprudencia_dominante": "string",
    "precedentes_favoraveis": ["string (Súmula/Acórdão + tribunal)"],
    "precedentes_contrarios": ["string"]
  },
  "cenarios": {
    "melhor": "string",
    "mais_provavel": "string",
    "pior": "string"
  },
  "estrategias": [
    {
      "nome": "string (ex: Estratégia 1 — Recurso agressivo ao STJ)",
      "descricao": "string",
      "acoes_concretas": ["string (ex: Interpor REsp alegando violação ao art. 422 CC — boa-fé objetiva)"],
      "pecas_a_protocolar": ["string"],
      "provas_a_produzir": ["string"],
      "precedentes_a_citar": ["string"],
      "vantagens": ["string"],
      "riscos": ["string"],
      "custo_estimado": "string ou null",
      "probabilidade_sucesso": "string"
    }
  ],
  "recomendacao_principal": "string",
  "confianca": 0.0
}""",
    },

    # ── IMPACTO DA ATUALIZAÇÃO ────────────────────────────────────────────────
    "impacto_atualizacao": {
        "instrucao": """O processo recebeu novos documentos. Analise o IMPACTO dessas novidades \
na estratégia e nos prazos já em curso.

INSTRUÇÕES:
- Identifique o que mudou em relação à situação anterior.
- Avalie se novos documentos abrem ou fecham possibilidades processuais.
- Recalcule prazos que possam ter sido reiniciados ou criados.
- Sinalize se a estratégia precisa ser revista à luz dos novos fatos.
- Identifique se a parte contrária tomou atos que exigem resposta imediata.

JSON schema:
{
  "novos_documentos": [{"tipo": "string", "paginas": "string", "relevancia": "string"}],
  "mudancas_relevantes": ["string"],
  "mudanca_fase_processual": "string ou null",
  "novas_decisoes": [{"tipo": "string", "resumo": "string", "data": "YYYY-MM-DD ou null", "impacto": "string"}],
  "novos_prazos_criados": [{"descricao": "string", "data_base": "YYYY-MM-DD ou null", "prazo_legal": "string", "vencimento": "YYYY-MM-DD ou null"}],
  "impacto_estrategia": "mantida | ajuste_menor | revisao_necessaria | mudanca_total",
  "justificativa_impacto": "string",
  "acoes_imediatas": [{"acao": "string", "urgencia": "critica | urgente | alta | normal", "prazo": "string ou null", "fundamento": "string"}],
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

_INSTRUCAO_CHUNK_CRON = """Extraia ATOS PROCESSUAIS deste trecho de processo judicial brasileiro.

⚠ REGRAS ANTI-CONTAMINAÇÃO (siga rigorosamente):
- Extraia SOMENTE atos praticados NESTE processo: protocolos, despachos, decisões, citações, \
  intimações, audiências, publicações, recursos, sentenças.
- IGNORE datas de: jurisprudência citada, leis referenciadas, contratos anexados, \
  certidões de outros processos, datas de nascimento, datas de fatos anteriores à ação.
- Se uma data viola a lógica processual (ex: recurso antes da decisão), descarte-a.

Responda SOMENTE com JSON válido:
{
  "eventos": [
    {
      "data": "YYYY-MM-DD ou null",
      "data_aproximada": false,
      "tipo": "protocolo_inicial | despacho | citacao | contestacao | replica | audiencia | pericia | decisao_interlocutoria | sentenca | acordao | recurso | contrarrazoes | publicacao | intimacao | cumprimento | outro",
      "descricao": "descrição completa identificando quem praticou o ato e o resultado",
      "relevancia": "baixa | media | alta | critica",
      "fonte_peca": "tipo de peça e número de página"
    }
  ]
}

Se não há atos processuais identificáveis neste trecho, retorne {"eventos": []}."""


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
            max_tokens=8192,
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
