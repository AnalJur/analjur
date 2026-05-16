"""
analise.py — Análise jurídica com Claude API

Usa RAG: recupera chunks relevantes e envia ao Claude para análise estruturada.
Suporta múltiplos tipos de análise com prompts especializados.
"""

import os
import json
from typing import Optional
from loguru import logger
import anthropic
from dotenv import load_dotenv

from embeddings import gerar_embedding_query
from database import buscar_chunks_similares

load_dotenv()

MODEL = "claude-sonnet-4-20250514"
MAX_TOKENS = 4096


def get_client() -> anthropic.Anthropic:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY não definida no .env")
    return anthropic.Anthropic(api_key=api_key)


# ---------------------------------------------------------------------------
# Prompts especializados
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """Você é um assistente jurídico especializado em análise de processos judiciais brasileiros.
Analisa documentos processuais com precisão técnica e objetividade.
Sempre fundamenta suas análises em fatos documentais, dispositivos legais e jurisprudência aplicável.
Responde EXCLUSIVAMENTE em JSON válido, sem markdown, sem texto fora do JSON."""

PROMPTS = {
    "analise_completa": """Analise os trechos processuais abaixo e retorne um JSON com esta estrutura exata:

{
  "tese_principal": {
    "autor": "tese principal da parte autora em 2-3 frases",
    "reu": "tese principal da parte ré em 2-3 frases"
  },
  "pontos_frageis": [
    {"parte": "autor|reu|ambos", "descricao": "...", "fundamento": "..."}
  ],
  "contradicoes": [
    {"descricao": "...", "trecho_a": "...", "trecho_b": "..."}
  ],
  "jurisprudencia_aplicavel": [
    {"tribunal": "...", "tema": "...", "aplicacao": "favoravel_autor|favoravel_reu|neutro"}
  ],
  "lacunas_tecnicas": ["..."],
  "cronologia": [
    {"data": "...", "evento": "...", "relevancia": "alta|media|baixa"}
  ],
  "riscos_juridicos": [
    {"parte": "autor|reu", "risco": "...", "probabilidade": "alta|media|baixa"}
  ],
  "prognostico": "análise objetiva das chances de cada parte em 3-5 frases"
}

TRECHOS DO PROCESSO:
{contexto}

INSTRUÇÃO ADICIONAL: {instrucao}""",

    "teses": """Analise os trechos e identifique as teses jurídicas das partes:

{
  "autor": {
    "tese_principal": "...",
    "fundamentos_legais": ["art. X do Y", "..."],
    "pontos_fortes": ["..."],
    "pontos_frageis": ["..."]
  },
  "reu": {
    "tese_principal": "...",
    "fundamentos_legais": ["..."],
    "pontos_fortes": ["..."],
    "pontos_frageis": ["..."]
  }
}

TRECHOS:
{contexto}""",

    "cronologia": """Extraia e ordene cronologicamente todos os eventos processuais:

{
  "cronologia": [
    {
      "data": "DD/MM/AAAA ou 'não identificada'",
      "evento": "descrição objetiva",
      "tipo": "petição|decisão|audiência|perícia|recurso|outro",
      "parte_responsavel": "autor|reu|juizo|perito|mp",
      "relevancia": "alta|media|baixa"
    }
  ],
  "periodo_total": "de X a Y",
  "fase_atual": "conhecimento|instrução|sentença|recurso"
}

TRECHOS:
{contexto}""",

    "riscos": """Avalie os riscos jurídicos para cada parte:

{
  "riscos_autor": [
    {"risco": "...", "probabilidade": "alta|media|baixa", "mitigacao": "..."}
  ],
  "riscos_reu": [
    {"risco": "...", "probabilidade": "alta|media|baixa", "mitigacao": "..."}
  ],
  "prognostico_geral": "...",
  "recomendacao_processual": "..."
}

TRECHOS:
{contexto}""",
}


# ---------------------------------------------------------------------------
# Pipeline de análise
# ---------------------------------------------------------------------------

def _montar_contexto(chunks: list[dict]) -> str:
    """Formata chunks recuperados como contexto para o prompt."""
    partes = []
    for i, chunk in enumerate(chunks, 1):
        header = (
            f"[TRECHO {i} | Peça: {chunk.get('tipo_peca', '?')} | "
            f"Páginas {chunk.get('pagina_inicio', '?')}-{chunk.get('pagina_fim', '?')} | "
            f"Autor: {chunk.get('autor', '?')}]"
        )
        partes.append(f"{header}\n{chunk.get('texto', '')}")
    return "\n\n---\n\n".join(partes)


