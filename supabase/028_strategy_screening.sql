-- Strategy identity is explicit. No blanket SWING backfill: legacy stays unverified.
ALTER TABLE screening_runs
 ADD COLUMN IF NOT EXISTS strategy_id TEXT CHECK (strategy_id IN ('bpjs','bsjp','swing','ara')),
 ADD COLUMN IF NOT EXISTS strategy_version TEXT,
 ADD COLUMN IF NOT EXISTS execution_model TEXT,
 ADD COLUMN IF NOT EXISTS outcome_definition TEXT,
 ADD COLUMN IF NOT EXISTS strategy_support JSONB NOT NULL DEFAULT '{"level":"unavailable","reasons":["Legacy strategy provenance missing"]}'::jsonb,
 ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;
ALTER TABLE screening_runs DROP CONSTRAINT IF EXISTS screening_runs_market_session_check;
ALTER TABLE screening_runs ADD CONSTRAINT screening_runs_market_session_check CHECK (market_session IN ('pre_open','intraday','post_close','break','auction','closed','unknown'));
ALTER TABLE screening_results
 ADD COLUMN IF NOT EXISTS strategy_id TEXT CHECK (strategy_id IN ('bpjs','bsjp','swing','ara')),
 ADD COLUMN IF NOT EXISTS strategy_version TEXT,
 ADD COLUMN IF NOT EXISTS configuration_version TEXT,
 ADD COLUMN IF NOT EXISTS execution_model TEXT,
 ADD COLUMN IF NOT EXISTS outcome_definition TEXT,
 ADD COLUMN IF NOT EXISTS strategy_support JSONB,
 ADD COLUMN IF NOT EXISTS monitoring JSONB,
 ADD COLUMN IF NOT EXISTS signal_valid_until TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS news_enrichment JSONB,
 ADD COLUMN IF NOT EXISTS strategy_assessment JSONB;
ALTER TABLE signal_snapshots
 ADD COLUMN IF NOT EXISTS strategy_id TEXT CHECK (strategy_id IN ('bpjs','bsjp','swing','ara')),
 ADD COLUMN IF NOT EXISTS strategy_version TEXT,
 ADD COLUMN IF NOT EXISTS configuration_version TEXT;
ALTER TABLE source_snapshots
 ADD COLUMN IF NOT EXISTS strategy_id TEXT CHECK (strategy_id IN ('bpjs','bsjp','swing','ara')),
 ADD COLUMN IF NOT EXISTS strategy_version TEXT,
 ADD COLUMN IF NOT EXISTS configuration_version TEXT,
 ADD COLUMN IF NOT EXISTS execution_model TEXT,
 ADD COLUMN IF NOT EXISTS outcome_definition TEXT;
ALTER TABLE signal_outcomes
 ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'legacy_unverified' CHECK (execution_mode IN ('live','historical_replay','legacy_unverified')),
 ADD COLUMN IF NOT EXISTS horizon_outcomes JSONB,
 ADD COLUMN IF NOT EXISTS strategy_id TEXT CHECK (strategy_id IN ('bpjs','bsjp','swing','ara')),
 ADD COLUMN IF NOT EXISTS strategy_version TEXT,
 ADD COLUMN IF NOT EXISTS configuration_version TEXT;
CREATE INDEX IF NOT EXISTS idx_strategy_runs_latest ON screening_runs(strategy_id,analysis_date DESC,started_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_snapshot_calibration ON signal_snapshots(strategy_id,strategy_version,configuration_version,execution_model,outcome_definition,execution_mode,signal_date) WHERE point_in_time_valid AND backtest_eligible;
CREATE INDEX IF NOT EXISTS idx_strategy_outcomes ON signal_outcomes(strategy_id,strategy_version,configuration_version);
-- Existing active index remains compatible: app keys are cryptographically scoped.
CREATE UNIQUE INDEX IF NOT EXISTS idx_strategy_run_request ON screening_runs(strategy_id,idempotency_key) WHERE strategy_id IS NOT NULL AND idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS screening_enrichments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), run_id UUID NOT NULL REFERENCES screening_runs(id), symbol TEXT NOT NULL,
 strategy_id TEXT NOT NULL CHECK (strategy_id IN ('bpjs','bsjp','swing','ara')), strategy_version TEXT NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('news','ai')), payload JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), FOREIGN KEY(run_id,symbol) REFERENCES screening_results(run_id,symbol)
);
CREATE INDEX IF NOT EXISTS idx_screening_enrichment_latest ON screening_enrichments(run_id,symbol,kind,created_at DESC);
ALTER TABLE screening_enrichments ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS trg_screening_enrichments_append_only ON screening_enrichments;
CREATE TRIGGER trg_screening_enrichments_append_only BEFORE UPDATE OR DELETE ON screening_enrichments FOR EACH ROW EXECUTE FUNCTION reject_source_snapshot_mutation();

