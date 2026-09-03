-- Create session table for storing key-value pairs like tokens
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS session (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster key lookup
CREATE INDEX IF NOT EXISTS idx_session_key ON session(key);

-- Tokens must only be accessed through the server-side service role.
ALTER TABLE session ENABLE ROW LEVEL SECURITY;
ALTER TABLE session FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE session FROM anon, authenticated;
REVOKE ALL ON SEQUENCE session_id_seq FROM anon, authenticated;
