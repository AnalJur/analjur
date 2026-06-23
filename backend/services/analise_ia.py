"""
Análises jurídicas via Claude.

Estratégias por tamanho:
  ≤ 185K tokens  → contexto direto (tudo enviado de uma vez)
  >  185K tokens → sumarização hierárquica por peça
  cronologia     → extração POR PEÇA (piece-anchored) + consolidação final
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
PECA_MAX_TOKENS    = 90_000    # máximo de tokens por peça para cronologia
RESUMO_MAX_TOKENS  = 2_500    # tokens de saída por peça resumida

PECAS_PRIORITARIAS = {
    "sentenca", "acordao", "decisao_interlocutoria", "peticao_inicial",
    "contestacao", "recurso",
}

# Peças que merecem o modelo Sonnet (mais poderoso) na extração de cronologia
PECAS_PREMIUM = {
    "sentenca", "acordao", "peticao_inicial", "recurso",
    "embargos_declaracao", "agravo",
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

# ── System prompts especializados por área do direito ─────────────────────────

_SYSTEM_POR_AREA: dict[str, str] = {
    "trabalhista": """\

ESPECIALIZAÇÃO — DIREITO DO TRABALHO:
- Aplique CLT (pós-Reforma 13.467/2017): art. 11 (prescrição bienal/quinquenal), art. 840 \
  (requisitos da petição inicial), art. 791-A (honorários sucumbenciais), art. 855-B a 855-E (acordo extrajudicial).
- Súmulas e OJs do TST são vinculantes — cite sempre o número (ex: Súmula 277 TST, OJ 330 SDI-1).
- Reforma Trabalhista 2017: identifique se os fatos são anteriores ou posteriores à vigência \
  (vigência: 11/11/2017) — impacta prescrição, honorários, periciais e terceirização.
- Reconhecimento de vínculo empregatício: art. 3º CLT — analise subordinação, pessoalidade, \
  habitualidade e onerosidade. Pejotização: verifique fraude nos contratos de prestação de serviços.
- Horas extras: Súmulas 23, 338, 340 e 437 TST. Banco de horas: Súmula 85 TST.
- FGTS: prescrição trintenária (antes de 2015) vs. bienal/quinquenal (após ARE 709.212 STF).
- Prescrição intercorrente: art. 11-A CLT — vigente apenas nos processos após 11/11/2017.
- Dano extrapatrimonial: art. 223-A a 223-G CLT — tabelamento constitucional questionado (STF RE 1.401.560).""",

    "civil": """\

ESPECIALIZAÇÃO — DIREITO CIVIL / PROCESSUAL CIVIL:
- CPC/2015 com rigor: identifique preclusões (art. 507), nulidades (art. 276-283) e vícios de procedimento.
- Prescrição (CC art. 205-206) e decadência: cite o prazo específico aplicável ao caso concreto.
- Responsabilidade civil: art. 186-188 CC (ato ilícito), art. 927 (responsabilidade objetiva), \
  art. 944 (extensão do dano) e art. 945 (culpa concorrente).
- Contratos: art. 421-422 CC (função social + boa-fé objetiva), art. 317 (revisão), \
  art. 478-480 (resolução por onerosidade excessiva), art. 413 (redução equitativa de cláusula penal).
- Tutelas de urgência: art. 300 CPC (tutela antecipada — fumus + periculum), art. 301 (cautelar), \
  art. 311 (tutela de evidência — dispensa periculum).
- Recursos: apelação art. 1.009 (15 dias), agravo art. 1.015 (taxatividade mitigada — STJ), \
  REsp art. 1.029 (prazo 15 dias), RE (repercussão geral).
- Honorários sucumbenciais: art. 85 CPC — faixas progressivas; fixação por equidade (§8º) quando \
  valor da causa for irrisório ou inestimável.
- Execução: ordem de penhora art. 835, parcelamento art. 916, impenhorabilidade art. 833.""",

    "consumidor": """\

ESPECIALIZAÇÃO — DIREITO DO CONSUMIDOR:
- CDC (Lei 8.078/90): responsabilidade objetiva do fornecedor (art. 12-14), inversão do ônus da \
  prova (art. 6º, VIII — fato do produto/serviço e hipossuficiência técnica).
- Vícios do produto: art. 18-20 CDC — prazo de reclamação 30 dias (não duráveis) / 90 dias (duráveis); \
  prazo prescricional: 5 anos (art. 27 — fato do produto) ou 3 anos (CC art. 206, §3º, V — vício).
- Cláusulas nulas de pleno direito: art. 51 CDC (lista exemplificativa — Súmula 302 STJ: limite temporal em seguro de vida).
- Práticas abusivas: art. 39 CDC — venda casada, recusa de orçamento, cobrança vexatória.
- Repetição de indébito em dobro: art. 42 par. único CDC — exige cobrança extrajudicial; \
  Súmula 159 STJ: aplica-se em cobranças judiciais indevidas.
- Dano moral in re ipsa (STJ): negativação indevida (Súmula 385), inscrição abusiva em cadastro, \
  cancelamento de voo sem aviso, descumprimento de oferta (art. 35 CDC).
- Planos de saúde: Lei 9.656/98 + RN ANS 465/21 — ROL é exemplificativo (STJ EREsp 1.886.929).
- Bancos e financeiras: Súmula 297 STJ (CDC aplica-se), Súmula 530 STJ (prazo 5 anos).""",

    "tributario": """\

