"""
Geração de minutas e documentos jurídicos assistida por IA.
Usa texto completo das peças + análises anteriores como contexto.

Tipos disponíveis:
  Petições: peticao_inicial, tutela_antecipada, impugnacao_cumprimento
  Recursos: apelacao_civel, embargos_declaracao, agravo_instrumento,
            recurso_ordinario_trabalhista, recurso_especial
  Remédios constitucionais: habeas_corpus, mandado_seguranca
  Pareceres / Utilitários: parecer, resumo_executivo
"""

import uuid
import functools
from datetime import datetime, timezone
from typing import Optional

import anthropic
from loguru import logger

from ..config import get_settings
from ..database import get_supabase, sb_run

settings = get_settings()


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── System prompt base ────────────────────────────────────────────────────────

_SYSTEM = """Você é um advogado sênior brasileiro com 25 anos de atuação, especialista em \
redação de peças processuais de alto impacto. Suas minutas são:
- Tecnicamente impecáveis: citam artigos, súmulas e precedentes corretos
- Estruturalmente corretas: seguem as normas do CPC/2015, CLT e regimentos dos tribunais
- Estrategicamente inteligentes: antecipam contra-argumentos e reforçam os pontos mais fortes
- Práticas: usam linguagem direta, sem repetições desnecessárias

REGRAS OBRIGATÓRIAS:
1. Base-se EXCLUSIVAMENTE nos documentos e análises fornecidos — não invente fatos.
2. Marque com [VERIFICAR: <razão>] qualquer informação que precisa de confirmação humana.
3. Inclua SEMPRE o aviso "⚠ MINUTA PARA REVISÃO — NÃO PROTOCOLAR SEM APROVAÇÃO DO ADVOGADO" no topo.
4. Formate em Markdown profissional (cabeçalhos, negrito nos argumentos principais, listas).
5. Use datas no formato DD/MM/AAAA e valores no formato R$ X.XXX,XX.
6. Em prazos recursais, sempre mencione o fundamento legal do prazo."""


# ── Templates especializados ──────────────────────────────────────────────────

