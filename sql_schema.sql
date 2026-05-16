-- ============================================================
-- AnalJur — Schema completo v2
-- Executa no Supabase (PostgreSQL + pgvector)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgvector";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- TENANTS & USUÁRIOS
-- ============================================================

CREATE TABLE IF NOT EXISTS tenants (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nome        TEXT NOT NULL,
    plano       TEXT NOT NULL DEFAULT 'starter',      -- starter | pro | enterprise
    ativo       BOOLEAN NOT NULL DEFAULT true,
    config      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usuarios (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email           TEXT NOT NULL UNIQUE,
    nome            TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'advogado',  -- admin | advogado | assistente | revisor
    ativo           BOOLEAN NOT NULL DEFAULT true,
    ultimo_acesso   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usuarios_tenant ON usuarios(tenant_id);

-- ============================================================
-- PROCESSOS
-- ============================================================

CREATE TABLE IF NOT EXISTS processos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    numero_cnj      TEXT,
    tribunal        TEXT,
    vara            TEXT,
    assunto         TEXT,
    status          TEXT NOT NULL DEFAULT 'ativo',    -- ativo | arquivado | suspenso
    responsavel_id  UUID REFERENCES usuarios(id),
    tags            TEXT[] DEFAULT '{}',
    metadados       JSONB NOT NULL DEFAULT '{}',
    created_by      UUID REFERENCES usuarios(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_processos_tenant  ON processos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_processos_numero  ON processos(numero_cnj);
CREATE INDEX IF NOT EXISTS idx_processos_status  ON processos(status);

CREATE TABLE IF NOT EXISTS partes (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    processo_id UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
    tipo        TEXT NOT NULL,  -- autor | reu | terceiro | advogado_autor | advogado_reu | juiz | promotor
    nome        TEXT NOT NULL,
    documento   TEXT,           -- CPF/CNPJ
    oab         TEXT,
    email       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_partes_processo ON partes(processo_id);

-- ============================================================
-- DOCUMENTOS (arquivos enviados)
-- ============================================================

CREATE TABLE IF NOT EXISTS documentos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    processo_id     UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    nome_original   TEXT NOT NULL,
    storage_path    TEXT NOT NULL,
    content_hash    TEXT NOT NULL,          -- SHA-256 para deduplicação
    mime_type       TEXT NOT NULL DEFAULT 'application/pdf',
    tamanho_bytes   BIGINT,
    total_paginas   INTEGER,
    ocr_utilizado   BOOLEAN NOT NULL DEFAULT false,
    status          TEXT NOT NULL DEFAULT 'aguardando', -- aguardando | processando | processado | erro
    erro_msg        TEXT,
    uploaded_by     UUID REFERENCES usuarios(id),
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processado_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_documentos_processo ON documentos(processo_id);
CREATE INDEX IF NOT EXISTS idx_documentos_status   ON documentos(status);
-- Deduplicação: mesmo hash não pode entrar duas vezes no mesmo processo
CREATE UNIQUE INDEX IF NOT EXISTS idx_documentos_hash_processo ON documentos(processo_id, content_hash);

-- ============================================================
-- PEÇAS PROCESSUAIS (classificadas dentro dos documentos)
-- ============================================================

CREATE TABLE IF NOT EXISTS pecas (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    documento_id            UUID NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
    processo_id             UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
    tipo_peca               TEXT NOT NULL,  -- peticao_inicial | contestacao | sentenca | acordao |
                                            -- despacho | recurso | certidao | publicacao | outros
    pagina_inicio           INTEGER NOT NULL,
    pagina_fim              INTEGER NOT NULL,
    data_documento          DATE,
    autor                   TEXT,
    conteudo_texto          TEXT,
    resumo                  TEXT,           -- gerado por IA
    metadados               JSONB NOT NULL DEFAULT '{}',
    confianca_classificacao FLOAT,          -- 0-1
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pecas_documento ON pecas(documento_id);
CREATE INDEX IF NOT EXISTS idx_pecas_processo  ON pecas(processo_id);
CREATE INDEX IF NOT EXISTS idx_pecas_tipo      ON pecas(tipo_peca);
CREATE INDEX IF NOT EXISTS idx_pecas_data      ON pecas(data_documento);

-- ============================================================
-- CHUNKS VETORIZADOS
-- ============================================================

CREATE TABLE IF NOT EXISTS chunks (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    peca_id     UUID NOT NULL REFERENCES pecas(id) ON DELETE CASCADE,
    processo_id UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    conteudo    TEXT NOT NULL,
    embedding   VECTOR(1024),
    pagina      INTEGER,
    chunk_index INTEGER NOT NULL,
    tokens      INTEGER,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chunks_peca      ON chunks(peca_id);
CREATE INDEX IF NOT EXISTS idx_chunks_processo  ON chunks(processo_id);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON chunks
    USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- ============================================================
-- CRONOLOGIA DE EVENTOS
-- ============================================================

CREATE TABLE IF NOT EXISTS cronologia (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    processo_id      UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
    peca_id          UUID REFERENCES pecas(id),
    data_evento      DATE,
    data_aproximada  BOOLEAN NOT NULL DEFAULT false,
    tipo_evento      TEXT NOT NULL,  -- protocolo | despacho | decisao | sentenca | acordao |
                                     -- prazo | audiencia | pericia | recurso | publicacao
    descricao        TEXT NOT NULL,
    relevancia       TEXT NOT NULL DEFAULT 'media',  -- baixa | media | alta | critica
    fonte            TEXT NOT NULL DEFAULT 'ia',     -- ia | manual
    validado         BOOLEAN NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cronologia_processo ON cronologia(processo_id);
CREATE INDEX IF NOT EXISTS idx_cronologia_data     ON cronologia(data_evento);

-- ============================================================
-- SNAPSHOTS VERSIONADOS
-- ============================================================

CREATE TABLE IF NOT EXISTS snapshots (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    processo_id     UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
    versao          INTEGER NOT NULL,
    trigger         TEXT NOT NULL,      -- novo_documento | revisao_manual | analise_completa
    estado_json     JSONB NOT NULL,     -- estado completo do processo nessa versão
    resumo_mudancas TEXT,
    documentos_ids  UUID[],
    criado_por      UUID REFERENCES usuarios(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(processo_id, versao)
);
CREATE INDEX IF NOT EXISTS idx_snapshots_processo ON snapshots(processo_id);

-- ============================================================
-- ANÁLISES DE IA
-- ============================================================

CREATE TABLE IF NOT EXISTS analises (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    processo_id      UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
    snapshot_id      UUID REFERENCES snapshots(id),
    tipo             TEXT NOT NULL,   -- resumo_executivo | riscos | teses | estado_atual |
                                      -- impacto_atualizacao | proximos_passos | estrategia
    conteudo_json    JSONB NOT NULL,
    modelo_ia        TEXT NOT NULL,
    tokens_input     INTEGER,
    tokens_output    INTEGER,
    confianca        FLOAT,           -- 0-1
    status_revisao   TEXT NOT NULL DEFAULT 'pendente',  -- pendente | aprovada | rejeitada | editada
    revisado_por     UUID REFERENCES usuarios(id),
    revisado_at      TIMESTAMPTZ,
    comentario_revisao TEXT,
    created_by       UUID REFERENCES usuarios(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_analises_processo ON analises(processo_id);
CREATE INDEX IF NOT EXISTS idx_analises_tipo     ON analises(tipo);
CREATE INDEX IF NOT EXISTS idx_analises_status   ON analises(status_revisao);

-- ============================================================
-- REVISÃO HUMANA
-- ============================================================

CREATE TABLE IF NOT EXISTS tarefas_revisao (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    processo_id     UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
    analise_id      UUID REFERENCES analises(id),
    tipo            TEXT NOT NULL,    -- prazo | publicacao | minuta | analise | documento
    titulo          TEXT NOT NULL,
    descricao       TEXT,
    status          TEXT NOT NULL DEFAULT 'pendente',   -- pendente | em_revisao | aprovado | rejeitado | cancelado
    prioridade      TEXT NOT NULL DEFAULT 'normal',     -- baixa | normal | alta | urgente
    deadline        TIMESTAMPTZ,
    atribuido_para  UUID REFERENCES usuarios(id),
    atribuido_por   UUID REFERENCES usuarios(id),
    concluido_por   UUID REFERENCES usuarios(id),
    concluido_at    TIMESTAMPTZ,
    comentario      TEXT,
    metadados       JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tarefas_processo  ON tarefas_revisao(processo_id);
CREATE INDEX IF NOT EXISTS idx_tarefas_atribuido ON tarefas_revisao(atribuido_para);
CREATE INDEX IF NOT EXISTS idx_tarefas_status    ON tarefas_revisao(status);

-- ============================================================
-- MINUTAS GERADAS
-- ============================================================

CREATE TABLE IF NOT EXISTS minutas (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    processo_id UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
    analise_id  UUID REFERENCES analises(id),
    tipo        TEXT NOT NULL,    -- resumo_executivo | minuta_recurso | minuta_contestacao |
                                  -- prompt_juridico | parecer
    titulo      TEXT NOT NULL,
    conteudo_md TEXT NOT NULL,
    versao      INTEGER NOT NULL DEFAULT 1,
    status      TEXT NOT NULL DEFAULT 'rascunho',  -- rascunho | em_revisao | aprovado | publicado
    fontes_json JSONB NOT NULL DEFAULT '[]',       -- chunks/peças que embasaram
    confianca   FLOAT,
    criado_por  UUID REFERENCES usuarios(id),
    revisado_por UUID REFERENCES usuarios(id),
    revisado_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_minutas_processo ON minutas(processo_id);
CREATE INDEX IF NOT EXISTS idx_minutas_status   ON minutas(status);

CREATE TABLE IF NOT EXISTS minutas_historico (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    minuta_id   UUID NOT NULL REFERENCES minutas(id) ON DELETE CASCADE,
    versao      INTEGER NOT NULL,
    conteudo_md TEXT NOT NULL,
    alterado_por UUID REFERENCES usuarios(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- FILA DE JOBS
-- ============================================================

CREATE TABLE IF NOT EXISTS jobs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tipo            TEXT NOT NULL,    -- ocr | embedding | classificar_peca | analise_ia | snapshot | notificacao
    payload         JSONB NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pendente',  -- pendente | processando | concluido | erro | cancelado
    prioridade      INTEGER NOT NULL DEFAULT 5,        -- 1 (alta) → 10 (baixa)
    tentativas      INTEGER NOT NULL DEFAULT 0,
    max_tentativas  INTEGER NOT NULL DEFAULT 3,
    erro_msg        TEXT,
    resultado       JSONB,
    criado_por      UUID REFERENCES usuarios(id),
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    scheduled_for   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jobs_status    ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_tipo      ON jobs(tipo);
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled ON jobs(scheduled_for) WHERE status = 'pendente';

-- ============================================================
-- AUDIT LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_log (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID REFERENCES tenants(id),
    usuario_id  UUID REFERENCES usuarios(id),
    acao        TEXT NOT NULL,    -- criar | atualizar | deletar | aprovar | rejeitar | visualizar | exportar
    entidade    TEXT NOT NULL,    -- processo | documento | analise | minuta | tarefa | ...
    entidade_id UUID,
    dados_antes JSONB,
    dados_depois JSONB,
    ip          TEXT,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant   ON audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_usuario  ON audit_log(usuario_id);
CREATE INDEX IF NOT EXISTS idx_audit_entidade ON audit_log(entidade, entidade_id);
CREATE INDEX IF NOT EXISTS idx_audit_created  ON audit_log(created_at DESC);

-- ============================================================
-- FUNÇÕES
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_processos_updated
    BEFORE UPDATE ON processos
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_tarefas_updated
    BEFORE UPDATE ON tarefas_revisao
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_minutas_updated
    BEFORE UPDATE ON minutas
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Próxima versão de snapshot
CREATE OR REPLACE FUNCTION proximo_snapshot(p_processo_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE v_max INTEGER;
BEGIN
    SELECT COALESCE(MAX(versao), 0) INTO v_max FROM snapshots WHERE processo_id = p_processo_id;
    RETURN v_max + 1;
END;
$$;

-- Busca vetorial de chunks
CREATE OR REPLACE FUNCTION buscar_chunks(
    query_embedding  VECTOR(1024),
    p_processo_id    UUID,
    match_count      INT DEFAULT 8,
    p_tipo_peca      TEXT DEFAULT NULL
)
RETURNS TABLE (
    id           UUID,
    peca_id      UUID,
    conteudo     TEXT,
    pagina       INTEGER,
    chunk_index  INTEGER,
    similarity   FLOAT,
    tipo_peca    TEXT,
    data_doc     DATE
)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.peca_id,
        c.conteudo,
        c.pagina,
        c.chunk_index,
        1 - (c.embedding <=> query_embedding) AS similarity,
        p.tipo_peca,
        p.data_documento
    FROM chunks c
    JOIN pecas p ON p.id = c.peca_id
    WHERE c.processo_id = p_processo_id
      AND (p_tipo_peca IS NULL OR p.tipo_peca = p_tipo_peca)
      AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ============================================================
-- VIEWS OPERACIONAIS
-- ============================================================

CREATE OR REPLACE VIEW v_processos AS
SELECT
    p.id,
    p.tenant_id,
    p.numero_cnj,
    p.tribunal,
    p.vara,
    p.assunto,
    p.status,
    p.tags,
    u.nome                                                          AS responsavel,
    COUNT(DISTINCT d.id)                                            AS total_documentos,
    COUNT(DISTINCT pe.id)                                           AS total_pecas,
    COUNT(DISTINCT c.id)                                            AS total_chunks,
    COUNT(DISTINCT tr.id) FILTER (WHERE tr.status = 'pendente')     AS tarefas_pendentes,
    COUNT(DISTINCT a.id)  FILTER (WHERE a.status_revisao = 'pendente') AS analises_pendentes,
    MAX(d.uploaded_at)                                              AS ultimo_upload,
    MAX(s.created_at)                                               AS ultimo_snapshot,
    p.created_at,
    p.updated_at
FROM processos p
LEFT JOIN usuarios u          ON u.id  = p.responsavel_id
LEFT JOIN documentos d        ON d.processo_id = p.id AND d.status = 'processado'
LEFT JOIN pecas pe            ON pe.processo_id = p.id
LEFT JOIN chunks c            ON c.processo_id = p.id
LEFT JOIN tarefas_revisao tr  ON tr.processo_id = p.id
LEFT JOIN analises a          ON a.processo_id = p.id
LEFT JOIN snapshots s         ON s.processo_id = p.id
GROUP BY p.id, u.nome;

CREATE OR REPLACE VIEW v_jobs_fila AS
SELECT
    tipo,
    status,
    COUNT(*)                                                    AS total,
    AVG(EXTRACT(EPOCH FROM (finished_at - started_at)))::INT    AS avg_seg,
    MIN(created_at)                                             AS mais_antigo
FROM jobs
GROUP BY tipo, status
ORDER BY tipo, status;
