
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS start_date timestamptz,
  ADD COLUMN IF NOT EXISTS completion_threshold numeric NOT NULL DEFAULT 0.7;

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS google_user_id uuid;

ALTER TABLE public.participant_scores
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS google_user_id uuid;

CREATE INDEX IF NOT EXISTS idx_participants_google_user_id ON public.participants(google_user_id);
CREATE INDEX IF NOT EXISTS idx_participant_scores_google_user_id ON public.participant_scores(google_user_id);

CREATE TABLE IF NOT EXISTS public.certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL,
  event_id uuid,
  presentation_id uuid,
  google_user_id uuid,
  participant_name text NOT NULL,
  event_title text NOT NULL,
  presentation_title text,
  score integer NOT NULL DEFAULT 0,
  correct_count integer NOT NULL DEFAULT 0,
  answer_count integer NOT NULL DEFAULT 0,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_certificate_per_participant_scope
  ON public.certificates(participant_id, COALESCE(event_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(presentation_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS idx_certificates_google_user_id ON public.certificates(google_user_id);

GRANT SELECT, INSERT ON public.certificates TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.certificates TO authenticated;
GRANT ALL ON public.certificates TO service_role;

ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon can insert certificates"
  ON public.certificates FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "anon can read certificates"
  ON public.certificates FOR SELECT TO anon
  USING (true);

CREATE POLICY "authenticated can insert own certificates"
  ON public.certificates FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated can read own certificates"
  ON public.certificates FOR SELECT TO authenticated
  USING (google_user_id IS NULL OR google_user_id = auth.uid());