CREATE OR REPLACE FUNCTION claim_screening_run(p_run JSONB)
RETURNS TABLE(id UUID, reused BOOLEAN) LANGUAGE plpgsql AS $$
DECLARE v_existing UUID; v_id UUID := (p_run->>'id')::UUID; v_key TEXT := NULLIF(p_run->>'idempotency_key','');
BEGIN
 IF p_run->>'strategy_id' IS NULL OR p_run->>'strategy_id' NOT IN ('bpjs','bsjp','swing','ara') OR NULLIF(p_run->>'strategy_version','') IS NULL THEN RAISE EXCEPTION 'Strategy identity required'; END IF;
 -- Transaction advisory lock closes concurrent SELECT/INSERT race including terminal retries.
 IF v_key IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended((p_run->>'strategy_id') || ':' || v_key,0));
  SELECT r.id INTO v_existing FROM screening_runs r WHERE r.strategy_id=p_run->>'strategy_id' AND r.idempotency_key=v_key LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN QUERY SELECT v_existing,TRUE; RETURN; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('screening_active_capacity',0));
 IF (SELECT count(*) FROM screening_runs WHERE status='running') >= 4 THEN RAISE EXCEPTION 'SCREENING_CAPACITY_REACHED'; END IF;
 INSERT INTO screening_runs(id,analysis_date,status,quantitative_status,enrichment_status,universe_count,universe_size,started_at,screened_at,information_cutoff_at,market_timezone,market_session,execution_mode,data_policy_version,point_in_time_status,trigger_source,requested_by,idempotency_key,configuration_version,eligibility_config_version,ranking_model_version,methodology_version,strategy_id,strategy_version,execution_model,outcome_definition,strategy_support,request_fingerprint)
 VALUES(v_id,(p_run->>'analysis_date')::DATE,'running','not_started','not_started',0,0,(p_run->>'started_at')::TIMESTAMPTZ,(p_run->>'screened_at')::TIMESTAMPTZ,(p_run->>'information_cutoff_at')::TIMESTAMPTZ,COALESCE(p_run->>'market_timezone','Asia/Jakarta'),COALESCE(p_run->>'market_session','unknown'),COALESCE(p_run->>'execution_mode','legacy_unverified'),p_run->>'data_policy_version',COALESCE(p_run->>'point_in_time_status','legacy_unverified'),COALESCE(p_run->>'trigger_source','api'),p_run->>'requested_by',v_key,p_run->>'configuration_version',p_run->>'eligibility_config_version',p_run->>'ranking_model_version',p_run->>'methodology_version',p_run->>'strategy_id',p_run->>'strategy_version',p_run->>'execution_model',p_run->>'outcome_definition',COALESCE(p_run->'strategy_support','{}'::jsonb),p_run->>'request_fingerprint');
 RETURN QUERY SELECT v_id,FALSE;
END $$;

CREATE OR REPLACE FUNCTION mark_stale_screening_runs(p_timeout_minutes INTEGER DEFAULT 15)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE v_count INTEGER;
BEGIN
 WITH stale AS (
 UPDATE screening_runs SET status=CASE WHEN quantitative_status IN ('completed','partial') THEN 'partial' ELSE 'failed' END,
 quantitative_status=CASE WHEN quantitative_status IN ('completed','partial') THEN quantitative_status ELSE 'failed' END,
 enrichment_status=CASE WHEN enrichment_status='processing' THEN 'failed' ELSE enrichment_status END,
 completed_at=NOW(),updated_at=NOW(),error_summary='[{"code":"RUN_INTERRUPTED","retryable":true,"safe_message":"Run terputus. Hasil yang tersimpan tetap tersedia; jalankan ulang untuk data baru."}]'::jsonb
 WHERE status='running' AND updated_at < NOW() - make_interval(mins => GREATEST(5,p_timeout_minutes)) RETURNING id)
 SELECT count(*) INTO v_count FROM stale;
 UPDATE screening_results SET terminal_status='processing_error',screening_status='processing_error',quantitative_status='failed',error_code='RUN_INTERRUPTED',error_message='Run terputus sebelum item selesai.',completed_at=NOW()
 WHERE terminal_status='pending' AND run_id IN (SELECT r.id FROM screening_runs r WHERE r.status='failed');
 RETURN v_count;
