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
    "sentenca",
    "acordao",
    "despacho",
    "decisao_interlocutoria",
    "recurso",
    "contrarrazoes",
    "certidao",
    "publicacao",
    "laudo_pericial",
    "procuracao",
    "contrato",
    "outros",
]

# Palavras-chave por tipo (ordem importa: mais específico primeiro)
_REGRAS: list[tuple[str, list[str]]] = [
    ("sentenca",              ["sentença", "procedente", "improcedente", "julgo", "condeno", "absolvo"]),
    ("acordao",               ["acórdão", "acorda", "turma", "câmara", "relator", "ementa"]),
    ("peticao_inicial",       ["petição inicial", "excelentíssimo", "vem respeitosamente", "requer a v. exa"]),
    ("contestacao",           ["contestação", "em contestação", "impugna", "defende-se"]),
    ("replica",               ["réplica", "em réplica", "impugna os documentos"]),
    ("recurso",               ["apelação", "agravo", "recurso especial", "recurso ordinário", "embargos de declaração"]),
    ("contrarrazoes",         ["contrarrazões", "contra-razões"]),
    ("decisao_interlocutoria",["decisão", "defiro", "indefiro", "determino"]),
    ("despacho",              ["despacho", "cumpra-se", "vista"]),
    ("certidao",              ["certidão", "certifico", "certificamos"]),
    ("publicacao",            ["diário da justiça", "djeo", "djen", "publicado em"]),
    ("laudo_pericial",        ["laudo pericial", "perícia", "perito"]),
    ("procuracao",            ["procuração", "outorgante", "outorgado", "mandato"]),
    ("contrato",              ["contrato", "cláusula", "objeto do presente"]),
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
