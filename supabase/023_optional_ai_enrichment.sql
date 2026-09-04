ALTER TABLE screening_runs
  ADD COLUMN IF NOT EXISTS quantitative_status TEXT NOT NULL DEFAULT 'completed'
    CHECK (quantitative_status IN ('completed', 'partial', 'failed')),
  ADD COLUMN IF NOT EXISTS enrichment_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (enrichment_status IN ('not_started', 'processing', 'completed', 'partial', 'failed'));

ALTER TABLE screening_results
  ADD COLUMN IF NOT EXISTS ai_status TEXT NOT NULL DEFAULT 'not_requested'
    CHECK (ai_status IN ('not_requested', 'pending', 'processing', 'completed', 'failed', 'stale')),
  ADD COLUMN IF NOT EXISTS ai_enrichment JSONB,
  ADD COLUMN IF NOT EXISTS ai_source TEXT CHECK (ai_source IN ('cache', 'generated')),
  ADD COLUMN IF NOT EXISTS ai_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_error TEXT;

CREATE OR REPLACE FUNCTION commit_screening_run(p_run JSONB, p_results JSONB)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_id UUID := (p_run->>'id')::UUID;
BEGIN
  INSERT INTO screening_runs(id, analysis_date, status, universe_count, started_at, completed_at, quantitative_status, enrichment_status)
  VALUES (v_id, (p_run->>'analysis_date')::DATE, 'running', (p_run->>'universe_count')::INTEGER, (p_run->>'started_at')::TIMESTAMPTZ, NULL,
    COALESCE(p_run->>'quantitative_status', 'completed'), COALESCE(p_run->>'enrichment_status', 'not_started'))
  ON CONFLICT (id) DO UPDATE SET quantitative_status = EXCLUDED.quantitative_status, enrichment_status = EXCLUDED.enrichment_status;
  INSERT INTO screening_results(run_id, symbol, analysis_date, screening_status, passed_rules, failed_rules, selection_stage, data_quality, evaluated_at, ranking, ai_status, ai_enrichment, ai_source, ai_requested_at, ai_completed_at, ai_error)
  SELECT v_id, x.symbol, x.analysis_date::DATE, x.screening_status, x.passed_rules, x.failed_rules, x.selection_stage, x.data_quality, x.evaluated_at::TIMESTAMPTZ, x.ranking,
    COALESCE(x.ai_status, 'not_requested'), x.ai_enrichment, x.ai_source, x.ai_requested_at::TIMESTAMPTZ, x.ai_completed_at::TIMESTAMPTZ, x.ai_error
  FROM jsonb_to_recordset(p_results) AS x(symbol TEXT, analysis_date TEXT, screening_status TEXT, passed_rules JSONB, failed_rules JSONB, selection_stage TEXT, data_quality JSONB, evaluated_at TEXT, ranking JSONB, ai_status TEXT, ai_enrichment JSONB, ai_source TEXT, ai_requested_at TEXT, ai_completed_at TEXT, ai_error TEXT)
  ON CONFLICT (run_id, symbol) DO UPDATE SET ai_status = EXCLUDED.ai_status, ai_enrichment = EXCLUDED.ai_enrichment, ai_source = EXCLUDED.ai_source, ai_requested_at = EXCLUDED.ai_requested_at, ai_completed_at = EXCLUDED.ai_completed_at, ai_error = EXCLUDED.ai_error;
  UPDATE screening_runs SET status = 'completed', completed_at = COALESCE(completed_at, NOW()) WHERE id = v_id;
  RETURN v_id;
END $$;