TEMPLATES: dict[str, dict] = {

    # ── PETIÇÕES ─────────────────────────────────────────────────────────────

    "peticao_inicial": {
        "label": "Petição Inicial",
        "categoria": "peticoes",
        "instrucao": """Redija uma petição inicial completa baseada nos fatos e documentos do processo.

ESTRUTURA OBRIGATÓRIA (CPC art. 319):
1. **CABEÇALHO**: Exmo. Sr. Dr. Juiz de Direito da [VERIFICAR: vara] Vara [VERIFICAR: comarca]
2. **QUALIFICAÇÃO DAS PARTES**: Autor e Réu com todos os dados (art. 319, II)
3. **DOS FATOS**: Narrativa cronológica clara e persuasiva
4. **DO DIREITO**: Fundamentos legais com artigos exatos e jurisprudência
5. **DOS PEDIDOS**: Liste TODOS os pedidos (principal + cumulados + honorários art. 85 CPC)
6. **DO VALOR DA CAUSA**: Especifique conforme art. 292 CPC
7. **DAS PROVAS**: Rol de provas que pretende produzir (art. 319, VI)
8. **REQUERIMENTOS FINAIS**: Citação do réu, gratuidade se aplicável

Identifique o tipo de causa e aplique o rito correto (comum, sumário, JEF, trabalhista).""",
    },

    "tutela_antecipada": {
        "label": "Petição de Tutela Antecipada / Cautelar",
        "categoria": "peticoes",
        "instrucao": """Redija uma petição de tutela de urgência (antecipada ou cautelar) baseada nos autos.

ANÁLISE INICIAL: Determine o cabimento correto:
- Tutela antecipada (art. 300 CPC): probabilidade do direito + perigo de dano/risco ao resultado útil
- Tutela de evidência (art. 311 CPC): dispensa periculum — aplique se os fatos indicarem uma das hipóteses
- Tutela cautelar (art. 301 CPC): medida assecuratória do direito principal

ESTRUTURA:
1. **CABIMENTO DA TUTELA DE URGÊNCIA**
   - Fumus boni iuris: demonstre a probabilidade do direito com fundamentos sólidos
   - Periculum in mora: descreva o dano concreto e irreversível se não concedida
2. **DO PEDIDO LIMINAR** (art. 300 §2º CPC — inaudita altera pars se urgente)
3. **DA MEDIDA REQUERIDA**: Seja específico — bloqueio, sustação, proibição, entrega etc.
4. **DA REVERSIBILIDADE** (ou por que a irreversibilidade é justificada — art. 300 §3º)
5. **DO PEDIDO PRINCIPAL** (se tutela antecedente — arts. 303-304 CPC)

Fundamente com jurisprudência recente do STJ sobre a tutela de urgência específica.""",
    },

    "impugnacao_cumprimento": {
        "label": "Impugnação ao Cumprimento de Sentença",
        "categoria": "peticoes",
        "instrucao": """Redija uma impugnação ao cumprimento de sentença (art. 525 CPC) ou embargos à execução (art. 917 CPC).

ATENÇÃO AO PRAZO: 15 dias da intimação para impugnar (art. 525 caput CPC). [VERIFICAR: data da intimação]

MATÉRIAS ARGUÍVEIS (art. 525 §1º CPC — rol taxativo):
Identifique quais das seguintes matérias se aplicam ao caso:
I - falta ou nulidade da citação no processo de conhecimento
II - ilegitimidade de parte
III - inexequibilidade do título ou inexigibilidade da obrigação
IV - penhora incorreta / avaliação errônea
V - excesso de execução (calcule o valor correto) — SEMPRE inclua memória de cálculo
VI - incompetência absoluta ou relativa
VII - qualquer causa modificativa ou extintiva superveniente

ESTRUTURA:
1. **DA TEMPESTIVIDADE** (com datas e fundamento)
2. **DO EXCESSO DE EXECUÇÃO** (se aplicável — art. 525 §4-5 CPC: indicar valor correto com memória)
3. **DAS DEMAIS MATÉRIAS** (organizar por matéria, cada uma com fundamento e pedido específico)
4. **DO EFEITO SUSPENSIVO** (art. 525 §6º — requerê-lo se presentes os requisitos)
5. **DOS PEDIDOS**: acolhimento + extinção/redução + efeito suspensivo + honorários""",
    },

    # ── RECURSOS ─────────────────────────────────────────────────────────────

    "apelacao_civel": {
        "label": "Recurso de Apelação Cível",
        "categoria": "recursos",
        "instrucao": """Redija um recurso de apelação cível (art. 1.009 CPC) contra a sentença identificada nos autos.

PRAZO: 15 dias úteis da publicação da sentença (art. 1.003 §5º CPC). [VERIFICAR: data da publicação]

ESTRUTURA OBRIGATÓRIA:
1. **TEMPESTIVIDADE E CABIMENTO**
   - Cite art. 1.009 e art. 1.003 §5º CPC
   - Mencione a data da publicação e o vencimento do prazo
2. **PREPARO** [VERIFICAR: valor do preparo conforme tabela do tribunal]
3. **DOS FATOS E DA SENTENÇA RECORRIDA**
   - Síntese objetiva dos fatos e do que a sentença decidiu
4. **DAS RAZÕES DO RECURSO**
   a) **PRELIMINARES** (nulidade, cerceamento de defesa, extra/ultra/citra petita — se houver)
   b) **DO MÉRITO**
      - Ponto a ponto, rebata cada fundamento da sentença
      - Cite os precedentes do STJ/STF contrários à tese do juiz
      - Defenda a tese do apelante com artigos e jurisprudência dominante
5. **DO EFEITO SUSPENSIVO** (art. 1.012 — automático; mencione se a sentença não comporta)
6. **DOS PEDIDOS**: conhecimento + provimento + julgamento favorável + honorários recursais (art. 85 §11)""",
    },

    "embargos_declaracao": {
        "label": "Embargos de Declaração",
        "categoria": "recursos",
        "instrucao": """Redija embargos de declaração (art. 1.022 CPC) contra a decisão/sentença/acórdão identificado nos autos.

PRAZO: 5 dias úteis (art. 1.023 CPC). [VERIFICAR: data da publicação]

HIPÓTESES DE CABIMENTO (art. 1.022 — identifique quais se aplicam):
- Obscuridade: ponto da decisão que não é claro
- Contradição: incoerência interna entre fundamentos ou com o dispositivo
- Omissão: questão suscitada que não foi apreciada (art. 489 §1º)
- Erro material: equívoco nos dados ou cálculo

ESTRUTURA:
1. **CABIMENTO E TEMPESTIVIDADE**
2. **DA OMISSÃO / CONTRADIÇÃO / OBSCURIDADE** (um tópico por vício, com citação da parte da decisão)
3. **DO PREQUESTIONAMENTO** (se recurso ao STJ/STF em vista — cite RE/REsp via embargos: Súm. 356 STF / Súm. 211 STJ)
4. **DO EFEITO INFRINGENTE** (se o vício for tal que a correção altere o resultado — art. 1.022 par. único)
5. **DO PEDIDO**: acolhimento + saneamento do vício + novo julgamento se infringente

ATENÇÃO: Embargos protelatórios geram multa (art. 1.026 §2º). Seja preciso e objetivo.""",
    },

    "agravo_instrumento": {
        "label": "Agravo de Instrumento",
        "categoria": "recursos",
        "instrucao": """Redija um agravo de instrumento (art. 1.015 CPC) contra a decisão interlocutória identificada nos autos.

PRAZO: 15 dias úteis da intimação (art. 1.003 §5º). [VERIFICAR: data da intimação]

CABIMENTO (art. 1.015 — taxatividade mitigada, STJ EREsp 1.696.396):
Identifique em qual hipótese do art. 1.015 se enquadra a decisão agravada.
Se não expressamente previsto, argumente com a taxatividade mitigada (urgência objetiva).

ESTRUTURA:
1. **DO CABIMENTO** (hipótese do art. 1.015 + justificativa)
2. **DA TEMPESTIVIDADE**
3. **DAS PEÇAS OBRIGATÓRIAS** [VERIFICAR: juntar cópias conforme art. 1.017 CPC]
4. **DO PEDIDO DE EFEITO SUSPENSIVO / ANTECIPAÇÃO** (art. 1.019, I — presença de fumus + periculum)
5. **DA DECISÃO AGRAVADA** (reproduzir o trecho relevante)
6. **DAS RAZÕES**
   - Por que a decisão está errada: fundamento legal + jurisprudência
   - Qual deveria ser a decisão correta
7. **DOS PEDIDOS**: efeito suspensivo liminar + provimento + reforma da decisão + honorários""",
    },

    "recurso_ordinario_trabalhista": {
        "label": "Recurso Ordinário Trabalhista",
        "categoria": "recursos",
        "instrucao": """Redija um Recurso Ordinário (art. 895 CLT) contra a sentença trabalhista identificada nos autos.

PRAZO: 8 dias (art. 6º Lei 5.584/70 — dias corridos, salvo feriados; atenção: CLT usa dias corridos).
[VERIFICAR: data da publicação da sentença na DEJT]

PREPARO: Depósito recursal (art. 899 CLT) + custas processuais (art. 789 CLT). [VERIFICAR: valores]

PECULIARIDADES TRABALHISTAS:
- Reforma 2017: honorários sucumbenciais art. 791-A (se processo pós-11/11/2017)
- Horas extras: aplicar Súmulas TST 23, 338, 340 e 437 conforme o caso
- Prescrição: bienal/quinquenal (art. 11 CLT) — verificar se foi corretamente aplicada
- Dano moral: tabelamento art. 223-G CLT (constitucionalidade questionada — RE 1.401.560 STF)

ESTRUTURA:
1. **TEMPESTIVIDADE, CABIMENTO E PREPARO**
2. **SÍNTESE DA SENTENÇA RECORRIDA**
3. **RAZÕES DO RECURSO**
   - Preliminares (se houver nulidade processual)
   - Mérito: rebata ponto a ponto com Súmulas e OJs do TST específicas
4. **DOS PEDIDOS**: reforma total/parcial da sentença + honorários recursais""",
    },

    "recurso_especial": {
        "label": "Recurso Especial (REsp)",
        "categoria": "recursos",
        "instrucao": """Redija um Recurso Especial (art. 105, III CF + arts. 1.029-1.041 CPC) para o STJ.

PRAZO: 15 dias úteis da publicação do acórdão (art. 1.003 §5º). [VERIFICAR: data]

PRESSUPOSTOS ESPECÍFICOS DO REsp — analise cada um:
a) **Prequestionamento**: a questão federal deve ter sido decidida no acórdão (Súms. 282/356 STF e 211 STJ)
b) **Violação à lei federal** (art. 105, III, "a"): cite o(s) artigo(s) violados exatamente
c) **Dissídio jurisprudencial** (art. 105, III, "c"): caso análogo de outro TJ/TRF com resultado diferente — inclua ementa e número

ESTRUTURA:
1. **TEMPESTIVIDADE E CABIMENTO** (hipótese constitucional + prequestionamento)
2. **DA QUESTÃO FEDERAL CONTROVERTIDA** (sintetize em 1 parágrafo)
3. **DAS RAZÕES**
   - Para cada artigo violado: o que diz a lei, o que o acórdão decidiu, e o erro
   - Para dissídio: comparação com o paradigma (mesma situação fática, resultado oposto)
4. **SÚMULAS APLICÁVEIS** (afastamento fundamentado se o tribunal aplicou súmula erroneamente)
5. **DO PEDIDO**: conhecimento + provimento + julgamento conforme o direito federal
6. **DO PREQUESTIONAMENTO EXPLÍCITO** (citar páginas/fls. do acórdão onde o tema aparece)""",
    },

    # ── REMÉDIOS CONSTITUCIONAIS ──────────────────────────────────────────────

    "habeas_corpus": {
        "label": "Habeas Corpus",
        "categoria": "remedios_constitucionais",
        "instrucao": """Redija um Habeas Corpus (art. 5º LXVIII CF + arts. 647-667 CPP) para impetrar contra o ato identificado nos autos.

IDENTIFICAÇÃO:
- Paciente: [VERIFICAR: nome completo e CPF]
- Impetrante: [VERIFICAR: advogado e OAB]
- Autoridade coatora: [VERIFICAR: juízo ou tribunal]
- Tribunal competente: [VERIFICAR: instância correta para impetrar]

CABIMENTO (art. 647 CPP): violência ou coação ilegal na liberdade de locomoção.
Identifique o constrangimento ilegal: prisão sem flagrante válido / sem ordem judicial / excesso de prazo / falta de fundamentação / ausência de requisitos da preventiva.

ESTRUTURA:
1. **DO CABIMENTO E DA COMPETÊNCIA**
2. **DO CONSTRANGIMENTO ILEGAL** (descreva o ato coator com precisão)
3. **DOS FUNDAMENTOS JURÍDICOS**
   - Cite o vício exato: CPP + jurisprudência do STJ/STF sobre o tema específico
   - HC 313.021 STJ / RHC relevantes sobre o tipo de ilegalidade
4. **DO PEDIDO LIMINAR** (art. 660 §2º CPP — urgência)
5. **DO MÉRITO**: concessão da ordem + soltura / relaxamento / revogação da prisão
6. **DO PEDIDO FINAL** com toda a consequência da concessão

⚠ ATENÇÃO: HC não é substitutivo de recurso ordinário (Súm. 691/STF). Verifique se o caminho correto não é RHC ou agravo em recurso ordinário.""",
    },

    "mandado_seguranca": {
        "label": "Mandado de Segurança",
        "categoria": "remedios_constitucionais",
        "instrucao": """Redija um Mandado de Segurança (art. 5º LXIX CF + Lei 12.016/2009) contra o ato identificado nos autos.

PRAZO DECADENCIAL: 120 dias do conhecimento do ato coator (art. 23 Lei 12.016/2009). [VERIFICAR: data do ato]

PRESSUPOSTOS (analise cada um):
1. **Direito líquido e certo**: fato incontroverso demonstrável por prova documental pré-constituída
2. **Ato de autoridade coatora**: pessoa jurídica de direito público ou delegatária
3. **Ilegalidade ou abuso de poder**: cite o dispositivo violado

COMPETÊNCIA: [VERIFICAR — depende de quem é a autoridade coatora]

ESTRUTURA:
1. **DA ADMISSIBILIDADE** (competência + legitimidade + prazo + direito líquido e certo)
2. **DO ATO COATOR** (descreva com precisão, cite o ato e a autoridade)
3. **DA ILEGALIDADE / ABUSO DE PODER** (fundamento legal exato)
4. **DO PEDIDO LIMINAR** (art. 7º §3º Lei 12.016 — fumus + periculum)
5. **DO MÉRITO**: concessão da segurança + anulação/suspensão do ato + efeitos práticos
6. **DAS PROVAS DOCUMENTAIS** (rol dos documentos que acompanham — prova pré-constituída)
7. **DO PEDIDO FINAL** com ciência à autoridade coatora (art. 7º, I)""",
    },

    # ── PARECERES / UTILITÁRIOS ───────────────────────────────────────────────

    "parecer": {
        "label": "Parecer Jurídico",
        "categoria": "pareceres",
        "instrucao": """Redija um parecer técnico-jurídico completo sobre o processo.

ESTRUTURA:
1. **RELATÓRIO** — Síntese objetiva dos fatos e da situação processual atual
2. **QUESTÕES JURÍDICAS** — Liste as questões a serem respondidas
3. **ANÁLISE JURÍDICA** — Para cada questão:
   - Tese aplicável com fundamento legal (artigos exatos)
   - Jurisprudência dominante (STJ/STF/TRT/TRF conforme a área)
   - Aplicação ao caso concreto
   - Grau de certeza: [SÓLIDO | PROVÁVEL | CONTROVERTIDO | INCERTO]
4. **RISCOS E OPORTUNIDADES** — Avaliação honesta das chances de êxito
5. **CONCLUSÃO** — Resposta direta a cada questão + recomendação de conduta
6. **RESSALVA** — Limitações do parecer (baseado nos documentos fornecidos)

Use terminologia técnica precisa. Cite precedentes com tribunal + número quando souber.""",
    },

    "resumo_executivo": {
        "label": "Resumo Executivo",
        "categoria": "pareceres",
        "instrucao": """Redija um resumo executivo do processo para leitura em 3 minutos.

ESTRUTURA:
## Visão Geral
Uma frase: o que é o caso, quem são as partes, onde está processualmente.

## Situação Atual
- Fase: [fase processual exata]
- Última movimentação: [data + ato]
- Próximo prazo: [data + ato obrigatório]

## Pontos Críticos
Lista dos 3-5 pontos que merecem atenção imediata (riscos, oportunidades, prazos).

## Avaliação de Chances
- Perspectiva: [Favorável / Desfavorável / Incerta]
- Justificativa: (1-2 frases honestas)

## Próximos Passos
Ações concretas em ordem de prioridade, com prazo de cada uma.

Máximo 600 palavras. Sem jargão desnecessário. Cite fontes entre [colchetes].""",
    },
}


