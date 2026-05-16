-- ============================================================
-- sql_setup.sql — Schema Supabase para análise processual
-- Execute este SQL no editor SQL do Supabase
-- ============================================================

-- 1. Habilitar extensão pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Tabela principal de chunks
CREATE TABLE IF NOT EXISTS chunks_processuais (
    id            BIGSERIAL PRIMARY KEY,
    processo_id   TEXT NOT NULL,
    chunk_index   INTEGER NOT NULL,
    texto         TEXT NOT NULL,
    embedding     VECTOR(1024),        -- voyage-law-2 usa 1024 dimensões
    tokens        INTEGER,
    pagina_inicio INTEGER,
    pagina_fim    INTEGER,
    tipo_peca     TEXT,
    autor         TEXT,
    data_doc      TEXT,
    criado_em     TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (processo_id, chunk_index)
);

-- 3. Índice vetorial (HNSW — melhor performance para buscas)
CREATE INDEX IF NOT EXISTS idx_embedding_hnsw
    ON chunks_processuais
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- 4. Índices auxiliares
CREATE INDEX IF NOT EXISTS idx_processo_id
    ON chunks_processuais (processo_id);

CREATE INDEX IF NOT EXISTS idx_tipo_peca
    ON chunks_processuais (tipo_peca);

-- 5. Função de busca por similaridade (com filtro por processo)
CREATE OR REPLACE FUNCTION buscar_chunks_similares(
    query_embedding    VECTOR(1024),
    processo_id_filter TEXT,
    match_count        INTEGER DEFAULT 8,
    tipo_peca_filter   TEXT DEFAULT NULL
)
RETURNS TABLE (
    id            BIGINT,
    processo_id   TEXT,
    chunk_index   INTEGER,
    texto         TEXT,
    tokens        INTEGER,
    pagina_inicio INTEGER,
    pagina_fim    INTEGER,
    tipo_peca     TEXT,
    autor         TEXT,
    data_doc      TEXT,
    similaridade  FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.processo_id,
        c.chunk_index,
        c.texto,
        c.tokens,
        c.pagina_inicio,
        c.pagina_fim,
        c.tipo_peca,
        c.autor,
        c.data_doc,
        1 - (c.embedding <=> query_embedding) AS similaridade
    FROM chunks_processuais c
    WHERE
        c.processo_id = processo_id_filter
        AND (tipo_peca_filter IS NULL OR c.tipo_peca = tipo_peca_filter)
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- 6. View útil: resumo por processo
CREATE OR REPLACE VIEW resumo_processos AS
SELECT
    processo_id,
    COUNT(*) AS total_chunks,
    SUM(tokens) AS total_tokens,
    MIN(pagina_inicio) AS primeira_pagina,
    MAX(pagina_fim) AS ultima_pagina,
    ARRAY_AGG(DISTINCT tipo_peca) AS tipos_peca,
    MIN(criado_em) AS ingerido_em
FROM chunks_processuais
GROUP BY processo_id;

-- ============================================================
-- Verificar instalação
-- SELECT * FROM resumo_processos;
-- ============================================================
