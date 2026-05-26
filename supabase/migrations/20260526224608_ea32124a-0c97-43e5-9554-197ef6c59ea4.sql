
CREATE TABLE public.events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO anon, authenticated;
GRANT ALL ON public.events TO service_role;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_all" ON public.events FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.presentations
  ADD COLUMN event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  ADD COLUMN sort_order integer NOT NULL DEFAULT 0;
CREATE INDEX idx_presentations_event_id ON public.presentations(event_id, sort_order);

ALTER TABLE public.participants
  ADD COLUMN device_token text,
  ADD COLUMN event_id uuid;
CREATE INDEX idx_participants_device_token ON public.participants(device_token);
CREATE UNIQUE INDEX uniq_participants_event_device_session
  ON public.participants(session_id, device_token)
  WHERE device_token IS NOT NULL;

CREATE TABLE public.participant_scores (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id uuid,
  presentation_id uuid NOT NULL,
  session_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  device_token text,
  participant_name text NOT NULL DEFAULT '',
  birth_date date,
  score integer NOT NULL DEFAULT 0,
  correct_count integer NOT NULL DEFAULT 0,
  answer_count integer NOT NULL DEFAULT 0,
  total_response_ms bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (presentation_id, participant_id)
);
CREATE INDEX idx_participant_scores_event ON public.participant_scores(event_id);
CREATE INDEX idx_participant_scores_device ON public.participant_scores(device_token);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.participant_scores TO anon, authenticated;
GRANT ALL ON public.participant_scores TO service_role;
ALTER TABLE public.participant_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_all" ON public.participant_scores FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