ESPECIALIZAÇÃO — DIREITO TRIBUTÁRIO:
- CTN (Lei 5.172/66): lançamento (art. 142-150), decadência (art. 150, 173 — 5 anos), \
  prescrição para cobrança (art. 174 — 5 anos da constituição definitiva do crédito).
- Execução fiscal: Lei 6.830/80 — embargos (30 dias após garantia integral do juízo, art. 16), \
  exceção de pré-executividade (matérias de ordem pública, Súmula 393 STJ).
- REDIRECIONAMENTO: art. 135 CTN (sócios gerentes) — Súmula 435 STJ (dissolução irregular).
- Compensação tributária: art. 170 CTN + Lei 9.430/96 (RFB) — condições e limitações.
- Repetição de indébito: art. 165-168 CTN; prazo 5 anos (STJ Tema 164 — ação de repetição prescreve em 5 anos).
- PGFN / transação tributária: Lei 13.988/20 — condições, descontos, parcelamento.
- Precedentes vinculantes: RE 574.706 STF (ICMS fora da base PIS/COFINS — Tema 69), \
  RE 240.785 STF (ICMS-ST), Tema 1.048 STJ (IRPJ/CSLL sobre Selic na repetição de indébito).
- Medida liminar em MS para suspender exigibilidade: art. 151, IV CTN — requisitos.""",

    "criminal": """\

ESPECIALIZAÇÃO — DIREITO PENAL / PROCESSUAL PENAL:
- CPP: fases (inquérito → denúncia → recebimento → citação → resposta → instrução → alegações → sentença).
- Prescrição penal: CP art. 109-119 — calculada pela pena máxima abstrata antes do trânsito; \
  pela pena concreta após (prescrição retroativa e intercorrente).
- Nulidades absolutas (CPP art. 564): ausência de citação válida, falta de defesa técnica, \
  sentença sem fundamentação, cerceamento de defesa.
- Habeas corpus: constrangimento ilegal, excesso de prazo (Súmula 21 STJ), prisão sem fumus.
- Prisão preventiva: art. 312 CPP — garantia da ordem pública/econômica, conveniência da instrução, \
  assegurar a aplicação da lei penal. Duração razoável: Súmula 21 STJ.
- Tráfico de drogas: Lei 11.343/06 — art. 33 vs art. 28 (uso pessoal vs. tráfico); \
  redutor art. 33 §4º (40%-2/3): primário, bons antecedentes, não integrante de organização.
- Lei 12.850/13 (organizações criminosas): colaboração premiada, infiltração, ação controlada.
- Execução penal: LEP (Lei 7.210/84) — progressão de regime, livramento condicional, remição.""",

    "administrativo": """\

ESPECIALIZAÇÃO — DIREITO ADMINISTRATIVO:
- Princípios da Administração (CF art. 37): legalidade, impessoalidade, moralidade, publicidade, \
  eficiência. Violação a qualquer um fundamenta anulação do ato.
- Processo administrativo: Lei 9.784/99 (federal) — contraditório, ampla defesa, motivação \
  (art. 50), razoabilidade e proporcionalidade.
- Improbidade administrativa: Lei 8.429/92 reformada pela Lei 14.230/21 — DOLO ESPECÍFICO \
  obrigatório (STF ADI 7.236); prescrição 8 anos (art. 23).
- Licitações: Lei 14.133/21 (vigente) vs. Lei 8.666/93 (processos anteriores) — cite a lei \
  correta conforme a data do edital.
- Servidores públicos: CF art. 41 (estabilidade), Lei 8.112/90 (PAD, demissão, reintegração), \
  Súmula 20 STJ (proibição de reformatio in pejus no processo administrativo).
- Mandado de segurança: Lei 12.016/09 — prazo DECADENCIAL de 120 dias (art. 23), direito líquido \
  e certo, ato ilegal/abusivo de autoridade pública.
- Responsabilidade do Estado: CF art. 37 §6º — teoria do risco administrativo (objetiva); \
  excludentes: culpa exclusiva da vítima, caso fortuito/força maior.""",
}


def _get_system(tipo_causa: Optional[str] = None) -> str:
    """Retorna SYSTEM_BASE + adendo especializado conforme o tipo de causa."""
    base = SYSTEM_BASE
    if tipo_causa:
        chave = tipo_causa.lower().strip()
        # normaliza variantes
        if "trabalh" in chave:
            chave = "trabalhista"
        elif "consumid" in chave:
            chave = "consumidor"
        elif "tribut" in chave or "fiscal" in chave:
            chave = "tributario"
        elif "crimin" in chave or "penal" in chave:
            chave = "criminal"
        elif "admin" in chave:
            chave = "administrativo"
        elif "civil" in chave:
            chave = "civil"
        adendo = _SYSTEM_POR_AREA.get(chave)
        if adendo:
            base = base + adendo
    return base


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

    # ── DESCRIÇÃO FIEL DE DOCUMENTOS ─────────────────────────────────────────
    "descricao_documentos": {
        "instrucao": """Produza uma descrição FIEL e DETALHADA de cada peça processual dos autos.

INSTRUÇÕES CRÍTICAS:
- Para cada peça: descreva O QUE ELA É e O QUE ELA DIZ — não interprete, não analise o mérito.
- Seja fiel ao texto original: nas partes decisórias, reproduza as palavras exatas.
- Para sentenças e acórdãos: transcreva o dispositivo completo (a parte que começa "JULGO" / \
  "DECIDE" / "ACORDAM") — não resuma, reproduza literalmente.