END $$;

-- A completed quantitative decision cannot be rewritten by enrichment or a retry.
CREATE OR REPLACE FUNCTION protect_screening_result_prediction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.quantitative_status='completed' OR OLD.terminal_status IN ('completed','filtered_out','skipped') THEN
  IF (to_jsonb(NEW) - ARRAY['ai_status','ai_enrichment','ai_source','ai_requested_at','ai_completed_at','ai_error','news_enrichment','updated_at','current_stage']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['ai_status','ai_enrichment','ai_source','ai_requested_at','ai_completed_at','ai_error','news_enrichment','updated_at','current_stage'])
  THEN RAISE EXCEPTION 'screening quantitative snapshot is immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_screening_result_prediction ON screening_results;
CREATE TRIGGER trg_screening_result_prediction BEFORE UPDATE ON screening_results FOR EACH ROW EXECUTE FUNCTION protect_screening_result_prediction();
CREATE OR REPLACE FUNCTION protect_signal_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'signal snapshot is immutable; append outcome or revision separately'; END IF;
 RETURN NEW;
END $$;
COMMENT ON COLUMN screening_runs.strategy_id IS 'NULL means legacy provenance unverified; do not infer identity from date/symbol.';

DROP TRIGGER IF EXISTS trg_signal_snapshot_no_delete ON signal_snapshots;
CREATE TRIGGER trg_signal_snapshot_no_delete BEFORE DELETE ON signal_snapshots FOR EACH ROW EXECUTE FUNCTION reject_source_snapshot_mutation();
GRANT SELECT,INSERT ON screening_enrichments TO service_role;
REVOKE ALL ON FUNCTION claim_screening_run(JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION claim_screening_run(JSONB) TO service_role;
REVOKE ALL ON FUNCTION mark_stale_screening_runs(INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION mark_stale_screening_runs(INTEGER) TO service_role;
-- NOT VALID preserves legacy anomalies while enforcing the invariant for new rows.
ALTER TABLE screening_results DROP CONSTRAINT IF EXISTS screening_results_strategy_rank_check;
ALTER TABLE screening_results ADD CONSTRAINT screening_results_strategy_rank_check CHECK (strategy_id IS NULL OR screening_status='passed' OR (ranking_position IS NULL AND ranking_score IS NULL AND ranking IS NULL)) NOT VALID;
CREATE OR REPLACE FUNCTION enforce_screening_strategy_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r screening_runs%ROWTYPE;
BEGIN
 IF NEW.run_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO r FROM screening_runs WHERE id=NEW.run_id;
 IF r.strategy_id IS NOT NULL AND ROW(NEW.strategy_id,NEW.strategy_version,NEW.configuration_version,NEW.execution_model,NEW.outcome_definition) IS DISTINCT FROM ROW(r.strategy_id,r.strategy_version,r.configuration_version,r.execution_model,r.outcome_definition) THEN RAISE EXCEPTION 'Snapshot strategy identity does not match run'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_screening_strategy_identity ON screening_results;
CREATE TRIGGER trg_screening_strategy_identity BEFORE INSERT OR UPDATE ON screening_results FOR EACH ROW EXECUTE FUNCTION enforce_screening_strategy_identity();
DROP TRIGGER IF EXISTS trg_signal_strategy_identity ON signal_snapshots;
CREATE TRIGGER trg_signal_strategy_identity BEFORE INSERT OR UPDATE ON signal_snapshots FOR EACH ROW EXECUTE FUNCTION enforce_screening_strategy_identity();

CREATE TABLE IF NOT EXISTS strategy_outcome_archives (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), snapshot_id BIGINT NOT NULL REFERENCES signal_snapshots(id),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), archive JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_strategy_outcome_archive ON strategy_outcome_archives(snapshot_id,recorded_at DESC);
ALTER TABLE strategy_outcome_archives ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON strategy_outcome_archives TO service_role;
DROP TRIGGER IF EXISTS trg_strategy_outcome_archive_immutable ON strategy_outcome_archives;
CREATE TRIGGER trg_strategy_outcome_archive_immutable BEFORE UPDATE OR DELETE ON strategy_outcome_archives FOR EACH ROW EXECUTE FUNCTION reject_source_snapshot_mutation();
