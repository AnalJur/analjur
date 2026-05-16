"""
Divisão de texto em chunks com sobreposição controlada por tokens.
"""

import tiktoken
from dataclasses import dataclass

_enc = tiktoken.get_encoding("cl100k_base")


@dataclass
class Chunk:
    conteudo: str
    tokens:   int
    pagina:   int
    index:    int


def tokenizar(texto: str) -> list[int]:
    return _enc.encode(texto)


def detokenizar(tokens: list[int]) -> str:
    return _enc.decode(tokens)


def chunkar_paginas(
    paginas: list[str],
    tokens_por_chunk: int = 1000,
    overlap: int = 150,
) -> list[Chunk]:
    """
    Recebe lista de strings (uma por página) e retorna chunks com metadado de página.
    A sobreposição é em tokens, não em palavras.
    """
    chunks: list[Chunk] = []
    buffer_tokens: list[int] = []
    buffer_pagina: int = 1
    index = 0

    for pagina_num, texto in enumerate(paginas, start=1):
        if not texto.strip():
            continue

        novos = tokenizar(texto)

        for tok in novos:
            buffer_tokens.append(tok)

            if len(buffer_tokens) >= tokens_por_chunk:
                conteudo = detokenizar(buffer_tokens)
                chunks.append(Chunk(
                    conteudo=conteudo,
                    tokens=len(buffer_tokens),
                    pagina=buffer_pagina,
                    index=index,
                ))
                index += 1
                # sobreposição: mantém últimos `overlap` tokens
                buffer_tokens = buffer_tokens[-overlap:]
                buffer_pagina = pagina_num

    # chunk residual
    if buffer_tokens:
        conteudo = detokenizar(buffer_tokens)
        chunks.append(Chunk(
            conteudo=conteudo,
            tokens=len(buffer_tokens),
            pagina=buffer_pagina,
            index=index,
        ))

    return chunks