# ── Acesso à lista de tipos (para validação nos routers) ─────────────────────

TIPOS_VALIDOS = set(TEMPLATES.keys())


# ── Contexto do processo ──────────────────────────────────────────────────────

async def _buscar_contexto(processo_id: uuid.UUID, max_chars: int = 120_000) -> str:
    """Monta contexto completo: análises anteriores + texto das peças."""
    sb = get_supabase()

    # Análises anteriores (diagnóstico + estado_atual são as mais ricas)
    analises_r = await sb_run(
        lambda: sb.table("analises")
        .select("tipo,conteudo_json")
        .eq("processo_id", str(processo_id))
        .in_("tipo", ["diagnostico_completo", "estado_atual", "estrategia_vencedora", "resumo_executivo", "riscos"])
        .order("created_at", desc=True)
        .limit(3)
        .execute()
    )
    blocos: list[str] = []
    for a in (analises_r.data or []):
        tipo = a.get("tipo", "").upper()
        import json
        blocos.append(f"=== ANÁLISE IA: {tipo} ===\n{json.dumps(a.get('conteudo_json', {}), ensure_ascii=False, indent=2)}")

    # Texto das peças (mais recentes primeiro, priorizando decisivas)
    pecas_r = await sb_run(
        lambda: sb.table("pecas")
        .select("tipo_peca,pagina_inicio,pagina_fim,conteudo_texto")
        .eq("processo_id", str(processo_id))
        .order("pagina_inicio", desc=False)
        .execute()
    )
    for p in (pecas_r.data or []):
        tipo = p.get("tipo_peca", "peca").upper()
        pags = f"pág. {p.get('pagina_inicio')}-{p.get('pagina_fim')}"
        texto = (p.get("conteudo_texto") or "(sem texto)")[:8_000]
        blocos.append(f"=== {tipo} ({pags}) ===\n{texto}")

    ctx = "\n\n".join(blocos)
    return ctx[:max_chars]


