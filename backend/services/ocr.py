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


def extrair_texto_pdf(caminho: str | Path) -> tuple[list[str], bool]:
    """Retorna (paginas, ocr_utilizado). paginas[i] = texto da página i+1."""
    doc = fitz.open(str(caminho))
    paginas: list[str] = []
    ocr_utilizado = False

    for i, page in enumerate(doc):
        texto = page.get_text("text").strip()
        if len(texto) < MIN_CHARS_NATIVE:
            texto = _ocr_claude(page, i + 1)
            if texto:
                ocr_utilizado = True
        paginas.append(texto)

    doc.close()
    return paginas, ocr_utilizado


def _ocr_claude(page: fitz.Page, num: int) -> str:
    try:
        mat = fitz.Matrix(2.0, 2.0)
        pix = page.get_pixmap(matrix=mat)
        img_b64 = base64.standard_b64encode(pix.tobytes("png")).decode()

        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
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
                        "text": "Extraia todo o texto desta página de documento jurídico brasileiro. Preserve a formatação original. Retorne apenas o texto, sem comentários adicionais.",
                    },
                ],
            }],
        )
        logger.debug(f"Claude Vision OCR página {num}")
        return msg.content[0].text.strip()
    except Exception as e:
        logger.warning(f"Claude Vision falhou na página {num}: {e}")
        return ""


def contar_paginas(caminho: str | Path) -> int:
    doc = fitz.open(str(caminho))
    n = len(doc)
    doc.close()
    return n
