CREATE TABLE public.session_remotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  slot integer NOT NULL CHECK (slot IN (1, 2)),
  operator_name text NOT NULL,
  device_token text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, slot)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_remotes TO anon, authenticated;
GRANT ALL ON public.session_remotes TO service_role;
ALTER TABLE public.session_remotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY open_all ON public.session_remotes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.session_remotes;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS show_join_qr boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_ranking boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_sidebar boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS force_podium boolean NOT NULL DEFAULT false;