"""
Jurisprudência em tempo real — Fase 1.

Busca nas fontes oficiais (STJ, STF, TST) via Tavily API.
Se TAVILY_API_KEY não estiver configurada, retorna lista vazia sem erros.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

import httpx
from loguru import logger

from ..config import get_settings

settings = get_settings()

_DOMINIOS_OFICIAIS = [
    "jurisprudencia.stj.jus.br",
    "processo.stj.jus.br",
    "portal.stf.jus.br",
    "jurisprudencia.stf.jus.br",
    "jurisprudencia.tst.jus.br",
    "www.tst.jus.br",
]

_TRIBUNAL_POR_DOMINIO = {
    "stj": "STJ",
    "stf": "STF",
    "tst": "TST",
    "trf1": "TRF-1", "trf2": "TRF-2", "trf3": "TRF-3",
    "trf4": "TRF-4", "trf5": "TRF-5",
    "tjsp": "TJSP", "tjrj": "TJRJ", "tjmg": "TJMG",
}


def _utcnow_str() -> str:
    return datetime.now(timezone.utc).strftime("%d/%m/%Y")


def _identificar_tribunal(url: str) -> str:
    url_lower = url.lower()
    for chave, nome in _TRIBUNAL_POR_DOMINIO.items():
        if chave in url_lower:
            return nome
    return "Tribunal"


def _query_para_tese(tese: str, area: str) -> str:
    """Monta query otimizada para busca de jurisprudência."""
    area_map = {
        "trabalhista": "TST CLT trabalhista",
        "consumidor": "STJ CDC consumidor",
        "tributario": "STJ STF tributário fiscal",
        "criminal": "STJ STF criminal penal",
        "administrativo": "STJ STF administrativo",
        "civil": "STJ civil",
    }
    tribunal_hint = area_map.get(area.lower() if area else "", "STJ STF")
    return f"jurisprudência {tese} {tribunal_hint} ementa acórdão"


async def buscar_jurisprudencia(
    teses: list[str],
    area: str = "",
    max_por_tese: int = 3,
) -> list[dict]:
    """
    Busca jurisprudência atual para as teses identificadas no processo.

    Retorna lista de:
      {tese, tribunal, titulo, url, trecho, data_consulta}
    """
    if not settings.tavily_api_key:
        logger.info("TAVILY_API_KEY não configurada — jurisprudência em tempo real desativada")
        return []

    if not teses:
        return []

    # Limita a 3 teses para controlar custo (~R$0,15 por análise)
    teses_filtradas = [t for t in teses if t and len(t) > 10][:3]
    resultados: list[dict] = []

    async with httpx.AsyncClient(timeout=15.0) as client:
        for tese in teses_filtradas:
            query = _query_para_tese(tese, area)
            try:
                resp = await client.post(
                    "https://api.tavily.com/search",
                    json={
                        "api_key": settings.tavily_api_key,
                        "query": query,
                        "search_depth": "basic",
                        "include_domains": _DOMINIOS_OFICIAIS,
                        "max_results": max_por_tese,
                        "include_answer": False,
                        "include_raw_content": False,
                    },
                )
                resp.raise_for_status()
                data = resp.json()

                for r in data.get("results", []):
                    url = r.get("url", "")
                    conteudo = (r.get("content") or "").strip()
                    if len(conteudo) < 80:
                        continue  # resultado muito raso, ignora

                    resultados.append({
                        "tese_relacionada": tese[:120],
                        "tribunal": _identificar_tribunal(url),
                        "titulo": (r.get("title") or "").strip()[:200],
                        "url": url,
                        "trecho": conteudo[:900],
                        "data_consulta": _utcnow_str(),
                    })

            except httpx.HTTPStatusError as e:
                logger.warning(f"Tavily HTTP {e.response.status_code} para tese '{tese[:40]}...'")
            except Exception as e:
                logger.warning(f"Tavily falhou para tese '{tese[:40]}...': {e}")

    logger.info(f"Jurisprudência: {len(resultados)} resultados para {len(teses_filtradas)} teses")
    return resultados


def formatar_para_prompt(resultados: list[dict]) -> str:
    """
    Formata os resultados Tavily para injeção no prompt de análise.
    Inclui instrução clara de que são extraídos de fontes externas.
    """
    if not resultados:
        return ""

    data_hoje = _utcnow_str()
    linhas = [
        f"\n\n## JURISPRUDÊNCIA CONSULTADA EM TEMPO REAL ({data_hoje})",
        "ATENÇÃO: os trechos abaixo foram buscados agora nas fontes oficiais.",
        "Use SOMENTE o que está transcrito aqui. Não extrapole além destes trechos.",
        "Não invente números de processo ou ementas que não estejam reproduzidos abaixo.\n",
    ]

    tribunal_atual = ""
    for r in resultados:
        if r["tribunal"] != tribunal_atual:
            tribunal_atual = r["tribunal"]
            linhas.append(f"### {tribunal_atual}")

        linhas.append(
            f"**Tese**: {r['tese_relacionada']}\n"
            f"**Fonte**: {r['titulo']}\n"
            f"**URL**: {r['url']}\n"
            f"**Trecho**: {r['trecho']}\n"
        )

    return "\n".join(linhas)


def formatar_para_json(resultados: list[dict]) -> list[dict]:
    """Formata para inclusão no campo jurisprudencia_pesquisada do JSON de saída."""
    return [
        {
            "tribunal": r["tribunal"],
            "titulo": r["titulo"],
            "url": r["url"],
            "trecho": r["trecho"],
            "tese_relacionada": r["tese_relacionada"],
            "data_consulta": r["data_consulta"],
            "aviso": "Resultado de busca automática. Verificar integridade antes de citar.",
        }
        for r in resultados
    ]
