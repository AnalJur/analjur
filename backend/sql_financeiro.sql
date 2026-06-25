-- ═══════════════════════════════════════════════════════════════════
--  MÓDULO FINANCEIRO — AnalJur
--  Execute este script no Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════

-- ── Contratos de honorários ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS honorarios (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  cliente_id      UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  processo_id     UUID REFERENCES processos(id) ON DELETE SET NULL,
  tipo            VARCHAR(20) NOT NULL DEFAULT 'fixo'
                  CHECK (tipo IN ('fixo','exito','parcelas','hora')),
  descricao       TEXT,
  valor_total     DECIMAL(12,2) NOT NULL DEFAULT 0,
  percentual_exito DECIMAL(5,2),        -- % para tipo=exito
  valor_causa     DECIMAL(12,2),        -- base para calcular êxito
  status          VARCHAR(20) NOT NULL DEFAULT 'ativo'
                  CHECK (status IN ('ativo','quitado','suspenso','cancelado')),
  data_inicio     DATE NOT NULL DEFAULT CURRENT_DATE,
  data_fim        DATE,
  observacoes     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Parcelas dos honorários ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS parcelas_honorario (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  honorario_id    UUID NOT NULL REFERENCES honorarios(id) ON DELETE CASCADE,
  cliente_id      UUID NOT NULL,
  processo_id     UUID,
  numero_parcela  INTEGER NOT NULL DEFAULT 1,
  valor           DECIMAL(12,2) NOT NULL,
  vencimento      DATE NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'pendente'
                  CHECK (status IN ('pendente','pago','vencido','cancelado')),
  data_pagamento  DATE,
  valor_pago      DECIMAL(12,2),
  forma_pagamento VARCHAR(20) CHECK (forma_pagamento IN ('pix','ted','boleto','dinheiro','cartao','outro')),
  observacoes     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Índices ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_honorarios_cliente    ON honorarios(cliente_id);
CREATE INDEX IF NOT EXISTS idx_honorarios_processo   ON honorarios(processo_id);
CREATE INDEX IF NOT EXISTS idx_honorarios_status     ON honorarios(status);
CREATE INDEX IF NOT EXISTS idx_parcelas_honorario_id ON parcelas_honorario(honorario_id);
CREATE INDEX IF NOT EXISTS idx_parcelas_vencimento   ON parcelas_honorario(vencimento);
CREATE INDEX IF NOT EXISTS idx_parcelas_status       ON parcelas_honorario(status);
CREATE INDEX IF NOT EXISTS idx_parcelas_cliente      ON parcelas_honorario(cliente_id);

-- ── Atualiza status de parcelas vencidas automaticamente ─────────
-- (Execute como cron ou trigger; aqui como função utilitária)
CREATE OR REPLACE FUNCTION atualizar_parcelas_vencidas()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE atualizado INTEGER;
BEGIN
  UPDATE parcelas_honorario
  SET status = 'vencido', updated_at = NOW()
  WHERE status = 'pendente' AND vencimento < CURRENT_DATE;
  GET DIAGNOSTICS atualizado = ROW_COUNT;
  RETURN atualizado;
END;
$$;

-- Execute agora para parcelas já vencidas
SELECT atualizar_parcelas_vencidas();
