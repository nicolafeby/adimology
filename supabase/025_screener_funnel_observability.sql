-- Additive, auditable screener funnel. screening_results remains the current-state
-- table so legacy readers keep working; screening_run_events is append-only.
ALTER TABLE screening_runs DROP CONSTRAINT IF EXISTS screening_runs_status_check;
ALTER TABLE screening_runs ADD CONSTRAINT screening_runs_status_check CHECK (status IN ('running', 'completed', 'partial', 'failed'));
ALTER TABLE screening_runs DROP CONSTRAINT IF EXISTS screening_runs_quantitative_status_check;
ALTER TABLE screening_runs ADD CONSTRAINT screening_runs_quantitative_status_check CHECK (quantitative_status IN ('not_started', 'processing', 'completed', 'partial', 'failed'));
ALTER TABLE screening_runs DROP CONSTRAINT IF EXISTS screening_runs_enrichment_status_check;
ALTER TABLE screening_runs ADD CONSTRAINT screening_runs_enrichment_status_check CHECK (enrichment_status IN ('not_started', 'processing', 'completed', 'partial', 'failed', 'skipped'));
ALTER TABLE screening_runs
  ADD COLUMN IF NOT EXISTS universe_source TEXT,
  ADD COLUMN IF NOT EXISTS universe_size INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS configuration_version TEXT,
  ADD COLUMN IF NOT EXISTS eligibility_config_version TEXT,
  ADD COLUMN IF NOT EXISTS ranking_model_version TEXT,
  ADD COLUMN IF NOT EXISTS methodology_version TEXT,
  ADD COLUMN IF NOT EXISTS trigger_source TEXT NOT NULL DEFAULT 'api',
  ADD COLUMN IF NOT EXISTS requested_by TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS error_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_screening_runs_active_trigger
  ON screening_runs(idempotency_key) WHERE status = 'running' AND idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_screening_runs_latest_usable ON screening_runs(completed_at DESC) WHERE status IN ('completed', 'partial');

ALTER TABLE screening_results
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS sector TEXT,
  ADD COLUMN IF NOT EXISTS current_stage TEXT NOT NULL DEFAULT 'universe',
  ADD COLUMN IF NOT EXISTS terminal_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS pre_screen_passed BOOLEAN,
  ADD COLUMN IF NOT EXISTS pre_screen_score NUMERIC,
  ADD COLUMN IF NOT EXISTS pre_screen_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS selected_for_quantitative BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS quantitative_status TEXT NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS data_completeness NUMERIC,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS selected_for_ai BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS failure_stage TEXT,
  ADD COLUMN IF NOT EXISTS error_code TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE screening_results ALTER COLUMN screening_status DROP NOT NULL;

ALTER TABLE screening_results DROP CONSTRAINT IF EXISTS screening_results_current_stage_check;
ALTER TABLE screening_results ADD CONSTRAINT screening_results_current_stage_check CHECK (current_stage IN ('universe','data_acquisition','pre_screen','quantitative_selection','quantitative_analysis','eligibility','ranking','persisted','ai_enrichment','completed'));
ALTER TABLE screening_results DROP CONSTRAINT IF EXISTS screening_results_terminal_status_check;
ALTER TABLE screening_results ADD CONSTRAINT screening_results_terminal_status_check CHECK (terminal_status IN ('completed','filtered_out','processing_error','skipped','pending'));
ALTER TABLE screening_results DROP CONSTRAINT IF EXISTS screening_results_quantitative_status_check;
ALTER TABLE screening_results ADD CONSTRAINT screening_results_quantitative_status_check CHECK (quantitative_status IN ('not_started','processing','completed','failed','skipped'));
CREATE INDEX IF NOT EXISTS idx_screening_results_stage ON screening_results(run_id,current_stage);
CREATE INDEX IF NOT EXISTS idx_screening_results_terminal ON screening_results(run_id,terminal_status);
CREATE INDEX IF NOT EXISTS idx_screening_results_symbol_journey ON screening_results(symbol,run_id);

CREATE TABLE IF NOT EXISTS screening_run_events (
  id BIGSERIAL PRIMARY KEY, run_id UUID NOT NULL REFERENCES screening_runs(id) ON DELETE CASCADE,
  symbol TEXT, stage TEXT NOT NULL, event_type TEXT NOT NULL, status TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb, idempotency_key TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(run_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_screening_events_run_time ON screening_run_events(run_id,occurred_at);
CREATE INDEX IF NOT EXISTS idx_screening_events_symbol_time ON screening_run_events(run_id,symbol,occurred_at) WHERE symbol IS NOT NULL;

CREATE OR REPLACE FUNCTION claim_screening_run(p_run JSONB)
RETURNS TABLE(id UUID, reused BOOLEAN) LANGUAGE plpgsql AS $$
DECLARE v_existing UUID; v_id UUID := (p_run->>'id')::UUID;
BEGIN
  IF NULLIF(p_run->>'idempotency_key','') IS NOT NULL THEN
    SELECT r.id INTO v_existing FROM screening_runs r WHERE r.idempotency_key=p_run->>'idempotency_key' AND r.status='running' LIMIT 1;
    IF v_existing IS NOT NULL THEN RETURN QUERY SELECT v_existing, TRUE; RETURN; END IF;
  END IF;
  INSERT INTO screening_runs(id,analysis_date,status,quantitative_status,enrichment_status,universe_count,universe_size,started_at,trigger_source,requested_by,idempotency_key,configuration_version,eligibility_config_version,ranking_model_version,methodology_version)
  VALUES(v_id,(p_run->>'analysis_date')::DATE,'running','not_started','not_started',0,0,(p_run->>'started_at')::TIMESTAMPTZ,COALESCE(p_run->>'trigger_source','api'),p_run->>'requested_by',p_run->>'idempotency_key',p_run->>'configuration_version',p_run->>'eligibility_config_version',p_run->>'ranking_model_version',p_run->>'methodology_version');
  RETURN QUERY SELECT v_id,FALSE;
END $$;

CREATE OR REPLACE FUNCTION mark_stale_screening_runs(p_timeout_minutes INTEGER DEFAULT 120)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE screening_runs SET status='failed',quantitative_status='failed',completed_at=NOW(),updated_at=NOW(),error_summary='[{"code":"UNKNOWN_PROCESSING_ERROR","stage":"universe","retryable":true,"safe_message":"Run exceeded the documented stale timeout."}]'::jsonb
  WHERE status='running' AND started_at < NOW() - make_interval(mins => p_timeout_minutes);
  GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count;
END $$;

COMMENT ON TABLE screening_run_events IS 'Append-only transition audit; retain 90 days or longer by an explicit operator policy. No automatic deletion.';
COMMENT ON COLUMN screening_runs.idempotency_key IS 'Protects duplicate concurrent triggers only while a run is active; same-date completed runs remain independent.';
