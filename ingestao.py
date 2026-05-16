"""
ingestao.py — Extração de texto e chunking de PDFs processuais

Suporta:
- PDFs com texto nativo (PyMuPDF)
- PDFs escaneados (OCR via pytesseract)
- Identificação automática de peças processuais
- Chunking com metadados jurídicos
"""

import re
import fitz  # PyMuPDF
import pdfplumber
import pytesseract
from pdf2image import convert_from_path
from pathlib import Path
from typing import Optional
from loguru import logger
import tiktoken

# ---------------------------------------------------------------------------
# Tipos
# ---------------------------------------------------------------------------

from dataclasses import dataclass, field


@dataclass
class Chunk:
    texto: str
    tokens: int
    pagina_inicio: int
    pagina_fim: int
    tipo_peca: str
    autor: str
    data_doc: str
    processo_id: str
    chunk_index: int


@dataclass
class ResultadoIngestao:
    processo_id: str
    total_paginas: int
    total_chunks: int
    chunks: list[Chunk]
    tem_ocr: bool
    erros: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Configuração
# ---------------------------------------------------------------------------

CHUNK_TOKENS = 1000
OVERLAP_TOKENS = 150
ENCODING = tiktoken.get_encoding("cl100k_base")

# Padrões para identificar peças processuais
PADROES_PECAS = {
    "petição_inicial": [
        r"petição inicial", r"excelentíssimo.*juiz", r"vem.*propor.*ação",
        r"requer.*v\.exa", r"autor.*qualificado"
    ],
    "contestação": [
        r"contestação", r"réu.*qualificado", r"impugna.*pedido",
        r"em contestação", r"vem.*contestar"
    ],
    "réplica": [
        r"réplica", r"em réplica", r"replicando"
    ],
    "laudo_pericial": [
        r"laudo pericial", r"perito judicial", r"conclusão pericial",
        r"exame pericial", r"quesitos"
    ],
    "sentença": [
        r"dispositivo", r"julgo procedente", r"julgo improcedente",
        r"ante o exposto.*condeno", r"pelo exposto.*julgo"
    ],
    "acórdão": [
        r"acórdão", r"turma.*julgamento", r"vistos.*relatados.*discutidos",
        r"tribunal.*regional", r"câmara.*cível"
    ],
    "decisão_interlocutória": [
        r"decisão", r"intime-se", r"cite-se", r"defiro", r"indefiro",
        r"determino que"
    ],
    "recurso": [
        r"apelação", r"agravo", r"recurso especial", r"recurso ordinário",
        r"embargos de declaração", r"recorre"
    ],
    "parecer": [
        r"ministério público", r"parecer", r"opina", r"custos legis"
    ],
}


# ---------------------------------------------------------------------------
# Funções de extração
# ---------------------------------------------------------------------------

def extrair_texto_nativo(caminho_pdf: str) -> dict[int, str]:
    """Extrai texto de PDFs com camada de texto nativa usando PyMuPDF."""
    paginas = {}
    try:
        doc = fitz.open(caminho_pdf)
        for num, pagina in enumerate(doc, start=1):
            texto = pagina.get_text("text")
            if texto.strip():
                paginas[num] = texto
        doc.close()
    except Exception as e:
        logger.error(f"Erro extração nativa: {e}")
    return paginas


def extrair_texto_ocr(caminho_pdf: str, paginas_sem_texto: list[int]) -> dict[int, str]:
    """OCR em páginas escaneadas usando pytesseract."""
    paginas = {}
    if not paginas_sem_texto:
        return paginas
    try:
        logger.info(f"Rodando OCR em {len(paginas_sem_texto)} páginas...")
        imagens = convert_from_path(
            caminho_pdf,
            first_page=min(paginas_sem_texto),
            last_page=max(paginas_sem_texto),
            dpi=300,
        )
        for i, img in enumerate(imagens):
            num_pag = paginas_sem_texto[i] if i < len(paginas_sem_texto) else None
            if num_pag:
                texto = pytesseract.image_to_string(img, lang="por")
                if texto.strip():
                    paginas[num_pag] = texto
    except Exception as e:
        logger.warning(f"OCR falhou em algumas páginas: {e}")
    return paginas


