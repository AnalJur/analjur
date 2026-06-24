-- ============================================================
-- Migração: Atendimentos + Timesheet
-- Execute no SQL Editor do Supabase (Settings → SQL Editor)
-- ============================================================

-- Tabela de atendimentos (reuniões, calls, presenciais)
CREATE TABLE IF NOT EXISTS atendimentos (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_id          UUID        NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
  data_atendimento     DATE        NOT NULL DEFAULT CURRENT_DATE,
  tipo                 TEXT        NOT NULL DEFAULT 'presencial',
  duracao_min          INTEGER     NOT NULL DEFAULT 60,
  assunto              TEXT        NOT NULL,
  anotacoes            TEXT,
  participantes        TEXT,
  documentos_vinculados JSONB      NOT NULL DEFAULT '[]'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS atendimentos_processo_idx
  ON atendimentos(processo_id);

-- Tabela de timesheet (lançamentos de horas por processo/tarefa)
CREATE TABLE IF NOT EXISTS timesheet (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_id       UUID        NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
  tarefa_id         UUID        REFERENCES tarefas_revisao(id) ON DELETE SET NULL,
  descricao         TEXT        NOT NULL,
  tipo              TEXT        NOT NULL DEFAULT 'trabalho',
  duracao_min       INTEGER     NOT NULL DEFAULT 60,
  data_lancamento   DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS timesheet_processo_idx
  ON timesheet(processo_id);

CREATE INDEX IF NOT EXISTS timesheet_tarefa_idx
  ON timesheet(tarefa_id);
