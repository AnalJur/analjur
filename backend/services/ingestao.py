"""
Pipeline de ingestão — extrai texto, segmenta peças e classifica.
"""

import hashlib
import re
import uuid
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from loguru import logger

from ..config import get_settings
from ..database import get_supabase, sb_run
from .ocr import extrair_texto_pdf
from .classificador import classificar_peca

settings = get_settings()

# ── Segmentação ────────────────────────────────────────────────────────────────
# Padrões que indicam início de nova peça processual (busca nas 4 primeiras
# linhas não-vazias de cada página, para evitar falsos positivos no corpo).

_PADROES_INICIO_PECA: list[tuple[re.Pattern, str]] = [
    (re.compile(r'\bSENTENÇA\b',                    re.IGNORECASE), 'sentenca'),
    (re.compile(r'\bACÓRDÃO\b',                     re.IGNORECASE), 'acordao'),
    (re.compile(r'\bDECISÃO\s+INTERLOCUTÓRIA\b',    re.IGNORECASE), 'decisao_interlocutoria'),
    (re.compile(r'^\s*DECISÃO\s*$',                  re.IGNORECASE | re.MULTILINE), 'decisao_interlocutoria'),
    (re.compile(r'\bDESPACHO\b',                    re.IGNORECASE), 'despacho'),
    (re.compile(r'\bPETIÇÃO\s+INICIAL\b',           re.IGNORECASE), 'peticao_inicial'),
    (re.compile(r'\bCONTESTAÇÃO\b',                re.IGNORECASE), 'contestacao'),
    (re.compile(r'\bRÉPLICA\b',                     re.IGNORECASE), 'replica'),
    (re.compile(r'\bAPELAÇÃO\b',                   re.IGNORECASE), 'recurso'),
    (re.compile(r'\bAGRAVO\s+(DE\s+INSTRUMENTO|INTERNO|REGIMENTAL)\b', re.IGNORECASE), 'recurso'),
    (re.compile(r'\bEMBARGOS\s+DE\s+DECL',         re.IGNORECASE), 'recurso'),
    (re.compile(r'\bRECURSO\s+(ESPECIAL|ORDINÁRIO|ADESIVO)\b', re.IGNORECASE), 'recurso'),
    (re.compile(r'\bCONTRARRAZÕES\b',              re.IGNORECASE), 'contrarrazoes'),
    (re.compile(r'\bLAUDO\s+PERICIAL\b',            re.IGNORECASE), 'laudo_pericial'),
    (re.compile(r'\bCERTIDÃO\b',                   re.IGNORECASE), 'certidao'),
    (re.compile(r'\bPROCURAÇÃO\b',                 re.IGNORECASE), 'procuracao'),
    (re.compile(r'\bCONTRATO\b',                   re.IGNORECASE), 'contrato'),
    (re.compile(r'\bALEGAÇÕES\s+FINAIS\b',         re.IGNORECASE), 'outros'),
    (re.compile(r'\bMEMORIAL\s+(DE\s+)?ALEGAÇÕES\b', re.IGNORECASE), 'outros'),
    (re.compile(r'\bINTIMIDAÇÃO\b',                re.IGNORECASE), 'publicacao'),
    (re.compile(r'\bAUDIÊNCIA\b',                  re.IGNORECASE), 'outros'),
]

# Mínimo de páginas para considerar uma fronteira válida
_MIN_PAGINAS_POR_PECA = 1


def _detectar_inicio_peca(texto_pagina: str) -> Optional[str]:
    """
    Examina apenas as 4 primeiras linhas não-vazias de uma página.
    Retorna o tipo de peça se for início, ou None.
    """
    linhas = [ln.strip() for ln in texto_pagina.split('\n') if ln.strip()]
    if not linhas:
        return None
    cabecalho = '\n'.join(linhas[:4])
    for padrao, tipo in _PADROES_INICIO_PECA:
        if padrao.search(cabecalho):
            return tipo
    return None


