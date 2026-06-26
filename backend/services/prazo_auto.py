"""
Detecção automática de prazos processuais em peças judiciais.

Quando uma peça do tipo despacho, decisão, sentença, acórdão ou publicação é
ingerida, este serviço usa Claude Haiku para identificar prazos mencionados
(intimações, determinações, prazos recursais etc.) e criar registros na tabela
`prazos` automaticamente — vinculados ao processo.

Exemplos de frases detectadas:
  "Intimem-se as partes para manifestação em 15 (quinze) dias úteis."
  "Prazo de 15 dias para interposição de apelação (art. 1.003 CPC)."
  "Nomeio perito. Partes terão 5 dias para indicar assistentes técnicos."
  "Cumprida a diligência, vista às partes pelo prazo de 10 dias."
"""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timezone
from typing import Optional

import anthropic
from loguru import logger

from ..config import get_settings
from ..database import get_supabase, sb_run
from .feriados import calcular_vencimento

settings = get_settings()

# Peças que tipicamente contêm determinações com prazo
PECAS_COM_PRAZOS = {
    "despacho",
    "decisao_interlocutoria",
    "sentenca",
    "acordao",
    "publicacao",
    "ata_audiencia",
}

_PROMPT = """\
Você é um assistente jurídico especializado em prazos processuais brasileiros.

CONTEXTO DO PROCESSO:
- Tipo da peça analisada: {tipo_peca}
- Status atual do processo: {processo_status}
- Fase atual: {fase_processo}

REGRAS CRÍTICAS DE FILTRAGEM (siga à risca):
1. Se o processo está ENCERRADO ou ARQUIVADO → retorne lista vazia, não há prazos ativos.
2. Se o tipo da peça é "sentenca" ou "acordao":
   - Extraia APENAS prazos recursais: embargos de declaração, apelação, recurso especial/extraordinário.
   - NÃO extraia prazos de produção de provas, manifestação sobre laudo, oitiva de testemunhas
     ou qualquer diligência instrutória — esses prazos já estão extintos após a sentença.
3. Se a peça MENCIONA prazos passados (ex: "prazo de 15 dias que já correu") → ignore.
4. Extraia apenas prazos que ainda PRECISAM SER CUMPRIDOS a partir desta peça.

Para cada prazo válido, extraia:
- titulo: descrição curta (ex: "Embargos de declaração")
- descricao: trecho literal do texto que menciona o prazo (máx. 200 chars)
- fundamento_legal: artigo/súmula/dispositivo (se mencionado)
- prazo_dias: número de dias (inteiro; null se não mencionar)
- tipo_contagem: "uteis" | "corridos" | "meses"
- data_base_texto: data a partir da qual o prazo corre (ou null)
- urgencia: "critico" | "alto" | "normal"
  - critico = prazo recursal (embargos, apelação, REsp, RE, agravo) ou prescricional
  - alto = manifestação sobre decisão interlocutória, contestação, réplica
  - normal = demais
- responsavel_hint: de quem é o prazo (ex: "autor", "réu", "ambas as partes") — ou null

Se não houver nenhum prazo válido, retorne lista vazia.

Retorne APENAS um JSON válido, sem texto adicional:
{{
  "prazos": [
    {{
      "titulo": "string",
      "descricao": "string",
      "fundamento_legal": "string ou null",
      "prazo_dias": 15,
      "tipo_contagem": "uteis",
      "data_base_texto": "string ou null",
      "urgencia": "normal",
      "responsavel_hint": "string ou null"
    }}
  ]
}}

TEXTO DA PEÇA (primeiros 4.000 chars):
{texto}
"""


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fase_processo(status: str, tipo_peca: str) -> str:
    """Determina a fase processual para contextualizar o prompt."""
    if status in ("encerrado", "arquivado"):
        return "ENCERRADO — nenhum prazo deve ser gerado"
    if tipo_peca in ("sentenca", "acordao"):
        return "pós-sentença — apenas prazos recursais são válidos"
    if tipo_peca in ("despacho", "decisao_interlocutoria"):
        return "instrução/deliberação — prazos de diligência e manifestação são válidos"
    return "em curso"


