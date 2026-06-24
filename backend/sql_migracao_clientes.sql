-- ============================================================
-- Migração: Módulo de Clientes
-- Execute no SQL Editor do Supabase
-- ============================================================

-- 1. Tabela principal de clientes
CREATE TABLE IF NOT EXISTS clientes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         TEXT        NOT NULL,
  tipo         TEXT        NOT NULL DEFAULT 'pf',   -- pf | pj
  cpf_cnpj     TEXT,
  email        TEXT,
  telefone     TEXT,
  endereco     TEXT,
  observacoes  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS clientes_nome_idx ON clientes(nome);

-- 2. Vincula processos a clientes
ALTER TABLE processos
  ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS processos_cliente_idx ON processos(cliente_id);

-- 3. View auxiliar: resumo de clientes com contagens
CREATE OR REPLACE VIEW v_clientes AS
SELECT
  c.*,
  COUNT(DISTINCT p.id)                                       AS total_processos,
  COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'ativo')    AS processos_ativos,
  MAX(p.updated_at)                                          AS ultima_movimentacao
FROM clientes c
LEFT JOIN processos p ON p.cliente_id = c.id
GROUP BY c.id;