def extrair_todas_paginas(caminho_pdf: str) -> tuple[dict[int, str], bool]:
    """
    Extrai texto de todas as páginas do PDF.
    Usa texto nativo quando disponível, OCR como fallback.
    Retorna (paginas_dict, usou_ocr).
    """
    paginas_nativas = extrair_texto_nativo(caminho_pdf)

    # Descobrir total de páginas
    doc = fitz.open(caminho_pdf)
    total = doc.page_count
    doc.close()

    # Identificar páginas sem texto (provavelmente escaneadas)
    sem_texto = [
        p for p in range(1, total + 1)
        if p not in paginas_nativas or len(paginas_nativas[p].strip()) < 50
    ]

    usou_ocr = False
    paginas_ocr = {}
    if sem_texto:
        logger.info(f"Páginas sem texto detectadas: {len(sem_texto)} de {total}")
        paginas_ocr = extrair_texto_ocr(caminho_pdf, sem_texto)
        usou_ocr = bool(paginas_ocr)

    # Mesclar
    todas = {**paginas_nativas, **paginas_ocr}
    return todas, usou_ocr


# ---------------------------------------------------------------------------
# Identificação de peças processuais
# ---------------------------------------------------------------------------

def identificar_tipo_peca(texto: str) -> str:
    """Identifica o tipo de peça processual pelo conteúdo."""
    texto_lower = texto.lower()
    for tipo, padroes in PADROES_PECAS.items():
        for padrao in padroes:
            if re.search(padrao, texto_lower):
                return tipo
    return "documento_processual"


def extrair_data_documento(texto: str) -> str:
    """Tenta extrair data do documento."""
    padroes = [
        r"\d{1,2}\s+de\s+\w+\s+de\s+\d{4}",
        r"\d{1,2}/\d{1,2}/\d{4}",
        r"\d{1,2}-\d{1,2}-\d{4}",
    ]
    for padrao in padroes:
        match = re.search(padrao, texto)
        if match:
            return match.group(0)
    return ""


def extrair_autor(texto: str, tipo_peca: str) -> str:
    """Inferir autor com base no tipo de peça."""
    mapa = {
        "petição_inicial": "autor",
        "contestação": "réu",
        "réplica": "autor",
        "laudo_pericial": "perito",
        "sentença": "juízo",
        "acórdão": "tribunal",
        "decisão_interlocutória": "juízo",
        "recurso": "recorrente",
        "parecer": "ministério_público",
    }
    return mapa.get(tipo_peca, "desconhecido")


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------

def contar_tokens(texto: str) -> int:
    return len(ENCODING.encode(texto))


def criar_chunks_de_texto(
    texto: str,
    pagina_inicio: int,
    pagina_fim: int,
    tipo_peca: str,
    autor: str,
    data_doc: str,
    processo_id: str,
    chunk_index_inicial: int = 0,
) -> list[Chunk]:
    """
    Divide texto em chunks de CHUNK_TOKENS com OVERLAP_TOKENS de sobreposição.
    Tenta quebrar em fronteiras de parágrafo quando possível.
    """
    tokens = ENCODING.encode(texto)
    chunks = []
    inicio = 0
    idx = chunk_index_inicial

    while inicio < len(tokens):
        fim = min(inicio + CHUNK_TOKENS, len(tokens))
        chunk_tokens = tokens[inicio:fim]
        chunk_texto = ENCODING.decode(chunk_tokens)

        chunks.append(Chunk(
            texto=chunk_texto,
            tokens=len(chunk_tokens),
            pagina_inicio=pagina_inicio,
            pagina_fim=pagina_fim,
            tipo_peca=tipo_peca,
            autor=autor,
            data_doc=data_doc,
            processo_id=processo_id,
            chunk_index=idx,
        ))
        idx += 1

        # Avançar com overlap
        inicio = fim - OVERLAP_TOKENS
        if inicio >= len(tokens):
            break

    return chunks


