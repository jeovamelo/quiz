
-- Tabelas
CREATE TABLE public.presentations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  title TEXT NOT NULL,
  file_url TEXT NOT NULL,
  ai_context TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  presentation_id UUID NOT NULL REFERENCES public.presentations(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL DEFAULT 'multiple_choice', -- 'multiple_choice' | 'true_false'
  options JSONB NOT NULL,
  correct_option TEXT NOT NULL,
  slide_number INTEGER NOT NULL,
  display_mode TEXT NOT NULL DEFAULT 'simultaneous', -- 'simultaneous' | 'after_slide'
  time_limit INTEGER NOT NULL DEFAULT 10,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  presentation_id UUID NOT NULL REFERENCES public.presentations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'lobby', -- 'lobby' | 'live' | 'ended'
  current_slide INTEGER NOT NULL DEFAULT 1,
  active_question_id UUID REFERENCES public.questions(id) ON DELETE SET NULL,
  question_started_at TIMESTAMPTZ,
  question_revealed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  birth_date DATE NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  total_response_ms BIGINT NOT NULL DEFAULT 0,
  answer_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  selected_option TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL DEFAULT false,
  response_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(question_id, participant_id)
);

CREATE INDEX idx_questions_presentation ON public.questions(presentation_id);
CREATE INDEX idx_questions_slide ON public.questions(presentation_id, slide_number);
CREATE INDEX idx_sessions_presentation ON public.sessions(presentation_id);
CREATE INDEX idx_participants_session ON public.participants(session_id);
CREATE INDEX idx_answers_session ON public.answers(session_id);
CREATE INDEX idx_answers_question ON public.answers(question_id);

-- GRANTs (acesso público — modo de usuário único global sem auth)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.presentations TO anon, authenticated;
GRANT ALL ON public.presentations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.questions TO anon, authenticated;
GRANT ALL ON public.questions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions TO anon, authenticated;
GRANT ALL ON public.sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.participants TO anon, authenticated;
GRANT ALL ON public.participants TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.answers TO anon, authenticated;
GRANT ALL ON public.answers TO service_role;

-- RLS habilitada com políticas abertas (decisão de escopo: sem login)
ALTER TABLE public.presentations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open_all" ON public.presentations FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open_all" ON public.questions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open_all" ON public.sessions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open_all" ON public.participants FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "open_all" ON public.answers FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Storage bucket público
INSERT INTO storage.buckets (id, name, public)
VALUES ('presentations', 'presentations', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "presentations_public_read" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'presentations');
CREATE POLICY "presentations_public_insert" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'presentations');
CREATE POLICY "presentations_public_update" ON storage.objects FOR UPDATE TO anon, authenticated USING (bucket_id = 'presentations');
CREATE POLICY "presentations_public_delete" ON storage.objects FOR DELETE TO anon, authenticated USING (bucket_id = 'presentations');

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.questions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.participants;
ALTER PUBLICATION supabase_realtime ADD TABLE public.answers;

ALTER TABLE public.sessions REPLICA IDENTITY FULL;
ALTER TABLE public.participants REPLICA IDENTITY FULL;
ALTER TABLE public.answers REPLICA IDENTITY FULL;

-- Trigger updated_at em sessions
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER sessions_touch_updated_at
BEFORE UPDATE ON public.sessions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
