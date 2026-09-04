-- Decision Card outcome audit fields. Existing rows remain valid through NULLs.
ALTER TABLE signal_outcomes
  ADD COLUMN IF NOT EXISTS entry_touched BOOLEAN,
  ADD COLUMN IF NOT EXISTS outcome_status TEXT,
  ADD COLUMN IF NOT EXISTS holding_period INTEGER,
  ADD COLUMN IF NOT EXISTS maximum_favorable_excursion DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS maximum_adverse_excursion DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS net_return DOUBLE PRECISION;
