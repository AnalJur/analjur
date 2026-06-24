"""
Extração de texto de PDFs.
Estratégia: PyMuPDF para PDFs digitais; Claude Vision (Haiku) para páginas escaneadas.
"""

import base64
from pathlib import Path
import fitz  # PyMuPDF
from loguru import logger
import anthropic
from ..config import get_settings

settings = get_settings()
MIN_CHARS_NATIVE = 50

# Resolução da imagem para OCR: 3x = ~216 DPI — essencial para PDFs escaneados
# com baixa qualidade ou texto pequeno. 2x (144 DPI) perdia caracteres e acentos.
OCR_SCALE = 3.0


def extrair_texto_pdf(caminho: str | Path) -> tuple[list[str], bool]:
    """
    Retorna (paginas, ocr_utilizado).
    paginas[i] = texto da página i+1.

    Estratégia por página:
    - PyMuPDF extrai texto nativo (rápido, gratuito)
    - Se a página tem < MIN_CHARS_NATIVE chars (escaneada / imagem), usa Claude Vision
    - Claude Vision recebe a imagem em 3x para máxima fidelidade
    """
    doc = fitz.open(str(caminho))
    paginas: list[str] = []
    ocr_utilizado = False

    for i, page in enumerate(doc):
        # Tenta extração nativa primeiro
        texto = page.get_text("text").strip()

        if len(texto) < MIN_CHARS_NATIVE:
            # Página escaneada ou imagem — usa Claude Vision
            texto_ocr = _ocr_claude(page, i + 1)
            if texto_ocr:
                texto = texto_ocr
                ocr_utilizado = True
            # Se Claude também falhar, mantém o texto nativo (mesmo que curto)

        paginas.append(texto)

    doc.close()
    return paginas, ocr_utilizado


def _ocr_claude(page: fitz.Page, num: int) -> str:
    """
    OCR via Claude Vision (claude-3-5-sonnet para maior precisão em docs difíceis).
    Renderiza a página em alta resolução (3x) antes de enviar.
    """
    try:
        mat = fitz.Matrix(OCR_SCALE, OCR_SCALE)
        pix = page.get_pixmap(matrix=mat)
        img_b64 = base64.standard_b64encode(pix.tobytes("png")).decode()

        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        msg = client.messages.create(
            model=settings.llm_model,   # Sonnet: melhor fidelidade em docs escaneados
            max_tokens=4096,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": "image/png", "data": img_b64},
                    },
                    {
                        "type": "text",
                        "text": (
                            "Extraia TODO o texto desta página de processo judicial brasileiro. "
                            "Inclua: cabeçalhos, rodapés, carimbos, assinaturas digitais, numeração de páginas (fls.), "
                            "datas, valores monetários (R$), números de processo, nomes de partes e advogados. "
                            "Preserve a ordem de leitura natural (de cima para baixo, esquerda para direita). "
                            "Se houver texto ilegível, marque com [ilegível]. "
                            "Retorne APENAS o texto extraído, sem explicações ou comentários."
                        ),
                    },
                ],
            }],
        )
        logger.debug(f"Claude Vision OCR página {num}: {len(msg.content[0].text)} chars")
        return msg.content[0].text.strip()
    except Exception as e:
        logger.warning(f"Claude Vision falhou na página {num}: {e}")
        return ""


def contar_paginas(caminho: str | Path) -> int:
    doc = fitz.open(str(caminho))
    n = len(doc)
    doc.close()
    return n
