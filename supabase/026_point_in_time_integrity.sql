-- Additive point-in-time provenance contract. Existing rows are explicitly unverified.
ALTER TABLE screening_runs
  ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'legacy_unverified' CHECK (execution_mode IN ('live','historical_replay','legacy_unverified')),
  ADD COLUMN IF NOT EXISTS screened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS information_cutoff_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS market_timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  ADD COLUMN IF NOT EXISTS market_session TEXT NOT NULL DEFAULT 'unknown' CHECK (market_session IN ('pre_open','intraday','post_close','unknown')),
  ADD COLUMN IF NOT EXISTS data_policy_version TEXT,
  ADD COLUMN IF NOT EXISTS point_in_time_status TEXT NOT NULL DEFAULT 'legacy_unverified' CHECK (point_in_time_status IN ('valid','invalid','partial','legacy_unverified')),
  ADD COLUMN IF NOT EXISTS point_in_time_warnings JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE screening_results
  ADD COLUMN IF NOT EXISTS feature_cutoff_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS point_in_time_valid BOOLEAN,
  ADD COLUMN IF NOT EXISTS point_in_time_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_provenance JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS backtest_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS backtest_ineligibility_reasons JSONB NOT NULL DEFAULT '[{"code":"LEGACY_UNVERIFIED","message":"No point-in-time provenance"}]'::jsonb;

ALTER TABLE signal_snapshots
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES screening_runs(id),
  ADD COLUMN IF NOT EXISTS information_cutoff_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'legacy_unverified',
  ADD COLUMN IF NOT EXISTS data_policy_version TEXT,
  ADD COLUMN IF NOT EXISTS point_in_time_valid BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS source_provenance JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS backtest_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS backtest_ineligibility_reasons JSONB NOT NULL DEFAULT '[{"code":"LEGACY_UNVERIFIED","message":"No point-in-time provenance"}]'::jsonb;
ALTER TABLE signal_snapshots DROP CONSTRAINT IF EXISTS signal_snapshots_signal_date_symbol_model_version_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_snapshots_run_symbol_model ON signal_snapshots(run_id,symbol,model_version) WHERE run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS source_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), run_id UUID NOT NULL REFERENCES screening_runs(id), symbol TEXT NOT NULL,
  source TEXT NOT NULL, data_type TEXT NOT NULL, payload JSONB, provider_reference TEXT, content_hash TEXT,
  effective_at TIMESTAMPTZ, published_at TIMESTAMPTZ, observed_at TIMESTAMPTZ, fetched_at TIMESTAMPTZ NOT NULL, available_at TIMESTAMPTZ,
  period_start TIMESTAMPTZ, period_end TIMESTAMPTZ, is_historical_snapshot BOOLEAN NOT NULL,
  temporal_validation_status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_source_snapshots_replay ON source_snapshots(symbol,data_type,available_at,run_id);
CREATE OR REPLACE FUNCTION reject_source_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'source snapshots are append-only'; END $$;
DROP TRIGGER IF EXISTS trg_source_snapshots_append_only ON source_snapshots;
CREATE TRIGGER trg_source_snapshots_append_only BEFORE UPDATE OR DELETE ON source_snapshots FOR EACH ROW EXECUTE FUNCTION reject_source_snapshot_mutation();

CREATE OR REPLACE FUNCTION claim_screening_run(p_run JSONB)
RETURNS TABLE(id UUID, reused BOOLEAN) LANGUAGE plpgsql AS $$
DECLARE v_existing UUID; v_id UUID := (p_run->>'id')::UUID;
BEGIN
  IF NULLIF(p_run->>'idempotency_key','') IS NOT NULL THEN
    SELECT r.id INTO v_existing FROM screening_runs r WHERE r.idempotency_key=p_run->>'idempotency_key' AND r.status='running' LIMIT 1;
    IF v_existing IS NOT NULL THEN RETURN QUERY SELECT v_existing,TRUE; RETURN; END IF;
  END IF;
  INSERT INTO screening_runs(id,analysis_date,status,quantitative_status,enrichment_status,universe_count,universe_size,started_at,screened_at,information_cutoff_at,market_timezone,market_session,execution_mode,data_policy_version,point_in_time_status,trigger_source,requested_by,idempotency_key,configuration_version,eligibility_config_version,ranking_model_version,methodology_version)
  VALUES(v_id,(p_run->>'analysis_date')::DATE,'running','not_started','not_started',0,0,(p_run->>'started_at')::TIMESTAMPTZ,(p_run->>'screened_at')::TIMESTAMPTZ,(p_run->>'information_cutoff_at')::TIMESTAMPTZ,COALESCE(p_run->>'market_timezone','Asia/Jakarta'),COALESCE(p_run->>'market_session','unknown'),COALESCE(p_run->>'execution_mode','legacy_unverified'),p_run->>'data_policy_version',COALESCE(p_run->>'point_in_time_status','legacy_unverified'),COALESCE(p_run->>'trigger_source','api'),p_run->>'requested_by',p_run->>'idempotency_key',p_run->>'configuration_version',p_run->>'eligibility_config_version',p_run->>'ranking_model_version',p_run->>'methodology_version');
  RETURN QUERY SELECT v_id,FALSE;
END $$;

-- Prevent predictive fields and provenance from being rewritten after insert.
CREATE OR REPLACE FUNCTION protect_signal_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.score,NEW.signal,NEW.entry_price,NEW.target_price,NEW.stop_price,NEW.feature_snapshot,NEW.model_version,NEW.methodology_version,NEW.information_cutoff_at,NEW.source_provenance,NEW.point_in_time_valid,NEW.backtest_eligible)
     IS DISTINCT FROM ROW(OLD.score,OLD.signal,OLD.entry_price,OLD.target_price,OLD.stop_price,OLD.feature_snapshot,OLD.model_version,OLD.methodology_version,OLD.information_cutoff_at,OLD.source_provenance,OLD.point_in_time_valid,OLD.backtest_eligible) THEN
    RAISE EXCEPTION 'signal snapshot predictive fields are immutable; create a revision';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_signal_snapshot_immutable ON signal_snapshots;
CREATE TRIGGER trg_signal_snapshot_immutable BEFORE UPDATE ON signal_snapshots FOR EACH ROW EXECUTE FUNCTION protect_signal_snapshot_immutable();