def segmentar_paginas(paginas: list[str]) -> list[dict]:
    """
    Divide as páginas em peças processuais individuais.

    Estratégia:
    - Escaneia cada página procurando cabeçalhos nas 4 primeiras linhas.
    - Quando encontra um cabeçalho, inicia uma nova peça.
    - Peças muito curtas (<_MIN_PAGINAS_POR_PECA) são fundidas à anterior.
    - Se nenhuma fronteira for detectada, retorna o documento inteiro como uma única peça.

    Retorna lista de dicts: {pagina_inicio, pagina_fim, tipo_hint, texto}
    """
    if not paginas:
        return []

    fronteiras: list[tuple[int, Optional[str]]] = [(0, None)]  # (índice base-0, tipo_hint)

    for i, pagina in enumerate(paginas[1:], start=1):          # pula a primeira página
        tipo = _detectar_inicio_peca(pagina)
        if tipo:
            # Evita fronteiras consecutivas na mesma página ou muito próximas
            ultima_idx = fronteiras[-1][0]
            if i - ultima_idx >= _MIN_PAGINAS_POR_PECA:
                fronteiras.append((i, tipo))

    # Se só detectou a fronteira inicial (pág 0), retorna como peça única
    if len(fronteiras) == 1:
        logger.info("Sem fronteiras detectadas — documento tratado como peça única")
        return [{
            "pagina_inicio": 1,
            "pagina_fim": len(paginas),
            "tipo_hint": None,
            "texto": "\n\n".join(p for p in paginas if p.strip()),
        }]

    logger.info(f"Fronteiras detectadas: {len(fronteiras)} peças")

    resultado = []
    for idx, (pag_ini, tipo_hint) in enumerate(fronteiras):
        pag_fim = fronteiras[idx + 1][0] if idx + 1 < len(fronteiras) else len(paginas)
        texto = "\n\n".join(p for p in paginas[pag_ini:pag_fim] if p.strip())
        if texto.strip():
            resultado.append({
                "pagina_inicio": pag_ini + 1,   # converte para base-1
                "pagina_fim":    pag_fim,
                "tipo_hint":     tipo_hint,
                "texto":         texto,
            })

    return resultado


# ── Utilitários ────────────────────────────────────────────────────────────────

def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def calcular_hash(conteudo: bytes) -> str:
    return hashlib.sha256(conteudo).hexdigest()


async def verificar_duplicata(processo_id: uuid.UUID, content_hash: str) -> bool:
    """Retorna True apenas se já existe documento processado com o mesmo hash."""
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("documentos")
        .select("id,status")
        .eq("processo_id", str(processo_id))
        .eq("content_hash", content_hash)
        .limit(1)
        .execute()
    )
    if not result.data:
        return False
    return result.data[0].get("status") != "erro"


async def limpar_documento_com_erro(processo_id: uuid.UUID, content_hash: str) -> None:
    """Remove registro de documento com erro para permitir re-upload limpo."""
    sb = get_supabase()
    result = await sb_run(
        lambda: sb.table("documentos")
        .select("id")
        .eq("processo_id", str(processo_id))
        .eq("content_hash", content_hash)
        .eq("status", "erro")
        .limit(1)
        .execute()
    )
    if result.data:
        doc_id = result.data[0]["id"]
        await sb_run(lambda: sb.table("pecas").delete().eq("documento_id", doc_id).execute())
        await sb_run(lambda: sb.table("documentos").delete().eq("id", doc_id).execute())
        logger.info(f"Documento com erro removido para re-upload: {doc_id}")


# ── Pipeline principal ────────────────────────────────────────────────────────