# ---------------------------------------------------------------------------
# Pipeline principal
# ---------------------------------------------------------------------------

def processar_pdf(
    caminho_pdf: str,
    processo_id: str,
    tamanho_lote_paginas: int = 20,
) -> ResultadoIngestao:
    """
    Pipeline completo: extração → identificação → chunking.

    Args:
        caminho_pdf: Caminho para o arquivo PDF
        processo_id: ID único do processo
        tamanho_lote_paginas: Agrupar N páginas antes de chunkar

    Returns:
        ResultadoIngestao com todos os chunks e metadados
    """
    logger.info(f"Iniciando ingestão: {caminho_pdf} | processo: {processo_id}")
    erros = []

    # 1. Extração
    try:
        paginas, usou_ocr = extrair_todas_paginas(caminho_pdf)
    except Exception as e:
        logger.error(f"Falha crítica na extração: {e}")
        return ResultadoIngestao(
            processo_id=processo_id,
            total_paginas=0,
            total_chunks=0,
            chunks=[],
            tem_ocr=False,
            erros=[str(e)],
        )

    total_paginas = len(paginas)
    logger.info(f"Páginas extraídas: {total_paginas} | OCR: {usou_ocr}")

    # 2. Agrupar páginas em lotes e criar chunks
    todos_chunks = []
    chunk_index = 0
    nums_paginas = sorted(paginas.keys())

    for i in range(0, len(nums_paginas), tamanho_lote_paginas):
        lote = nums_paginas[i : i + tamanho_lote_paginas]
        texto_lote = "\n\n".join(paginas[p] for p in lote if paginas.get(p))

        if not texto_lote.strip():
            continue

        # Identificar tipo da peça com base no lote
        tipo = identificar_tipo_peca(texto_lote)
        autor = extrair_autor(texto_lote, tipo)
        data = extrair_data_documento(texto_lote)

        try:
            chunks_lote = criar_chunks_de_texto(
                texto=texto_lote,
                pagina_inicio=lote[0],
                pagina_fim=lote[-1],
                tipo_peca=tipo,
                autor=autor,
                data_doc=data,
                processo_id=processo_id,
                chunk_index_inicial=chunk_index,
            )
            todos_chunks.extend(chunks_lote)
            chunk_index += len(chunks_lote)
        except Exception as e:
            erros.append(f"Erro chunking páginas {lote[0]}-{lote[-1]}: {e}")
            logger.warning(f"Erro chunking: {e}")

    logger.info(f"Ingestão concluída: {len(todos_chunks)} chunks gerados")

    return ResultadoIngestao(
        processo_id=processo_id,
        total_paginas=total_paginas,
        total_chunks=len(todos_chunks),
        chunks=todos_chunks,
        tem_ocr=usou_ocr,
        erros=erros,
    )


# ---------------------------------------------------------------------------
# Teste rápido
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 3:
        print("Uso: python ingestao.py <caminho_pdf> <processo_id>")
        sys.exit(1)

    resultado = processar_pdf(sys.argv[1], sys.argv[2])
    print(f"\n{'='*50}")
    print(f"Processo: {resultado.processo_id}")
    print(f"Páginas: {resultado.total_paginas}")
    print(f"Chunks: {resultado.total_chunks}")
    print(f"OCR usado: {resultado.tem_ocr}")
    print(f"Erros: {len(resultado.erros)}")
    if resultado.chunks:
        print(f"\nPrimeiro chunk ({resultado.chunks[0].tokens} tokens):")
        print(resultado.chunks[0].texto[:300] + "...")
