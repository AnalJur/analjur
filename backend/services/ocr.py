"""
Extração de texto de PDFs com fallback para OCR.
Estratégia: PyMuPDF primeiro (rápido, nativo); se a página tiver texto < 50 chars,
aplica OCR via pytesseract.
"""

import io
from pathlib import Path
from typing import Optional
import fitz  # PyMuPDF
from PIL import Image
from loguru import logger

try:
    import pytesseract
    TESSERACT_OK = True
except ImportError:
    TESSERACT_OK = False


MIN_CHARS_NATIVE = 50   # abaixo disso, página provavelmente é imagem


def extrair_texto_pdf(caminho: str | Path) -> tuple[list[str], bool]:
    """
    Retorna (paginas, ocr_utilizado).
    paginas[i] = texto da página i+1.
    """
    doc = fitz.open(str(caminho))
    paginas: list[str] = []
    ocr_utilizado = False

    for i, page in enumerate(doc):
        texto = page.get_text("text").strip()

        if len(texto) < MIN_CHARS_NATIVE and TESSERACT_OK:
            texto = _ocr_pagina(page)
            if texto:
                ocr_utilizado = True
                logger.debug(f"OCR aplicado na página {i + 1}")

        paginas.append(texto)

    doc.close()
    return paginas, ocr_utilizado


def _ocr_pagina(page: fitz.Page) -> str:
    mat = fitz.Matrix(2.0, 2.0)   # 2× zoom para melhor OCR
    pix = page.get_pixmap(matrix=mat)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    try:
        return pytesseract.image_to_string(img, lang="por+eng").strip()
    except Exception as e:
        logger.warning(f"Falha no OCR: {e}")
        return ""


def contar_paginas(caminho: str | Path) -> int:
    doc = fitz.open(str(caminho))
    n = len(doc)
    doc.close()
    return n