# ── Geração principal ─────────────────────────────────────────────────────────

async def gerar_minuta(
    processo_id: uuid.UUID,
    tipo: str,
    titulo: str,
    instrucoes: Optional[str] = None,
    usuario_id: Optional[uuid.UUID] = None,
    analise_id: Optional[uuid.UUID] = None,
) -> dict:
    import asyncio

    if tipo not in TEMPLATES:
        raise ValueError(f"Tipo de minuta inválido: '{tipo}'. Tipos disponíveis: {', '.join(TEMPLATES)}")

    sb = get_supabase()
    tpl = TEMPLATES[tipo]

    contexto = await _buscar_contexto(processo_id)
    if not contexto:
        raise ValueError("Processo sem documentos. Faça o upload dos autos antes de gerar a minuta.")

    instrucao = tpl["instrucao"]
    if instrucoes:
        instrucao += f"\n\n**INSTRUÇÕES ADICIONAIS DO ADVOGADO:**\n{instrucoes}"

    prompt = (
        f"# DOCUMENTOS E ANÁLISES DO PROCESSO\n\n{contexto}\n\n"
        f"---\n\n# TAREFA\n\n{instrucao}\n\n"
        f"**TÍTULO DA MINUTA:** {titulo}"
    )

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    loop = asyncio.get_event_loop()
    msg = await loop.run_in_executor(
        None,
        functools.partial(
            client.messages.create,
            model=settings.llm_model,
            max_tokens=8_000,
            system=_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        ),
    )

    conteudo_md = msg.content[0].text.strip()
    tokens_usados = msg.usage.input_tokens + msg.usage.output_tokens

    minuta_data = {
        "id": str(uuid.uuid4()),
        "processo_id": str(processo_id),
        "analise_id": str(analise_id) if analise_id else None,
        "tipo": tipo,
        "titulo": titulo,
        "conteudo_md": conteudo_md,
        "versao": 1,
        "status": "rascunho",
        "fontes_json": [],
        "confianca": 0.75,
        "criado_por": str(usuario_id) if usuario_id else None,
    }
    minuta_r = await sb_run(lambda: sb.table("minutas").insert(minuta_data).execute())
    minuta = minuta_r.data[0]

    # Cria tarefa de revisão obrigatória
    tarefa_data = {
        "id": str(uuid.uuid4()),
        "processo_id": str(processo_id),
        "tipo": "minuta",
        "titulo": f"Revisar: {titulo}",
        "descricao": (
            f"Minuta de {tpl['label']} gerada por IA. "
            "REVISÃO HUMANA OBRIGATÓRIA antes de qualquer uso externo ou protocolo."
        ),
        "prioridade": "alta",
        "status": "pendente",
        "atribuido_para": str(usuario_id) if usuario_id else None,
        "atribuido_por": str(usuario_id) if usuario_id else None,
        "metadados": {"minuta_id": minuta["id"], "tipo_minuta": tipo},
    }
    await sb_run(lambda: sb.table("tarefas_revisao").insert(tarefa_data).execute())

    logger.success(f"Minuta '{titulo}' ({tipo}) gerada — {tokens_usados} tokens")
    return minuta


# ── Versionamento ─────────────────────────────────────────────────────────────

async def salvar_versao(
    minuta_id: uuid.UUID,
    novo_conteudo: str,
    usuario_id: Optional[uuid.UUID] = None,
) -> dict:
    sb = get_supabase()

    minuta_r = await sb_run(
        lambda: sb.table("minutas").select("*").eq("id", str(minuta_id)).limit(1).execute()
    )
    if not minuta_r.data:
        raise ValueError("Minuta não encontrada")
    minuta = minuta_r.data[0]

    # Salva versão anterior no histórico
    hist_data = {
        "id": str(uuid.uuid4()),
        "minuta_id": str(minuta_id),
        "versao": minuta["versao"],
        "conteudo_md": minuta["conteudo_md"],
        "alterado_por": str(usuario_id) if usuario_id else None,
    }
    await sb_run(lambda: sb.table("minutas_historico").insert(hist_data).execute())

    upd_r = await sb_run(
        lambda: sb.table("minutas").update({
            "conteudo_md": novo_conteudo,
            "versao": minuta["versao"] + 1,
            "status": "em_revisao",
        }).eq("id", str(minuta_id)).execute()
    )
    return upd_r.data[0]
