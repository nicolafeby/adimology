-- Additive, versioned execution audit. The migration runner executes this once;
-- IF NOT EXISTS also makes the column additions safe to replay manually.
ALTER TABLE signal_outcomes
  ADD COLUMN IF NOT EXISTS backtest_config_version TEXT,
  ADD COLUMN IF NOT EXISTS execution_model TEXT,
  ADD COLUMN IF NOT EXISTS entry_triggered BOOLEAN,
  ADD COLUMN IF NOT EXISTS entry_date DATE,
  ADD COLUMN IF NOT EXISTS raw_entry_price NUMERIC,
  ADD COLUMN IF NOT EXISTS executed_entry_price NUMERIC,
  ADD COLUMN IF NOT EXISTS raw_exit_price NUMERIC,
  ADD COLUMN IF NOT EXISTS executed_exit_price NUMERIC,
  ADD COLUMN IF NOT EXISTS exit_date DATE,
  ADD COLUMN IF NOT EXISTS exit_reason TEXT,
  ADD COLUMN IF NOT EXISTS shares BIGINT,
  ADD COLUMN IF NOT EXISTS lots NUMERIC,
  ADD COLUMN IF NOT EXISTS calculation_basis TEXT,
  ADD COLUMN IF NOT EXISTS buy_fee NUMERIC,
  ADD COLUMN IF NOT EXISTS sell_fee NUMERIC,
  ADD COLUMN IF NOT EXISTS entry_slippage_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS exit_slippage_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS slippage_source TEXT,
  ADD COLUMN IF NOT EXISTS gross_pnl NUMERIC,
  ADD COLUMN IF NOT EXISTS net_pnl NUMERIC,
  ADD COLUMN IF NOT EXISTS gross_return_percent DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS net_return_percent DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS initial_risk NUMERIC,
  ADD COLUMN IF NOT EXISTS r_multiple DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS mfe NUMERIC,
  ADD COLUMN IF NOT EXISTS mae NUMERIC,
  ADD COLUMN IF NOT EXISTS mfe_percent DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS mae_percent DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS mfe_r DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS mae_r DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS holding_sessions INTEGER,
  ADD COLUMN IF NOT EXISTS is_ambiguous BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ambiguity_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_config_execution
  ON signal_outcomes(backtest_config_version, execution_model, exit_reason);

-- Preserve legacy evaluations while allowing the same immutable snapshot to be
-- evaluated under a new explicit config without overwriting prior results.
UPDATE signal_outcomes SET backtest_config_version = 'legacy-v1'
  WHERE backtest_config_version IS NULL;
ALTER TABLE signal_outcomes ALTER COLUMN backtest_config_version SET DEFAULT 'legacy-v1';
ALTER TABLE signal_outcomes ALTER COLUMN backtest_config_version SET NOT NULL;
ALTER TABLE signal_outcomes DROP CONSTRAINT IF EXISTS signal_outcomes_snapshot_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_outcomes_snapshot_config
  ON signal_outcomes(snapshot_id, backtest_config_version);