async def processar_conteudo(
    doc_id: str,
    processo_id: uuid.UUID,
    tenant_id: uuid.UUID,
    nome_original: str,
    conteudo: bytes,
) -> None:
    """
    Processa OCR, segmenta o documento em peças e classifica cada uma.
    Cria N registros na tabela pecas (um por peça detectada).
    """
    sb = get_supabase()

    tmp_path = Path(tempfile.gettempdir()) / f"{uuid.uuid4()}.pdf"
    tmp_path.write_bytes(conteudo)

    try:
        logger.info(f"Extraindo texto de {nome_original} ({len(conteudo) // 1024} KB)")
        paginas, ocr_utilizado = extrair_texto_pdf(tmp_path)
        logger.info(f"{len(paginas)} páginas extraídas (OCR={ocr_utilizado})")

        # ── Segmentação ──────────────────────────────────────────────────────
        segmentos = segmentar_paginas(paginas)
        logger.info(f"Segmentação: {len(segmentos)} peça(s) identificada(s)")

        pecas_rows = []
        for seg in segmentos:
            # Usa tipo_hint se detectado; caso contrário, classifica com IA/heurística
            if seg["tipo_hint"]:
                tipo_peca = seg["tipo_hint"]
                confianca  = 0.80
            else:
                resultado = classificar_peca(seg["texto"])
                tipo_peca = resultado.tipo_peca
                confianca  = resultado.confianca

            n_pags = seg["pagina_fim"] - seg["pagina_inicio"] + 1
            logger.info(
                f"  Peça pág. {seg['pagina_inicio']}–{seg['pagina_fim']} "
                f"({n_pags} pág.) → {tipo_peca} ({confianca:.0%})"
            )

            pecas_rows.append({
                "id":                       str(uuid.uuid4()),
                "documento_id":             doc_id,
                "processo_id":              str(processo_id),
                "tipo_peca":                tipo_peca,
                "pagina_inicio":            seg["pagina_inicio"],
                "pagina_fim":               seg["pagina_fim"],
                "conteudo_texto":           seg["texto"][:500_000],
                "confianca_classificacao":  confianca,
            })

        # Insere todas as peças de uma vez (ou em lotes para documentos grandes)
        LOTE = 20
        for i in range(0, len(pecas_rows), LOTE):
            lote = pecas_rows[i:i + LOTE]
            await sb_run(lambda: sb.table("pecas").insert(lote).execute())

        await sb_run(
            lambda: sb.table("documentos").update({
                "status":       "processado",
                "total_paginas": len(paginas),
                "ocr_utilizado": ocr_utilizado,
                "processado_at": _utcnow(),
            }).eq("id", doc_id).execute()
        )
        logger.success(
            f"Documento '{nome_original}' processado — "
            f"{len(paginas)} pág., {len(pecas_rows)} peça(s)"
        )

    except Exception as e:
        await sb_run(
            lambda: sb.table("documentos").update({
                "status":   "erro",
                "erro_msg": str(e)[:500],
            }).eq("id", doc_id).execute()
        )
        logger.error(f"Erro ao processar {nome_original}: {e}")

    finally:
        tmp_path.unlink(missing_ok=True)


async def processar_documento(
    processo_id: uuid.UUID,
    tenant_id: uuid.UUID,
    nome_original: str,
    conteudo: bytes,
    uploaded_by: Optional[uuid.UUID] = None,
    tmp_path: Optional[Path] = None,
) -> dict:
    """Cria registro e processa sincronamente (compatibilidade com worker)."""
    sb = get_supabase()

    content_hash = calcular_hash(conteudo)
    if await verificar_duplicata(processo_id, content_hash):
        raise ValueError(f"Documento já existe (hash {content_hash[:8]}…)")

    doc_data = {
        "id":           str(uuid.uuid4()),
        "processo_id":  str(processo_id),
        "tenant_id":    str(tenant_id),
        "nome_original": nome_original,
        "storage_path": "",
        "content_hash": content_hash,
        "tamanho_bytes": len(conteudo),
        "status":       "processando",
        "uploaded_by":  str(uploaded_by) if uploaded_by else None,
        "uploaded_at":  _utcnow(),
    }
    doc_r = await sb_run(lambda: sb.table("documentos").insert(doc_data).execute())
    doc = doc_r.data[0]

    await processar_conteudo(doc["id"], processo_id, tenant_id, nome_original, conteudo)

    result = await sb_run(
        lambda: sb.table("documentos").select("*").eq("id", doc["id"]).limit(1).execute()
    )
    return result.data[0]
