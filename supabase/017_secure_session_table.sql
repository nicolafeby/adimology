-- Sensitive session values are accessed exclusively by the server-side service role.
ALTER TABLE public.session ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.session FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.session_id_seq FROM anon, authenticated;

-- The service role bypasses RLS. No public policies are intentionally created.
