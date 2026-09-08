-- Additive bootstrap for tables that older installations created outside the
-- versioned migration chain. Runs before 018_decision_outcomes.sql by filename.
-- Existing installations retain their tables and rows unchanged.
CREATE TABLE IF NOT EXISTS idx_universe (
 symbol TEXT PRIMARY KEY, company_name TEXT, sector TEXT, board TEXT,
 is_active BOOLEAN NOT NULL DEFAULT TRUE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS stock_rankings (
 id BIGSERIAL PRIMARY KEY, analysis_date DATE NOT NULL, symbol TEXT NOT NULL,
 rank INTEGER NOT NULL, score NUMERIC NOT NULL, data_completeness NUMERIC,
 model_probability DOUBLE PRECISION, signal TEXT NOT NULL, last_price NUMERIC,
 reasons JSONB NOT NULL DEFAULT '[]', risk_flags JSONB NOT NULL DEFAULT '[]',
 components JSONB NOT NULL DEFAULT '[]', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(analysis_date,symbol)
);
CREATE TABLE IF NOT EXISTS signal_snapshots (
 id BIGSERIAL PRIMARY KEY, signal_date DATE NOT NULL, symbol TEXT NOT NULL,
 score NUMERIC NOT NULL, data_completeness NUMERIC, signal TEXT NOT NULL,
 entry_price NUMERIC, target_price NUMERIC, stop_price NUMERIC,
 feature_snapshot JSONB NOT NULL DEFAULT '{}', model_version TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(signal_date,symbol,model_version)
);
CREATE TABLE IF NOT EXISTS signal_outcomes (
 id BIGSERIAL PRIMARY KEY, snapshot_id BIGINT NOT NULL REFERENCES signal_snapshots(id),
 return_5d DOUBLE PRECISION, return_10d DOUBLE PRECISION, return_20d DOUBLE PRECISION,
 close_5d NUMERIC, close_10d NUMERIC, close_20d NUMERIC,
 target_hit BOOLEAN, stop_hit BOOLEAN, evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(snapshot_id)
);
CREATE TABLE IF NOT EXISTS alert_rules (
 id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE,
 minimum_score NUMERIC, minimum_probability DOUBLE PRECISION, minimum_completeness NUMERIC,
 allowed_signals TEXT[], cooldown_hours INTEGER DEFAULT 24, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS alert_events (
 id BIGSERIAL PRIMARY KEY, rule_id BIGINT REFERENCES alert_rules(id), symbol TEXT NOT NULL,
 ranking_id BIGINT REFERENCES stock_rankings(id), status TEXT NOT NULL DEFAULT 'pending',
 payload JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE idx_universe ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON idx_universe,stock_rankings,signal_snapshots,signal_outcomes,alert_rules,alert_events TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
