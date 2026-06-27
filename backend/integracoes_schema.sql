-- ============================================================
-- AnalJur — Integração com sistemas externos (Gestor 360 etc.)
-- Execute no Supabase SQL Editor
-- ============================================================

-- ── Chaves de API por sistema integrado ──────────────────────
CREATE TABLE IF NOT EXISTS integracoes_chaves (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sistema      TEXT NOT NULL,
  nome         TEXT NOT NULL,
  chave_hash   TEXT NOT NULL,
  hmac_secret  TEXT NOT NULL,
  ativo        BOOLEAN DEFAULT true,
  permissoes   TEXT[] DEFAULT '{read,webhook_receive,webhook_send}',
  expires_at   TIMESTAMPTZ,
  ultimo_uso   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chaves_hash
  ON integracoes_chaves(chave_hash)
  WHERE ativo = true;

-- ── Mapeamento bilateral ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS integracoes_externas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origem_sistema   TEXT NOT NULL,
  origem_tipo      TEXT NOT NULL,
  origem_id        TEXT NOT NULL,
  destino_sistema  TEXT NOT NULL,
  destino_tipo     TEXT NOT NULL,
  destino_id       TEXT,
  idempotency_key  TEXT,
  status           TEXT NOT NULL DEFAULT 'pendente',
  ultimo_sync      TIMESTAMPTZ,
  dados_enviados   JSONB,
  dados_retorno    JSONB,
  erro             TEXT,
  tentativas       INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_integracao_origem
    UNIQUE(origem_sistema, origem_tipo, origem_id)
);

-- Índice parcial: unicidade de destino só quando preenchido
CREATE UNIQUE INDEX IF NOT EXISTS uq_integracao_destino
  ON integracoes_externas(destino_sistema, destino_tipo, destino_id)
  WHERE destino_id IS NOT NULL;

-- ── Fila de eventos ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integracoes_eventos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integracao_id   UUID REFERENCES integracoes_externas(id) ON DELETE CASCADE,
  event_id        TEXT NOT NULL,
  correlation_id  TEXT,
  evento          TEXT NOT NULL,
  direcao         TEXT NOT NULL DEFAULT 'enviado',
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pendente',
  tentativas      INT NOT NULL DEFAULT 0,
  proximo_retry   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  http_status     INT,
  erro            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processado_at   TIMESTAMPTZ,

  CONSTRAINT uq_event_id UNIQUE(event_id)
);

CREATE INDEX IF NOT EXISTS idx_eventos_fila
  ON integracoes_eventos(status, proximo_retry)
  WHERE status IN ('pendente', 'erro');

-- Trigger: atualiza updated_at em integracoes_externas
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_integracao_updated_at ON integracoes_externas;
CREATE TRIGGER trg_integracao_updated_at
  BEFORE UPDATE ON integracoes_externas
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