def analisar(
    processo_id: str,
    query: str,
    tipo_analise: str = "analise_completa",
    top_k: int = 10,
    tipo_peca: Optional[str] = None,
) -> dict:
    """
    Pipeline completo de análise RAG:
    1. Gera embedding da query
    2. Recupera chunks relevantes
    3. Envia ao Claude para análise estruturada

    Args:
        processo_id: ID do processo a analisar
        query: Pergunta ou instrução de análise
        tipo_analise: Tipo de análise (analise_completa, teses, cronologia, riscos)
        top_k: Quantidade de chunks a recuperar
        tipo_peca: Filtrar por tipo de peça processual

    Returns:
        Dict com a análise estruturada
    """
    logger.info(f"Analisando processo {processo_id} | tipo: {tipo_analise}")

    # 1. Embedding da query
    try:
        embedding = gerar_embedding_query(query)
    except Exception as e:
        return {"erro": f"Falha ao gerar embedding: {e}"}

    # 2. Recuperar chunks relevantes
    chunks = buscar_chunks_similares(
        embedding_query=embedding,
        processo_id=processo_id,
        top_k=top_k,
        tipo_peca=tipo_peca,
    )

    if not chunks:
        return {"erro": "Nenhum trecho relevante encontrado para esta query."}

    logger.info(f"Chunks recuperados: {len(chunks)}")

    # 3. Montar prompt
    contexto = _montar_contexto(chunks)
    template = PROMPTS.get(tipo_analise, PROMPTS["analise_completa"])
    prompt = template.format(contexto=contexto, instrucao=query)

    # 4. Chamar Claude
    client = get_client()
    try:
        resposta = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        texto_resposta = resposta.content[0].text

        # 5. Parsear JSON
        try:
            return json.loads(texto_resposta)
        except json.JSONDecodeError:
            # Tentar extrair JSON do texto
            import re
            match = re.search(r"\{.*\}", texto_resposta, re.DOTALL)
            if match:
                return json.loads(match.group(0))
            return {"resposta_raw": texto_resposta, "erro_parse": "JSON inválido"}

    except Exception as e:
        logger.error(f"Erro na API Claude: {e}")
        return {"erro": str(e)}


def chat_processual(
    processo_id: str,
    mensagem: str,
    historico: list[dict] = None,
    top_k: int = 6,
) -> str:
    """
    Chat livre sobre o processo com contexto RAG.
    Retorna resposta em texto (não JSON).

    Args:
        processo_id: ID do processo
        mensagem: Pergunta do usuário
        historico: Lista de mensagens anteriores [{role, content}]
        top_k: Chunks a recuperar por mensagem
    """
    historico = historico or []

    # Recuperar contexto relevante
    try:
        embedding = gerar_embedding_query(mensagem)
        chunks = buscar_chunks_similares(embedding, processo_id, top_k=top_k)
        contexto = _montar_contexto(chunks) if chunks else "Nenhum trecho encontrado."
    except Exception as e:
        contexto = f"Erro ao recuperar contexto: {e}"

    system = f"""{SYSTEM_PROMPT}

Você está respondendo perguntas sobre o processo {processo_id}.
Baseie suas respostas APENAS nos trechos abaixo. Se a informação não estiver nos trechos, diga isso claramente.
Responda em português, de forma objetiva e técnica. NÃO use JSON, responda em texto corrido.

TRECHOS RELEVANTES DO PROCESSO:
{contexto}"""

    client = get_client()
    mensagens = historico + [{"role": "user", "content": mensagem}]

    try:
        resposta = client.messages.create(
            model=MODEL,
            max_tokens=2048,
            system=system,
            messages=mensagens,
        )
        return resposta.content[0].text
    except Exception as e:
        return f"Erro na análise: {e}"


# ---------------------------------------------------------------------------
# Teste
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Uso: python analise.py <processo_id>")
        sys.exit(1)

    pid = sys.argv[1]
    print(f"\nTestando análise do processo: {pid}")

    resultado = analisar(
        processo_id=pid,
        query="Quais são as teses principais das partes e os riscos jurídicos?",
        tipo_analise="analise_completa",
    )

    print(json.dumps(resultado, ensure_ascii=False, indent=2))
