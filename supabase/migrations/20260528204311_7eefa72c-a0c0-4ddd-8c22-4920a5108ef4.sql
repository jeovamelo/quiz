CREATE TABLE public.qr_login_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  access_token TEXT,
  refresh_token TEXT,
  authorized_user_id UUID,
  user_email TEXT,
  user_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 minutes'),
  authorized_at TIMESTAMPTZ
);

GRANT SELECT, INSERT, UPDATE ON public.qr_login_sessions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qr_login_sessions TO authenticated;
GRANT ALL ON public.qr_login_sessions TO service_role;

ALTER TABLE public.qr_login_sessions ENABLE ROW LEVEL SECURITY;

-- Anyone can create a new pending QR session (the UUID itself is the secret)
CREATE POLICY "anyone can create qr session"
ON public.qr_login_sessions
FOR INSERT
TO anon, authenticated
WITH CHECK (status = 'pending' AND access_token IS NULL AND refresh_token IS NULL);

-- Anyone who knows the UUID can read it (polling/realtime from desktop)
CREATE POLICY "anyone can read qr session"
ON public.qr_login_sessions
FOR SELECT
TO anon, authenticated
USING (true);

-- Only authenticated users can authorize a pending, non-expired session
CREATE POLICY "authenticated can authorize qr session"
ON public.qr_login_sessions
FOR UPDATE
TO authenticated
USING (status = 'pending' AND expires_at > now())
WITH CHECK (authorized_user_id = auth.uid());

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.qr_login_sessions;
ALTER TABLE public.qr_login_sessions REPLICA IDENTITY FULL;