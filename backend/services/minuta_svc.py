"""
Geração de minutas e documentos jurídicos assistida por IA.
Todo output vai para revisão humana antes de qualquer uso externo.
"""

import uuid
import json
from datetime import datetime
from typing import Optional

import anthropic
from sqlalchemy.ext.asyncio import AsyncSession
from loguru import logger

from ..models import Minuta, MinutaHistorico, TarefaRevisao, Analise
from ..config import get_settings
from .rag import buscar_chunks, formatar_contexto

settings = get_settings()


TEMPLATES = {
    "resumo_executivo": {
        "instrucao": """Redija um resumo executivo do processo em linguagem clara e objetiva.
Formato Markdown. Seções: Visão Geral | Situação Atual | Pontos de Atenção | Próximos Passos.
Máximo 800 palavras. Cite fontes entre colchetes [peça/página].""",
        "query": "resumo estado atual situação processo",
    },
    "minuta_recurso": {
        "instrucao": """Redija uma minuta de recurso baseada nos documentos do processo.
AVISO OBRIGATÓRIO no início: "MINUTA PARA REVISÃO — NÃO USAR SEM APROVAÇÃO DO ADVOGADO RESPONSÁVEL."
Estrutura: Tempestividade | Cabimento | Pressupostos | Mérito (teses) | Pedido.
Indique entre [VERIFICAR] os campos que precisam de confirmação humana.""",
        "query": "decisão recorrida teses cabimento recurso",
    },
    "minuta_contestacao": {
        "instrucao": """Redija uma minuta de contestação baseada nos documentos do processo.
AVISO OBRIGATÓRIO no início: "MINUTA PARA REVISÃO — NÃO USAR SEM APROVAÇÃO DO ADVOGADO RESPONSÁVEL."
Estrutura: Preliminares | Mérito (impugnação ponto a ponto) | Pedido.
Indique entre [VERIFICAR] os campos que precisam de confirmação humana.""",
        "query": "petição inicial pedidos autora contestar",
    },
    "prompt_juridico": {
        "instrucao": """Gere um prompt jurídico estruturado para uso interno da equipe.
Inclua: contexto do processo, questões abertas, pontos que precisam de pesquisa,
jurisprudência relevante a verificar, e checklist de ações.""",
        "query": "questões abertas pesquisa jurisprudência pendências",
    },
    "parecer": {
        "instrucao": """Redija um parecer técnico-jurídico sobre o processo.
AVISO OBRIGATÓRIO no início: "PARECER PRELIMINAR — SUJEITO A REVISÃO HUMANA."
Estrutura: Síntese Fática | Análise Jurídica | Riscos e Oportunidades | Conclusão.
Indique o grau de certeza de cada conclusão.""",
        "query": "análise jurídica riscos oportunidades conclusão",
    },
}


async def gerar_minuta(
    db: AsyncSession,
    processo_id: uuid.UUID,
    tipo: str,
    titulo: str,
    instrucoes: Optional[str] = None,
    usuario_id: Optional[uuid.UUID] = None,
    analise_id: Optional[uuid.UUID] = None,
) -> Minuta:
    if tipo not in TEMPLATES:
        raise ValueError(f"Tipo de minuta inválido: {tipo}")

    tpl = TEMPLATES[tipo]
    chunks = buscar_chunks(processo_id, tpl["query"], top_k=10)
    if not chunks:
        raise ValueError("Sem documentos para embasar a minuta.")

    contexto = formatar_contexto(chunks)
    instrucao = tpl["instrucao"]
    if instrucoes:
        instrucao += f"\n\nINSTRUÇÕES ADICIONAIS DO ADVOGADO:\n{instrucoes}"

    prompt = (
        f"DOCUMENTOS DO PROCESSO:\n\n{contexto}\n\n"
        f"TAREFA:\n{instrucao}\n\n"
        f"TÍTULO DA MINUTA: {titulo}"
    )

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    msg = client.messages.create(
        model=settings.llm_model,
        max_tokens=6000,
        system="Você é um assistente jurídico especializado. Redija minutas profissionais baseadas exclusivamente nos documentos fornecidos.",
        messages=[{"role": "user", "content": prompt}],
    )

    conteudo_md = msg.content[0].text.strip()
    tokens_usados = msg.usage.input_tokens + msg.usage.output_tokens

    fontes = [
        {"tipo_peca": c.get("tipo_peca"), "pagina": c.get("pagina"), "similarity": round(c.get("similarity", 0), 3)}
        for c in chunks
    ]

    minuta = Minuta(
        processo_id=processo_id,
        analise_id=analise_id,
        tipo=tipo,
        titulo=titulo,
        conteudo_md=conteudo_md,
        versao=1,
        status="rascunho",
        fontes_json=fontes,
        confianca=0.7,
        criado_por=usuario_id,
    )
    db.add(minuta)
    await db.flush()

    # Tarefa de revisão obrigatória
    tarefa = TarefaRevisao(
        processo_id=processo_id,
        tipo="minuta",
        titulo=f"Revisar minuta: {titulo}",
        descricao="Minuta gerada por IA. REVISÃO HUMANA OBRIGATÓRIA antes de qualquer uso externo.",
        prioridade="alta",
        atribuido_para=usuario_id,
        atribuido_por=usuario_id,
        metadados={"minuta_id": str(minuta.id)},
    )
    db.add(tarefa)

    logger.success(f"Minuta '{titulo}' gerada — {tokens_usados} tokens")
    return minuta


async def salvar_versao(
    db: AsyncSession,
    minuta_id: uuid.UUID,
    novo_conteudo: str,
    usuario_id: Optional[uuid.UUID] = None,
) -> Minuta:
    """Salva nova versão de uma minuta (versionamento manual)."""
    minuta = await db.get(Minuta, minuta_id)
    if not minuta:
        raise ValueError("Minuta não encontrada")

    # Guarda versão anterior
    hist = MinutaHistorico(
        minuta_id=minuta.id,
        versao=minuta.versao,
        conteudo_md=minuta.conteudo_md,
        alterado_por=usuario_id,
    )
    db.add(hist)

    minuta.conteudo_md = novo_conteudo
    minuta.versao += 1
    minuta.status = "em_revisao"

    return minuta