- Para petições: liste todos os pedidos na ordem em que foram formulados.
- Para decisões interlocutórias: reproduza o trecho decisório exato e a determinação às partes.
- Para certidões: descreva o que certifica, a data e quem assinou.
- Inclua sempre: quem elaborou/assinou, data, órgão/juízo, valores mencionados.
- "relevancia_documental" avalia a função processual da peça (não o mérito).

JSON schema:
{
  "documentos": [
    {
      "tipo_peca": "string",
      "paginas": "string (ex: pág. 1-15)",
      "data_documento": "YYYY-MM-DD ou null",
      "data_aproximada": false,
      "autor": "string (quem assinou/elaborou — nome completo e qualificação)",
      "destinatario": "string ou null",
      "orgao_juizo": "string ou null (vara, câmara, tribunal ou órgão)",
      "descricao_fiel": "string (descrição objetiva do conteúdo — mínimo 80 palavras)",
      "transcricao_dispositivo": "string ou null (dispositivo literal se for decisão/sentença/acórdão)",
      "pedidos": ["string — lista dos pedidos se for petição, ou []"],
      "fundamentos_legais_citados": ["artigos, súmulas e precedentes mencionados na peça, ou []"],
      "valores_mencionados": ["valores monetários relevantes com contexto, ou []"],
      "partes_mencionadas": ["nome — papel processual, ou []"],
      "funcao_processual": "string (qual o papel desta peça no processo)",
      "relevancia_documental": "essencial | alta | media | baixa"
    }
  ],
  "total_pecas_descritas": 0,
  "observacoes_gerais": "string ou null",
  "confianca": 0.0
}""",
    },

    # ── DIAGNÓSTICO COMPLETO ──────────────────────────────────────────────────
    "diagnostico_completo": {
        "instrucao": """Você é um advogado sênior recebendo este processo para análise completa. \
Produza um diagnóstico COMPLETO como se fosse preparar um parecer para o cliente antes de uma audiência decisiva.

SEU DIAGNÓSTICO DEVE COBRIR:

1. VISÃO GERAL: Identifique o tipo de causa, as partes, o que está em jogo e o estado atual.
2. LINHA DO TEMPO: Extraia os atos processuais MAIS RELEVANTES em ordem cronológica (foco nos marcos: \
   inicial, citação, contestação, audiências, decisões, recursos). Ignore atos irrelevantes.
3. FALHAS E OPORTUNIDADES: Identifique TODOS os vícios processuais, nulidades, preclusões ou \
   irregularidades — tanto as que podem ser exploradas em favor do cliente, quanto as que o adversário \
   pode usar. Um advogado experiente SEMPRE verifica se: houve citação válida, se prazos foram \
   respeitados, se há cerceamento de defesa, se a sentença foi ultra ou extra petita, se há omissões, \
   se cláusulas são abusivas (CDC), se há prescrição/decadência não arguida.
4. TESES JURÍDICAS: Liste as teses já levantadas e as que DEVERIAM ser levantadas mas não foram. \
   Fundamente com artigos, súmulas e precedentes vinculantes.
5. MAPA DE RISCOS: Avalie os riscos reais com olhar clínico — não minimize riscos para "agradar" o cliente.
6. ESTRATÉGIA RECOMENDADA: Escolha UM caminho principal e justifique. Seja específico sobre \
   quais peças protocolar, quais argumentos usar, quais provas produzir.
7. PRÓXIMOS PASSOS: Liste as ações com prazo e consequência de não agir.

⚠ REGRAS:
- Base APENAS no que consta nos documentos. Nunca invente.
- Cite fonte (tipo de peça + página) para cada afirmação relevante.
- Use terminologia jurídica precisa.
- Seja direto — diagnóstico real, não otimismo vazio.

