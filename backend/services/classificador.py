"""
Classificação automática de peças processuais.
Usa heurísticas rápidas (keywords) + Claude para casos ambíguos.
"""

import re
from dataclasses import dataclass
from typing import Optional
import anthropic
from loguru import logger
from ..config import get_settings

settings = get_settings()

TIPOS_PECA = [
    "peticao_inicial",
    "contestacao",
    "replica",
    "impugnacao",
    "alegacoes_finais",
    "sentenca",
    "acordao",
    "despacho",
    "decisao_interlocutoria",
    "recurso",
    "contrarrazoes",
    "embargos_declaracao",
    "agravo",
    "mandado",
    "oficio",
    "certidao",
    "publicacao",
    "ata_audiencia",
    "laudo_pericial",
    "procuracao",
    "contrato",
    "guia_recolhimento",
    "edital",
    "notificacao",
    "outros",
]

# Palavras-chave por tipo (mais específico primeiro; 2 hits = alta confiança)
_REGRAS: list[tuple[str, list[str]]] = [
    # ── Decisões finais ──────────────────────────────────────────────────────
    ("sentenca",               ["sentença", "julgo procedente", "julgo improcedente",
                                "julgo parcialmente", "condeno o réu", "absolvo o réu",
                                "extingo o processo", "dispositivo"]),
    ("acordao",                ["acórdão", "acordam", "turma julgadora", "câmara cível",
                                "câmara criminal", "relator", "ementa:", "vistos, relatados"]),

    # ── Atos de comunicação ──────────────────────────────────────────────────
    ("mandado",                ["mandado de citação", "mandado de intimação", "mandado de penhora",
                                "oficial de justiça", "mandado de busca", "cumpra-se o mandado"]),
    ("oficio",                 ["ofício nº", "ofício circular", "solicitamos a v. sa.",
                                "encaminhamos a v. sa.", "por determinação"]),
    ("edital",                 ["edital de citação", "edital de intimação", "edital de leilão",
                                "ficam os interessados", "prazo de", "faz saber"]),
    ("notificacao",            ["notificação extrajudicial", "fica v. sa. notificado",
                                "notificamos", "notifica-se"]),

    # ── Recursos ─────────────────────────────────────────────────────────────
    ("embargos_declaracao",    ["embargos de declaração", "embargante", "omissão",
                                "contradição", "obscuridade", "efeitos infringentes"]),
    ("agravo",                 ["agravo de instrumento", "agravo interno", "agravo regimental",
                                "agravo em resp", "agrava-se", "decisão agravada"]),
    ("recurso",                ["apelação", "apelante", "recurso especial", "recurso ordinário",
                                "resp", "recurso adesivo", "contrarrazões de apelação"]),
    ("contrarrazoes",          ["contrarrazões", "contra-razões", "apelado", "recorrido"]),

    # ── Petições ─────────────────────────────────────────────────────────────
    ("peticao_inicial",        ["petição inicial", "excelentíssimo senhor", "douto juiz",
                                "vem, respeitosamente", "requer a v. exa", "da causa o valor"]),
    ("contestacao",            ["contestação", "em contestação", "preliminarmente",
                                "impugna", "requer a improcedência"]),
    ("replica",                ["réplica", "em réplica", "impugna os documentos",
                                "mantém o quanto exposto"]),
    ("impugnacao",             ["impugnação ao cumprimento", "impugna a execução",
                                "excesso de execução", "impugna os cálculos"]),
    ("alegacoes_finais",       ["alegações finais", "memorial de alegações",
                                "memoriais", "razões finais"]),

    # ── Atos instrutórios ────────────────────────────────────────────────────
    ("ata_audiencia",          ["ata de audiência", "audiência de conciliação",
                                "audiência de instrução", "presentes as partes",
                                "o juiz presidente", "encerrada a audiência"]),
    ("laudo_pericial",         ["laudo pericial", "laudo de perícia", "perito nomeado",
                                "conclusão pericial", "quesitos respondidos"]),

    # ── Despachos e decisões interlocutórias ─────────────────────────────────
    ("decisao_interlocutoria", ["defiro o pedido", "indefiro o pedido", "defiro a tutela",
                                "determino", "intime-se", "cite-se", "fica deferido"]),
    ("despacho",               ["despacho", "cumpra-se", "vista ao ministério público",
                                "conclusos", "ao contador"]),

    # ── Documentos cartorários ────────────────────────────────────────────────
    ("certidao",               ["certidão", "certifico", "certificamos", "certifico que",
                                "nada consta", "certidão negativa"]),
    ("publicacao",             ["diário da justiça", "djeo", "djen", "dje-", "publicado em",
                                "diário oficial", "intimação via dje"]),

    # ── Documentos extrajudiciais ─────────────────────────────────────────────
    ("procuracao",             ["procuração", "outorgante", "outorgado",
                                "poderes para", "constituir advogado"]),
    ("contrato",               ["contrato de", "cláusula", "objeto do presente contrato",
                                "obrigações das partes", "foro competente"]),
    ("guia_recolhimento",      ["guia de recolhimento", "guia de custas", "dare",
                                "gru", "darf", "comprovante de pagamento de custas"]),
]


@dataclass
class ResultadoClassificacao:
    tipo_peca:  str
    confianca:  float
    metodo:     str   # "heuristica" | "ia"


def classificar_por_heuristica(texto: str) -> Optional[ResultadoClassificacao]:
    texto_lower = texto[:3000].lower()
    for tipo, keywords in _REGRAS:
        hits = sum(1 for kw in keywords if kw in texto_lower)
        if hits >= 2:
            confianca = min(0.5 + hits * 0.1, 0.9)
            return ResultadoClassificacao(tipo, confianca, "heuristica")
        if hits == 1:
            return ResultadoClassificacao(tipo, 0.5, "heuristica")
    return None


def classificar_por_ia(texto: str) -> ResultadoClassificacao:
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    tipos_str = ", ".join(TIPOS_PECA)
    prompt = (
        f"Classifique esta peça processual jurídica brasileira.\n"
        f"Tipos possíveis: {tipos_str}\n\n"
        f"Texto (primeiros 2000 chars):\n{texto[:2000]}\n\n"
        f"Responda APENAS com o tipo exato da lista e uma pontuação de confiança de 0 a 1, "
        f"separados por vírgula. Exemplo: sentenca,0.95"
    )
    try:
        msg = client.messages.create(
            model=settings.llm_model,
            max_tokens=32,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = msg.content[0].text.strip().lower()
        parts = raw.split(",")
        tipo = parts[0].strip()
        confianca = float(parts[1].strip()) if len(parts) > 1 else 0.7
        if tipo not in TIPOS_PECA:
            tipo = "outros"
        return ResultadoClassificacao(tipo, confianca, "ia")
    except Exception as e:
        logger.warning(f"Classificação IA falhou: {e}")
        return ResultadoClassificacao("outros", 0.3, "ia")


def classificar_peca(texto: str) -> ResultadoClassificacao:
    resultado = classificar_por_heuristica(texto)
    if resultado and resultado.confianca >= 0.7:
        return resultado
    # fallback para IA quando heurística é incerta
    return classificar_por_ia(texto)
