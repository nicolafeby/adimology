CREATE TABLE IF NOT EXISTS screening_runs (
  id UUID PRIMARY KEY,
  analysis_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  universe_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS screening_results (
  run_id UUID NOT NULL REFERENCES screening_runs(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  analysis_date DATE NOT NULL,
  screening_status TEXT NOT NULL CHECK (screening_status IN ('passed', 'watch', 'rejected', 'processing_error')),
  passed_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  failed_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  selection_stage TEXT NOT NULL CHECK (selection_stage IN ('universe', 'pre_screen', 'quantitative_analysis', 'quality_gate', 'final_selection')),
  data_quality JSONB NOT NULL DEFAULT '{}'::jsonb,
  evaluated_at TIMESTAMPTZ NOT NULL,
  ranking JSONB,
  PRIMARY KEY (run_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_screening_runs_latest ON screening_runs(status, analysis_date DESC, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_screening_results_status ON screening_results(run_id, screening_status);

CREATE OR REPLACE FUNCTION commit_screening_run(p_run JSONB, p_results JSONB)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_id UUID := (p_run->>'id')::UUID;
BEGIN
  INSERT INTO screening_runs(id, analysis_date, status, universe_count, started_at, completed_at)
  VALUES (v_id, (p_run->>'analysis_date')::DATE, 'running', (p_run->>'universe_count')::INTEGER, (p_run->>'started_at')::TIMESTAMPTZ, NULL)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO screening_results(run_id, symbol, analysis_date, screening_status, passed_rules, failed_rules, selection_stage, data_quality, evaluated_at, ranking)
  SELECT v_id, x.symbol, x.analysis_date::DATE, x.screening_status, x.passed_rules, x.failed_rules, x.selection_stage, x.data_quality, x.evaluated_at::TIMESTAMPTZ, x.ranking
  FROM jsonb_to_recordset(p_results) AS x(symbol TEXT, analysis_date TEXT, screening_status TEXT, passed_rules JSONB, failed_rules JSONB, selection_stage TEXT, data_quality JSONB, evaluated_at TEXT, ranking JSONB);
  UPDATE screening_runs SET status = 'completed', completed_at = NOW() WHERE id = v_id;
  RETURN v_id;
END $$;