JSON schema:
{
  "situacao_executiva": "string (2-3 frases: o que é, onde está, o que está em risco)",
  "tipo_causa": "trabalhista | civil | consumidor | tributario | criminal | administrativo | outro",
  "instancia": "string",
  "fase_processual": "string",
  "partes": {
    "autor": [{"nome": "string", "advogado": "string ou null"}],
    "reu": [{"nome": "string", "advogado": "string ou null"}]
  },
  "valor_causa": "string ou null",
  "cronologia_marcos": [
    {
      "data": "YYYY-MM-DD ou null",
      "tipo": "string",
      "descricao": "string",
      "relevancia": "alta | critica",
      "fonte_peca": "string"
    }
  ],
  "falhas_e_oportunidades": {
    "vantagem_do_cliente": [
      {
        "tipo": "nulidade | preclusao | cerceamento_defesa | sentenca_viciada | prescricao | decadencia | abusividade | outro",
        "descricao": "string",
        "fundamento_legal": "string",
        "como_explorar": "string",
        "potencial": "alto | medio | baixo"
      }
    ],
    "risco_do_cliente": [
      {
        "tipo": "string",
        "descricao": "string",
        "fundamento_legal": "string",
        "como_mitigar": "string",
        "severidade": "critica | alta | media | baixa"
      }
    ]
  },
  "teses_juridicas": {
    "levantadas_pelo_cliente": [{"tese": "string", "fundamento": "string", "forca": "solida | razoavel | fragil"}],
    "nao_levantadas_mas_deveriam": [{"tese": "string", "fundamento": "string", "potencial": "alto | medio | baixo", "observacao": "string"}],
    "do_adversario_que_preocupam": [{"tese": "string", "fundamento": "string", "risco": "alto | medio | baixo"}]
  },
  "avaliacao_chances": {
    "perspectiva": "favoravel | desfavoravel | incerta | equilibrada",
    "percentual_estimado": "string (ex: 60-70% de êxito no recurso)",
    "justificativa": "string",
    "jurisprudencia_dominante": "string"
  },
  "nivel_risco_global": "baixo | medio | alto | critico",
  "exposicao_financeira": {
    "valor_principal": "string ou null",
    "total_estimado_com_acessorios": "string ou null"
  },
  "estrategia_recomendada": {
    "nome": "string",
    "descricao": "string",
    "acoes_concretas": ["string"],
    "pecas_a_protocolar": ["string"],
    "precedentes_a_citar": ["string"],
    "probabilidade_sucesso": "string"
  },
  "proximos_passos": [
    {
      "acao": "string",
      "urgencia": "critica | urgente | alta | normal",
      "prazo_legal": "string",
      "vencimento_estimado": "YYYY-MM-DD ou null",
      "consequencia_inacao": "string"
    }
  ],
  "alertas_criticos": ["string"],
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


# ── Dicas por tipo de peça para cronologia ─────────────────────────────────────

_DICAS_TIPO_PECA: dict[str, str] = {
    "sentenca": (
        "data de prolação da sentença, nome do juiz/juíza, dispositivo (procedente/improcedente/parcialmente "
        "procedente), valor da condenação se houver, data da publicação/intimação"
    ),
    "acordao": (
        "data do julgamento, órgão julgador (turma/câmara/seção), relator(a), resultado "
        "(provido/improvido/parcialmente provido/não conhecido), ementa resumida, data da publicação"
    ),
    "peticao_inicial": (
        "data do protocolo no sistema, nome do advogado subscritor, pedidos principais formulados, "
        "valor atribuído à causa, requerimento de liminar/tutela se houver"
    ),
    "contestacao": (
        "data do protocolo, advogado do réu, principais teses de defesa arguidas, "
        "preliminares processuais suscitadas, documentos relevantes juntados"
    ),
    "recurso": (
        "tipo exato de recurso (apelação / agravo de instrumento / agravo regimental / agravo interno / "
        "embargos de declaração / REsp / RE / agravo em REsp), data do protocolo/interposição, "
        "data do julgamento se houver, resultado do julgamento"
    ),
    "embargos_declaracao": (
        "data do protocolo, quem embargou (autor/réu), vício apontado (omissão/contradição/obscuridade), "
        "data do julgamento, resultado (acolhido/rejeitado), efeitos infringentes se houver"
    ),
    "agravo": (
        "tipo de agravo, data de interposição, decisão agravada, data do julgamento, resultado"
    ),
    "decisao_interlocutoria": (
        "data da decisão, conteúdo (tutela deferida/indeferida, prova deferida/indeferida, "
        "saneamento, audiência designada), prazo concedido às partes, nome do juiz"
    ),
    "despacho": (
        "data, conteúdo do despacho, determinação ao escrivão/serventuário, prazo dado"
    ),
    "citacao": (
        "data em que foi realizada (certificada pelo oficial), modo (pessoal / carta com AR / "
        "edital / eletrônica), nome do citado, data da juntada do mandado/aviso"
    ),
    "intimacao": (
        "data, conteúdo da intimação, prazo concedido, meio (DJe / pessoal / eletrônico)"
    ),
    "audiencia": (
        "data e hora de realização, partes presentes (e ausentes com ou sem justificativa), "
        "resultado (acordo / instrução / tentativa frustrada), determinações ao final, "
        "depoimentos colhidos"
    ),
    "pericia": (
        "data de nomeação do perito, data de apresentação do laudo, conclusão do perito, "
        "impugnações das partes"
    ),
    "cumprimento_sentenca": (
        "data do início, valor apresentado, data da penhora/arresto se houver, "
        "atos de constrição patrimonial, impugnação ao cumprimento"
    ),
    "peticao": (
        "data do protocolo, conteúdo do pedido formulado, resultado/decisão sobre o pedido"
    ),
    "outro": (
        "qualquer ato processual identificável com data no formato DD/MM/AAAA ou por extenso, "
        "quem praticou e qual o resultado"
    ),
}

_INSTRUCAO_EXTRACAO_PECA = """\
Você está analisando UMA PEÇA PROCESSUAL de um processo judicial brasileiro.

IDENTIFICAÇÃO DA PEÇA:
- Tipo: {tipo_peca_label}
- Localização: {pags}
- Peça {idx_peca} de {total_pecas} do processo

TAREFA: Extraia TODOS os atos e marcos processuais presentes NESTA PEÇA.

Para este tipo de peça, preste especial atenção em:
{dicas}

⚠ REGRAS ANTI-CONTAMINAÇÃO DE DATAS (crítico):
- Extraia SOMENTE datas de atos praticados NESTE processo
- IGNORE: datas de jurisprudência citada, anos de leis ("art. X da Lei 8.078/1990"), \
contratos anteriores usados como prova, certidões de outros processos, datas de nascimento
- Datas válidas estão no formato DD/MM/AAAA, "em X de [mês] de [ano]", "aos X dias do mês de Y"
- Um ato é válido apenas se estiver claramente vinculado a algo que ocorreu NESTE processo

Responda SOMENTE com JSON válido, sem texto adicional:
{{
  "eventos": [
    {{
      "data": "YYYY-MM-DD ou null",
      "data_aproximada": false,
      "tipo": "protocolo_inicial | despacho | citacao | contestacao | replica | audiencia | pericia | decisao_interlocutoria | sentenca | acordao | recurso | contrarrazoes | publicacao | intimacao | cumprimento | outro",
      "descricao": "descrição completa: quem praticou, o que ocorreu, qual resultado",
      "relevancia": "baixa | media | alta | critica",
      "fonte_peca": "{tipo_peca_label} — {pags}"
    }}
  ]
}}

Se não há atos processuais identificáveis, retorne {{"eventos": []}}.\
"""


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


# ── Cronologia por peça (piece-anchored) ─────────────────────────────────────

def _extrair_eventos_peca_sync(
    peca: dict,
    idx: int,
    total: int,
    client: anthropic.Anthropic,
    use_premium: bool,
) -> list[dict]:
    """
    Extrai eventos cronológicos de UMA peça com contexto do tipo da peça.
    Usa Sonnet para peças importantes, Haiku para as demais.
    """
    texto     = peca.get("conteudo_texto") or ""
    tipo_peca = peca.get("tipo_peca", "outro")
    pags      = f"pág. {peca.get('pagina_inicio')}-{peca.get('pagina_fim')}"
    dicas     = _DICAS_TIPO_PECA.get(tipo_peca, _DICAS_TIPO_PECA["outro"])
    model     = settings.llm_model if use_premium else "claude-haiku-4-5-20251001"

    instrucao = _INSTRUCAO_EXTRACAO_PECA.format(
        tipo_peca_label=tipo_peca.replace("_", " ").title(),
        pags=pags,
        idx_peca=idx,
        total_pecas=total,
        dicas=dicas,
    )

    # Se a peça for muito grande, trunca (extração da parte inicial, que normalmente tem
    # o cabeçalho com data) + parte final (que tem dispositivo/assinatura)
    max_chars = PECA_MAX_TOKENS * 4  # aprox 4 chars por token
    if len(texto) > max_chars:
        metade = max_chars // 2
        texto_enviado = texto[:metade] + "\n\n[... TEXTO TRUNCADO ...]\n\n" + texto[-metade:]
    else:
        texto_enviado = texto

    try:
        msg = client.messages.create(
            model=model,
            max_tokens=2048,
            system=SYSTEM_BASE,
            messages=[{
                "role": "user",
                "content": f"{instrucao}\n\nTEXTO DA PEÇA:\n\n{texto_enviado}",
            }],
        )
        raw = msg.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
        data = json.loads(raw)
        evs = data.get("eventos", [])
        return evs
    except Exception as e:
        logger.warning(f"  Peça {idx}/{total} ({tipo_peca}, {pags}) falhou: {e}")
        return []


async def _cronologia_por_peca(
    pecas: list[dict],
    client: anthropic.Anthropic,
) -> list[dict]:
    """
    Estratégia piece-anchored PARALELA para cronologia:
    - Processa todas as peças em paralelo (semáforo de 5 chamadas simultâneas)
    - Usa Sonnet para peças prioritárias, Haiku para secundárias
    - Deduplicação precisa baseada em data+tipo+descricao
    """
    import asyncio

    pecas_com_texto = [p for p in pecas if (p.get("conteudo_texto") or "").strip()]
    if not pecas_com_texto:
        return []

    total = len(pecas_com_texto)
    logger.info(f"Cronologia piece-anchored PARALELA: {total} peças com texto")

    sem  = asyncio.Semaphore(5)   # máx 5 chamadas simultâneas à API
    loop = asyncio.get_event_loop()

    async def processar_uma(idx: int, peca: dict) -> list[dict]:
        tipo_peca   = peca.get("tipo_peca", "outro")
        use_premium = tipo_peca in PECAS_PREMIUM
        model_label = "Sonnet" if use_premium else "Haiku"
        pags        = f"pág. {peca.get('pagina_inicio')}-{peca.get('pagina_fim')}"
        logger.info(f"  [{idx}/{total}] {tipo_peca} ({pags}) → {model_label}")
        async with sem:
            evs = await loop.run_in_executor(
                None,
                functools.partial(_extrair_eventos_peca_sync, peca, idx, total, client, use_premium),
            )
        logger.info(f"    [{idx}/{total}] → {len(evs)} eventos")
        return evs

    tarefas    = [processar_uma(idx, peca) for idx, peca in enumerate(pecas_com_texto, start=1)]
    resultados = await asyncio.gather(*tarefas, return_exceptions=True)

    todos_eventos: list[dict] = []
    for r in resultados:
        if isinstance(r, Exception):
            logger.warning(f"Peça falhou na extração de cronologia: {r}")
        else:
            todos_eventos.extend(r)

    # Deduplicação: mesma data + tipo + início da descrição (80 chars)
    seen: set[tuple] = set()
    dedup: list[dict] = []
    for ev in todos_eventos:
        chave = (
            ev.get("data") or "",
            ev.get("tipo") or "",
            (ev.get("descricao") or "")[:80].lower().strip(),
        )
        if chave not in seen:
            seen.add(chave)
            dedup.append(ev)

    logger.info(f"Cronologia: {len(todos_eventos)} eventos → {len(dedup)} após dedup")
    return dedup


# ── Descrição fiel por peça ───────────────────────────────────────────────────

def _descrever_peca_sync(
    peca: dict,
    idx: int,
    total: int,
    client: anthropic.Anthropic,
) -> dict:
    """
    Descreve UMA peça processual de forma fiel usando Haiku.
    Retorna um dict conforme o schema de descricao_documentos.
    """
    texto     = peca.get("conteudo_texto") or ""
    tipo_peca = peca.get("tipo_peca", "outro")
    pags      = f"pág. {peca.get('pagina_inicio')}-{peca.get('pagina_fim')}"

    # Para peças muito grandes: mantém início (cabeçalho/qualificação) + fim (dispositivo/assinatura)
    max_chars = 120_000
    if len(texto) > max_chars:
        metade = max_chars // 2
        texto = texto[:metade] + "\n\n[... trecho central omitido por tamanho ...]\n\n" + texto[-metade:]

    prompt = f"""Descreva fielmente esta peça processual ({tipo_peca.replace('_', ' ').upper()}, {pags}).

Para sentenças/acórdãos/decisões: TRANSCREVA O DISPOSITIVO LITERALMENTE.
Para petições: LISTE TODOS OS PEDIDOS na ordem em que aparecem.

TEXTO DA PEÇA:
{texto}

Responda SOMENTE com JSON válido (sem markdown):
{{
  "tipo_peca": "{tipo_peca}",
  "paginas": "{pags}",
  "data_documento": "YYYY-MM-DD ou null",
  "data_aproximada": false,
  "autor": "quem assinou ou null",
  "destinatario": "a quem se dirige ou null",
  "orgao_juizo": "vara/câmara/tribunal ou null",
  "descricao_fiel": "descrição objetiva e fiel — mínimo 80 palavras",
  "transcricao_dispositivo": "dispositivo literal se for decisão/sentença/acórdão, ou null",
  "pedidos": [],
  "fundamentos_legais_citados": [],
  "valores_mencionados": [],
  "partes_mencionadas": [],
  "funcao_processual": "qual o papel desta peça no processo",
  "relevancia_documental": "essencial | alta | media | baixa"
}}"""

    try:
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=2_500,
            system=SYSTEM_BASE,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = msg.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
        return json.loads(raw)
    except Exception as e:
        logger.warning(f"  Peça {idx}/{total} ({tipo_peca}) falhou na descrição: {e}")
        return {
            "tipo_peca":             tipo_peca,
            "paginas":               pags,
            "data_documento":        None,
            "data_aproximada":       False,
            "autor":                 None,
            "destinatario":          None,
            "orgao_juizo":           None,
            "descricao_fiel":        "(falha na extração automática)",
            "transcricao_dispositivo": None,
            "pedidos":               [],
            "fundamentos_legais_citados": [],
            "valores_mencionados":   [],
            "partes_mencionadas":    [],
            "funcao_processual":     tipo_peca.replace("_", " "),
            "relevancia_documental": "media",
        }


async def _descricao_por_peca(
    pecas: list[dict],
    client: anthropic.Anthropic,
) -> list[dict]:
    """
    Descreve todas as peças em PARALELO (semáforo de 5 simultâneas).
    """
    import asyncio

    pecas_com_texto = [p for p in pecas if (p.get("conteudo_texto") or "").strip()]
    if not pecas_com_texto:
        return []

    total = len(pecas_com_texto)
    logger.info(f"Descrição de documentos PARALELA: {total} peças")

    sem  = asyncio.Semaphore(5)
    loop = asyncio.get_event_loop()

    async def descrever_uma(idx: int, peca: dict) -> dict:
        async with sem:
            return await loop.run_in_executor(
                None,
                functools.partial(_descrever_peca_sync, peca, idx, total, client),
            )

    tarefas    = [descrever_uma(idx, peca) for idx, peca in enumerate(pecas_com_texto, start=1)]
    resultados = await asyncio.gather(*tarefas, return_exceptions=True)

    docs: list[dict] = []
    for r in resultados:
        if isinstance(r, Exception):
            logger.warning(f"Peça falhou na descrição: {r}")
        else:
            docs.append(r)

    logger.info(f"Descrição concluída: {len(docs)} peças descritas")
    return docs


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

    # ── Auto-detecção do tipo de causa para system prompt especializado ───────
    tipo_causa_detectado: Optional[str] = None
    try:
        analises_prev = await sb_run(
            lambda: sb.table("analises")
            .select("conteudo_json")
            .eq("processo_id", str(processo_id))
            .in_("tipo", ["estado_atual", "diagnostico_completo", "resumo_executivo"])
            .order("created_at", desc=True)
            .limit(3)
            .execute()
        )
        for a in (analises_prev.data or []):
            cj = a.get("conteudo_json") or {}
            tc = cj.get("tipo_causa")
            if tc:
                tipo_causa_detectado = tc
                break
    except Exception:
        pass

    system_prompt = _get_system(tipo_causa_detectado)
    if tipo_causa_detectado:
        logger.info(f"Sistema especializado: {tipo_causa_detectado}")

    # ── Estratégia de contexto ────────────────────────────────────────────────
    conteudo_json: dict = {}
    tokens_input  = 0
    tokens_output = 0
    estrategia    = "desconhecida"

    if tipo == "descricao_documentos":
        # Processa cada peça individualmente com Haiku para máxima fidelidade
        logger.info("Descrição de documentos: processamento peça a peça")
        docs = await _descricao_por_peca(pecas, client)
        estrategia = "piece_by_piece"
        conteudo_json = {
            "documentos":          docs,
            "total_pecas_descritas": len(docs),
            "observacoes_gerais":  None,
            "confianca":           0.88 if docs else 0.3,
        }

    elif tipo == "cronologia":
        # Sempre usa piece-anchored — mais preciso independente do tamanho
        logger.info("Cronologia: usando estratégia piece-anchored")
        eventos = await _cronologia_por_peca(pecas, client)
        estrategia = "piece_anchored"

        # Consolidação final: ordena, valida lógica processual e enriquece
        n_eventos = len(eventos)
        if n_eventos == 0:
            conteudo_json = {
                "eventos": [],
                "inconsistencias": ["Nenhum ato processual identificado nas peças"],
                "periodo_total": {"inicio": None, "fim": None, "duracao_aproximada": "desconhecida"},
                "confianca": 0.3,
            }
        else:
            resumo_bruto = json.dumps({"eventos": eventos}, ensure_ascii=False, indent=2)
            consolidar_prompt = (
                f"Abaixo estão {n_eventos} atos processuais extraídos peça a peça de um processo judicial.\n\n"
                f"TAREFAS DE CONSOLIDAÇÃO:\n"
                f"1. Ordene os eventos cronologicamente (do mais antigo para o mais recente)\n"
                f"2. Aplique as regras de lógica processual (inicial ANTES de citação ANTES de contestação "
                f"ANTES de sentença ANTES de recursos)\n"
                f"3. Descarte eventos que violem a lógica (ex: recurso anterior à decisão) e registre "
                f"em 'inconsistencias'\n"
                f"4. Elimine duplicatas remanescentes\n"
                f"5. Eleve a relevância de: sentença, acórdão, interposição de recursos, citação, "
                f"decisões de tutela para 'critica' ou 'alta'\n"
                f"6. Calcule o período total do processo\n\n"
                f"EVENTOS BRUTOS:\n{resumo_bruto}\n\n"
                f"TAREFA FINAL:\n{cfg['instrucao']}"
            )
            msg_final = await _claude_async(
                client,
                model=settings.llm_model,
                max_tokens=8192,
                system=system_prompt,
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
                conteudo_json = {
                    "eventos": eventos,
                    "inconsistencias": [],
                    "periodo_total": {"inicio": None, "fim": None, "duracao_aproximada": "desconhecida"},
                    "confianca": 0.65,
                }

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
            system=system_prompt,
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
                "fonte":          ev.get("fonte_peca") or "ia",
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


# ── Streaming de análise (SSE) ────────────────────────────────────────────────

_PASSOS_STREAM: dict[str, list[tuple[str, int]]] = {
    "descricao_documentos": [
        ("Carregando peças do processo…",            5),
        ("Descrevendo petições e manifestações…",   18),
        ("Descrevendo despachos e decisões…",       35),
        ("Descrevendo sentenças e acórdãos…",       55),
        ("Descrevendo recursos e contrarrazões…",   72),
        ("Descrevendo demais documentos…",          86),
        ("Consolidando descrições…",                93),
    ],
    "cronologia": [
        ("Carregando peças do processo…",          5),
        ("Extraindo atos da petição inicial…",     12),
        ("Processando despachos e decisões…",      25),
        ("Analisando recursos e acórdãos…",        40),
        ("Processando sentenças e acordos…",       55),
        ("Identificando embargos e agravos…",      68),
        ("Consolidando ordem cronológica…",         80),
        ("Validando lógica processual…",           88),
        ("Salvando eventos…",                      93),
    ],
    "diagnostico_completo": [
        ("Carregando peças do processo…",          5),
        ("Montando contexto do processo…",         15),
        ("Identificando partes e fase processual…", 28),
        ("Detectando falhas e oportunidades…",     42),
        ("Mapeando teses jurídicas…",              56),
        ("Avaliando riscos e estratégias…",        70),
        ("Elaborando plano de ação…",              83),
        ("Finalizando análise…",                   90),
    ],
    "estado_atual": [
        ("Carregando peças…",                      10),
        ("Identificando fase processual…",         30),
        ("Mapeando partes e pedidos…",             55),
        ("Calculando prazos…",                     75),
        ("Salvando…",                              90),
    ],
    "resumo_executivo": [
        ("Carregando peças…",                      10),
        ("Analisando fatos determinantes…",        35),
        ("Avaliando chances de êxito…",            60),
        ("Elaborando ações prioritárias…",         80),
        ("Salvando…",                              90),
    ],
    "riscos": [
        ("Carregando peças…",                      10),
        ("Identificando riscos processuais…",      32),
        ("Avaliando riscos materiais…",            55),
        ("Calculando exposição financeira…",       75),
        ("Salvando…",                              90),
    ],
    "teses": [
        ("Carregando peças…",                      10),
        ("Mapeando teses do autor…",               30),
        ("Mapeando teses do réu…",                 50),
        ("Identificando teses não levantadas…",    72),
        ("Salvando…",                              90),
    ],
    "proximos_passos": [
        ("Carregando peças…",                      10),
        ("Identificando ações necessárias…",       35),
        ("Calculando prazos legais…",              60),
        ("Avaliando oportunidade de acordo…",      80),
        ("Salvando…",                              90),
    ],
    "estrategia": [
        ("Carregando peças…",                      10),
        ("Avaliando posição do cliente…",          28),
        ("Elaborando estratégias alternativas…",   50),
        ("Definindo recomendação principal…",      72),
        ("Salvando…",                              90),
    ],
}

_PASSOS_DEFAULT = [
    ("Carregando peças…",          10),
    ("Montando contexto…",         30),
    ("Gerando análise com IA…",    55),
    ("Processando resposta…",      78),
    ("Salvando…",                  90),
]


async def gerar_analise_stream(
    processo_id: uuid.UUID,
    tipo: str,
    usuario_id: Optional[uuid.UUID] = None,
    contexto_extra: Optional[str] = None,
    documento_ids: Optional[list[uuid.UUID]] = None,
):
    """
    Async generator — roda gerar_analise() em paralelo e emite eventos de progresso.

    Yield dicts:
      {"type": "progress", "msg": str, "pct": int}
      {"type": "done",     "pct": 100, "analise": dict}
      {"type": "error",    "msg": str}
    """
    import asyncio

    passos = _PASSOS_STREAM.get(tipo, _PASSOS_DEFAULT)
    intervalo_seg = 6  # segundos entre atualizações de passo

    # Inicia a análise como tarefa concorrente
    loop = asyncio.get_event_loop()
    task = loop.create_task(
        gerar_analise(
            processo_id, tipo,
            usuario_id=usuario_id,
            contexto_extra=contexto_extra,
            documento_ids=documento_ids,
        )
    )

    passo_idx = 0
    while not task.done():
        if passo_idx < len(passos):
            msg, pct = passos[passo_idx]
        else:
            # Mantém no último passo até terminar
            msg, pct = passos[-1]
        yield {"type": "progress", "msg": msg, "pct": pct}
        passo_idx += 1

        # Espera o intervalo (1 s por ciclo para checar se a task terminou)
        for _ in range(intervalo_seg):
            if task.done():
                break
            await asyncio.sleep(1)

    exc = task.exception()
    if exc:
        yield {"type": "error", "msg": str(exc)}
    else:
        analise = task.result()
        yield {"type": "done", "pct": 100, "analise": analise}


# ── Chat (versão rápida) ───────────────────────────────────────────────────────
#
# Estratégia: contexto inteligente truncado → Haiku → resposta em segundos.
# Evita re-sumarizar tudo a cada mensagem (era a causa dos 3+ minutos).
#
# Prioridade de tokens:
#   1. Peças críticas (sentença, acórdão, inicial, contestação): até 12 K tok cada
#   2. Demais peças: até 1,5 K tok cada (head + tail para não perder assinatura)
# Limite total: 80 K tokens de contexto.

MAX_CHAT_CONTEXT  = 80_000
CHAT_PECA_PREMIUM = 12_000
CHAT_PECA_NORMAL  = 1_500


def _montar_contexto_chat(pecas: list[dict]) -> str:
    """
    Contexto compacto para chat — sem chamadas externas, sem sumarização.
    Peças importantes: texto até CHAT_PECA_PREMIUM tokens.
    Demais: head + tail truncados.
    """
    tokens_usados = 0
    partes: list[str] = []

    ordenadas = sorted(
        pecas,
        key=lambda p: (0 if p.get("tipo_peca") in PECAS_PRIORITARIAS else 1, p.get("pagina_inicio", 0))
    )

    for p in ordenadas:
        if tokens_usados >= MAX_CHAT_CONTEXT:
            break
        tipo  = p.get("tipo_peca", "outro").upper()
        pags  = f"pag. {p.get('pagina_inicio')}-{p.get('pagina_fim')}"
        texto = (p.get("conteudo_texto") or "").strip()
        if not texto:
            continue
        limite    = CHAT_PECA_PREMIUM if p.get("tipo_peca") in PECAS_PRIORITARIAS else CHAT_PECA_NORMAL
        disponivel = MAX_CHAT_CONTEXT - tokens_usados
        limite    = min(limite, disponivel)
        enc_texto = _enc.encode(texto)
        if len(enc_texto) <= limite:
            trecho = texto
        else:
            metade = limite // 2
            inicio = _enc.decode(enc_texto[:metade])
            fim    = _enc.decode(enc_texto[-metade:])
            trecho = inicio + "\n[... trecho omitido ...]\n" + fim
        partes.append(f"=== {tipo} ({pags}) ===\n{trecho}")
        tokens_usados += _contar_tokens(trecho)

    logger.info(f"Chat contexto: {tokens_usados:,} tokens, {len(partes)} pecas")
    return "\n\n".join(partes)


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

    # Contexto compacto — sem chamadas de API externas, imediato
    contexto = _montar_contexto_chat(pecas)

    system_chat = (
        SYSTEM_BASE
        + "\n\nCONTEXTO DO PROCESSO (trechos extensos foram truncados — peca detalhes se necessario):\n\n"
        + contexto
    )

    ultima = mensagens[-1]["content"] if mensagens else ""

    # Haiku: 5-10x mais rapido que Sonnet para Q&A sobre contexto fixo
    msg = await _claude_async(
        client,
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        system=system_chat,
        messages=[{"role": "user", "content": ultima}],
    )

    fontes = [
        {"tipo_peca": p.get("tipo_peca"), "paginas": f"{p.get('pagina_inicio')}-{p.get('pagina_fim')}"}
        for p in pecas[:20]
    ]
    tokens = msg.usage.input_tokens + msg.usage.output_tokens
    return msg.content[0].text.strip(), fontes, tokens
