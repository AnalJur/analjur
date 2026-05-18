"""
Geração de minutas e documentos jurídicos assistida por IA.
Usa texto completo das peças (sem RAG).
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


TEMPLATES = {
    "resumo_executivo": {
        "instrucao": """Redija um resumo executivo do processo em linguagem clara e objetiva.
Formato Markdown. Seções: Visão Geral | Situação Atual | Pontos de Atenção | Próximos Passos.
Máximo 800 palavras. Cite fontes entre colchetes [peça/página].""",
    },
    "minuta_recurso": {
        "instrucao": """Redija uma minuta de recurso baseada nos documentos do processo.
AVISO OBRIGATÓRIO no início: "MINUTA PARA REVISÃO — NÃO USAR SEM APROVAÇÃO DO ADVOGADO RESPONSÁVEL."
Estrutura: Tempestividade | Cabimento | Pressupostos | Mérito (teses) | Pedido.
Indique entre [VERIFICAR] os campos que precisam de confirmação humana.""",
    },
    "minuta_contestacao": {
        "instrucao": """Redija uma minuta de contestação baseada nos documentos do processo.
AVISO OBRIGATÓRIO no início: "MINUTA PARA REVISÃO — NÃO USAR SEM APROVAÇÃO DO ADVOGADO RESPONSÁVEL."
Estrutura: Preliminares | Mérito (impugnação ponto a ponto) | Pedido.
Indique entre [VERIFICAR] os campos que precisam de confirmação humana.""",
    },
    "prompt_juridico": {
        "instrucao": """Gere um prompt jurídico estruturado para uso interno da equipe.
Inclua: contexto do processo, questões abertas, pontos que precisam de pesquisa,
jurisprudência relevante a verificar, e checklist de ações.""",
    },
    "parecer": {
        "instrucao": """Redija um parecer técnico-jurídico sobre o processo.
AVISO OBRIGATÓRIO no início: "PARECER PRELIMINAR — SUJEITO A REVISÃO HUMANA."
Estrutura: Síntese Fática | Análise Jurídica | Riscos e Oportunidades | Conclusão.
Indique o grau de certeza de cada conclusão.""",
    },
}


async def _buscar_contexto(processo_id: uuid.UUID) -> str:
    """Busca texto completo das peças do processo."""
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("pecas")
        .select("tipo_peca,pagina_inicio,pagina_fim,conteudo_texto")
        .eq("processo_id", str(processo_id))
        .order("pagina_inicio", desc=False)
        .execute()
    )
    pecas = result.data or []
    if not pecas:
        return ""
    partes = []
    for p in pecas:
        tipo = p.get("tipo_peca", "peca").upper()
        pags = f"pág. {p.get('pagina_inicio')}-{p.get('pagina_fim')}"
        texto = p.get("conteudo_texto") or "(sem texto)"
        partes.append(f"=== {tipo} ({pags}) ===\n{texto}")
    return "\n\n".join(partes)


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
        raise ValueError(f"Tipo de minuta inválido: {tipo}")

    sb = get_supabase()
    tpl = TEMPLATES[tipo]

    contexto = await _buscar_contexto(processo_id)
    if not contexto:
        raise ValueError("Sem documentos para embasar a minuta.")

    instrucao = tpl["instrucao"]
    if instrucoes:
        instrucao += f"\n\nINSTRUÇÕES ADICIONAIS DO ADVOGADO:\n{instrucoes}"

    prompt = (
        f"DOCUMENTOS DO PROCESSO:\n\n{contexto}\n\n"
        f"TAREFA:\n{instrucao}\n\n"
        f"TÍTULO DA MINUTA: {titulo}"
    )

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    loop = asyncio.get_event_loop()
    msg = await loop.run_in_executor(
        None,
        functools.partial(
            client.messages.create,
            model=settings.llm_model,
            max_tokens=6000,
            system="Você é um assistente jurídico especializado. Redija minutas profissionais baseadas exclusivamente nos documentos fornecidos.",
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
        "confianca": 0.7,
        "criado_por": str(usuario_id) if usuario_id else None,
    }
    minuta_r = await sb_run(lambda: sb.table("minutas").insert(minuta_data).execute())
    minuta = minuta_r.data[0]

    tarefa_data = {
        "id": str(uuid.uuid4()),
        "processo_id": str(processo_id),
        "tipo": "minuta",
        "titulo": f"Revisar minuta: {titulo}",
        "descricao": "Minuta gerada por IA. REVISÃO HUMANA OBRIGATÓRIA antes de qualquer uso externo.",
        "prioridade": "alta",
        "status": "pendente",
        "atribuido_para": str(usuario_id) if usuario_id else None,
        "atribuido_por": str(usuario_id) if usuario_id else None,
        "metadados": {"minuta_id": minuta["id"]},
    }
    await sb_run(lambda: sb.table("tarefas_revisao").insert(tarefa_data).execute())

    logger.success(f"Minuta '{titulo}' gerada — {tokens_usados} tokens")
    return minuta


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
