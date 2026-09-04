-- Additive calibration context. NULL deliberately identifies legacy snapshots.
ALTER TABLE signal_snapshots
  ADD COLUMN IF NOT EXISTS market_regime TEXT,
  ADD COLUMN IF NOT EXISTS market_regime_score DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS regime_methodology_version TEXT,
  ADD COLUMN IF NOT EXISTS benchmark_observed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS execution_model TEXT,
  ADD COLUMN IF NOT EXISTS outcome_definition TEXT,
  ADD COLUMN IF NOT EXISTS selection_scope TEXT,
  ADD COLUMN IF NOT EXISTS selection_stage TEXT,
  ADD COLUMN IF NOT EXISTS selection_reason TEXT,
  ADD COLUMN IF NOT EXISTS pre_screen_passed BOOLEAN;
ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS outcome_definition TEXT;
ALTER TABLE stock_rankings ADD COLUMN IF NOT EXISTS probability_calibration JSONB;
CREATE INDEX IF NOT EXISTS idx_signal_snapshots_calibration_context ON signal_snapshots(model_version, methodology_version, execution_model, outcome_definition, selection_scope, market_regime, signal_date, score);
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_calibration_context ON signal_outcomes(execution_model, outcome_definition, evaluated_at, snapshot_id) WHERE entry_triggered = TRUE AND is_ambiguous = FALSE AND net_return_percent IS NOT NULL;
ALTER TABLE signal_snapshots DROP CONSTRAINT IF EXISTS signal_snapshots_market_regime_check;
ALTER TABLE signal_snapshots ADD CONSTRAINT signal_snapshots_market_regime_check CHECK (market_regime IS NULL OR market_regime IN ('bullish', 'neutral', 'bearish', 'unavailable'));