async def extrair_e_criar_prazos(
    processo_id: uuid.UUID,
    peca_id: str,
    tipo_peca: str,
    texto: str,
    data_documento: Optional[str] = None,
    processo_status: str = "ativo",
) -> int:
    """
    Extrai prazos do texto da peça e cria registros na tabela `prazos`.
    Retorna o número de prazos criados.

    `data_documento` é a data em que a peça foi produzida (YYYY-MM-DD), usada como
    data_base para calcular vencimentos quando a peça não especifica outra data.
    `processo_status` é usado para filtrar prazos irrelevantes (ex: processo encerrado).
    """
    if tipo_peca not in PECAS_COM_PRAZOS:
        return 0

    # Processos encerrados/arquivados não geram novos prazos
    if processo_status in ("encerrado", "arquivado"):
        logger.info(f"prazo_auto: processo {processo_id} está {processo_status}, ignorando extração de prazos")
        return 0

    texto_trunc = texto[:4_000]
    fase = _fase_processo(processo_status, tipo_peca)

    try:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        import asyncio
        import functools
        loop = asyncio.get_event_loop()
        msg = await loop.run_in_executor(
            None,
            functools.partial(
                client.messages.create,
                model="claude-haiku-4-5-20251001",   # Haiku: rápido e econômico
                max_tokens=1_024,
                messages=[{
                    "role": "user",
                    "content": _PROMPT.format(
                        tipo_peca=tipo_peca,
                        processo_status=processo_status,
                        fase_processo=fase,
                        texto=texto_trunc,
                    ),
                }],
            ),
        )
        raw = msg.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
        data = json.loads(raw)
        prazos_detectados: list[dict] = data.get("prazos") or []
    except Exception as e:
        logger.warning(f"prazo_auto: falha na extração IA para peça {peca_id}: {e}")
        return 0

    if not prazos_detectados:
        return 0

    # Data base para cálculo de vencimento
    hoje = date.today()
    data_base = hoje
    if data_documento:
        try:
            data_base = date.fromisoformat(data_documento)
        except (ValueError, TypeError):
            data_base = hoje

    # Mapeia urgencia → prioridade no schema da tabela
    _urg_map = {"critico": "urgente", "alto": "alta", "normal": "normal"}

    sb = get_supabase()
    criados = 0

    for p in prazos_detectados:
        titulo = (p.get("titulo") or "").strip()
        if not titulo:
            continue

        prazo_dias: Optional[int] = p.get("prazo_dias")
        tipo_contagem: str = p.get("tipo_contagem") or "uteis"

        # Calcula vencimento se tiver prazo_dias
        vencimento: Optional[date] = None
        if prazo_dias and prazo_dias > 0:
            try:
                vencimento = calcular_vencimento(data_base, prazo_dias, tipo_contagem)
            except Exception:
                vencimento = None

        # Se não conseguiu calcular, não cria registro sem vencimento
        if vencimento is None:
            continue

        row = {
            "id":              str(uuid.uuid4()),
            "processo_id":     str(processo_id),
            "titulo":          titulo[:200],
            "descricao":       (p.get("descricao") or "")[:500] or None,
            "tipo":            "processual",
            "fundamento_legal": (p.get("fundamento_legal") or "")[:300] or None,
            "data_inicio":     data_base.isoformat(),
            "prazo_dias":      prazo_dias,
            "vencimento":      vencimento.isoformat(),
            "status":          "em_aberto",
            "prioridade":      _urg_map.get(p.get("urgencia") or "normal", "normal"),
            "responsavel":     (p.get("responsavel_hint") or "")[:200] or None,
            "observacoes":     f"Detectado automaticamente da peça {tipo_peca} (peca_id={peca_id})",
            "updated_at":      _utcnow(),
        }

        try:
            await sb_run(lambda: sb.table("prazos").insert(row).execute())
            criados += 1
            logger.info(
                f"prazo_auto: prazo criado '{titulo}' "
                f"venc={vencimento.isoformat()} processo={processo_id}"
            )
        except Exception as e:
            logger.warning(f"prazo_auto: falha ao inserir prazo '{titulo}': {e}")

    return criados
