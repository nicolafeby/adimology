-- Additive eligibility-v1 / eligible-ranking-v1 contract. Legacy ranking JSON,
-- score and rank remain readable during the compatibility window.
ALTER TABLE screening_results
  ADD COLUMN IF NOT EXISTS analysis_score NUMERIC,
  ADD COLUMN IF NOT EXISTS eligibility_status TEXT NOT NULL DEFAULT 'not_evaluated'
    CHECK (eligibility_status IN ('eligible', 'needs_confirmation', 'ineligible', 'not_evaluated')),
  ADD COLUMN IF NOT EXISTS eligibility_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ranking_score NUMERIC,
  ADD COLUMN IF NOT EXISTS ranking_position INTEGER,
  ADD COLUMN IF NOT EXISTS ranking_factors JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS eligibility_config_version TEXT,
  ADD COLUMN IF NOT EXISTS ranking_model_version TEXT;

CREATE INDEX IF NOT EXISTS idx_screening_results_passed_rank
  ON screening_results(run_id, ranking_position)
  WHERE screening_status = 'passed';

CREATE OR REPLACE FUNCTION commit_screening_run(p_run JSONB, p_results JSONB)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_id UUID := (p_run->>'id')::UUID;
BEGIN
  INSERT INTO screening_runs(id, analysis_date, status, universe_count, started_at, completed_at, quantitative_status, enrichment_status)
  VALUES (v_id, (p_run->>'analysis_date')::DATE, 'running', (p_run->>'universe_count')::INTEGER, (p_run->>'started_at')::TIMESTAMPTZ, NULL,
    COALESCE(p_run->>'quantitative_status', 'completed'), COALESCE(p_run->>'enrichment_status', 'not_started'))
  ON CONFLICT (id) DO UPDATE SET quantitative_status = EXCLUDED.quantitative_status, enrichment_status = EXCLUDED.enrichment_status;

  INSERT INTO screening_results(run_id, symbol, analysis_date, screening_status, passed_rules, failed_rules, selection_stage, data_quality, evaluated_at, ranking,
    ai_status, ai_enrichment, ai_source, ai_requested_at, ai_completed_at, ai_error, analysis_score, eligibility_status, eligibility_rules,
    ranking_score, ranking_position, ranking_factors, eligibility_config_version, ranking_model_version)
  SELECT v_id, x.symbol, x.analysis_date::DATE, x.screening_status, x.passed_rules, x.failed_rules, x.selection_stage, x.data_quality, x.evaluated_at::TIMESTAMPTZ, x.ranking,
    COALESCE(x.ai_status, 'not_requested'), x.ai_enrichment, x.ai_source, x.ai_requested_at::TIMESTAMPTZ, x.ai_completed_at::TIMESTAMPTZ, x.ai_error,
    x.analysis_score, COALESCE(x.eligibility_status, 'not_evaluated'), COALESCE(x.eligibility_rules, '[]'::jsonb), x.ranking_score, x.ranking_position,
    COALESCE(x.ranking_factors, '[]'::jsonb), x.eligibility_config_version, x.ranking_model_version
  FROM jsonb_to_recordset(p_results) AS x(symbol TEXT, analysis_date TEXT, screening_status TEXT, passed_rules JSONB, failed_rules JSONB, selection_stage TEXT,
    data_quality JSONB, evaluated_at TEXT, ranking JSONB, ai_status TEXT, ai_enrichment JSONB, ai_source TEXT, ai_requested_at TEXT, ai_completed_at TEXT,
    ai_error TEXT, analysis_score NUMERIC, eligibility_status TEXT, eligibility_rules JSONB, ranking_score NUMERIC, ranking_position INTEGER,
    ranking_factors JSONB, eligibility_config_version TEXT, ranking_model_version TEXT)
  ON CONFLICT (run_id, symbol) DO UPDATE SET
    screening_status = EXCLUDED.screening_status, passed_rules = EXCLUDED.passed_rules, failed_rules = EXCLUDED.failed_rules,
    selection_stage = EXCLUDED.selection_stage, data_quality = EXCLUDED.data_quality, evaluated_at = EXCLUDED.evaluated_at, ranking = EXCLUDED.ranking,
    ai_status = EXCLUDED.ai_status, ai_enrichment = EXCLUDED.ai_enrichment, ai_source = EXCLUDED.ai_source, ai_requested_at = EXCLUDED.ai_requested_at,
    ai_completed_at = EXCLUDED.ai_completed_at, ai_error = EXCLUDED.ai_error, analysis_score = EXCLUDED.analysis_score,
    eligibility_status = EXCLUDED.eligibility_status, eligibility_rules = EXCLUDED.eligibility_rules, ranking_score = EXCLUDED.ranking_score,
    ranking_position = EXCLUDED.ranking_position, ranking_factors = EXCLUDED.ranking_factors,
    eligibility_config_version = EXCLUDED.eligibility_config_version, ranking_model_version = EXCLUDED.ranking_model_version;
  UPDATE screening_runs SET status = 'completed', completed_at = COALESCE(completed_at, NOW()) WHERE id = v_id;
  RETURN v_id;
END $$;
