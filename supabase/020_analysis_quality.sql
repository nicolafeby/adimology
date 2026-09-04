-- Additive quality-v1 fields. NULL preserves the meaning "not calculated" for
-- snapshots produced by older methodologies.
ALTER TABLE stock_rankings
  ADD COLUMN IF NOT EXISTS signal_agreement DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS freshness DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS reliability DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS dominant_direction TEXT,
  ADD COLUMN IF NOT EXISTS conflicts JSONB,
  ADD COLUMN IF NOT EXISTS analysis_quality JSONB,
  ADD COLUMN IF NOT EXISTS methodology_version TEXT;

ALTER TABLE signal_snapshots
  ADD COLUMN IF NOT EXISTS signal_agreement DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS dominant_direction TEXT,
  ADD COLUMN IF NOT EXISTS methodology_version TEXT;

ALTER TABLE stock_rankings
  ADD CONSTRAINT stock_rankings_signal_agreement_range CHECK (signal_agreement IS NULL OR signal_agreement BETWEEN 0 AND 100),
  ADD CONSTRAINT stock_rankings_confidence_range CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),
  ADD CONSTRAINT stock_rankings_freshness_range CHECK (freshness IS NULL OR freshness BETWEEN 0 AND 100),
  ADD CONSTRAINT stock_rankings_reliability_range CHECK (reliability IS NULL OR reliability BETWEEN 0 AND 100);
