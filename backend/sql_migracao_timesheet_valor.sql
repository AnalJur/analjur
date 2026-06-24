-- ============================================================
-- Migração: Timesheet com valor financeiro
-- Execute no SQL Editor do Supabase
-- ============================================================

ALTER TABLE timesheet
  ADD COLUMN IF NOT EXISTS valor_hora  DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_total DECIMAL(10,2) NOT NULL DEFAULT 0;
