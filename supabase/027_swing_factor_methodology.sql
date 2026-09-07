-- Additive v2 factor audit contract. Legacy rows retain NULL versions and are
-- never interpreted as swing-v1 snapshots.
ALTER TABLE screening_results
  ADD COLUMN IF NOT EXISTS strategy_profile TEXT,
  ADD COLUMN IF NOT EXISTS strategy_profile_version TEXT,
  ADD COLUMN IF NOT EXISTS factor_config_version TEXT,
  ADD COLUMN IF NOT EXISTS execution_policy_version TEXT,
  ADD COLUMN IF NOT EXISTS liquidity_policy_version TEXT,
  ADD COLUMN IF NOT EXISTS broker_flow_policy_version TEXT,
  ADD COLUMN IF NOT EXISTS sector_peer_policy_version TEXT,
  ADD COLUMN IF NOT EXISTS factor_breakdown JSONB,
  ADD COLUMN IF NOT EXISTS execution_scenarios JSONB;

ALTER TABLE signal_snapshots
  ADD COLUMN IF NOT EXISTS strategy_profile TEXT,
  ADD COLUMN IF NOT EXISTS strategy_profile_version TEXT,
  ADD COLUMN IF NOT EXISTS factor_config_version TEXT;

COMMENT ON COLUMN screening_results.execution_scenarios IS 'Non-personal notional scenarios; depth volumes normalized to shares.';
COMMENT ON COLUMN screening_results.factor_breakdown IS 'Immutable-with-decision factor metadata stored by methodology version.';
