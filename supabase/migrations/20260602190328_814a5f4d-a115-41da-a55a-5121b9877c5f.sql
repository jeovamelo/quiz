
ALTER TABLE public.presentations
  ADD COLUMN IF NOT EXISTS presenter_mode text NOT NULL DEFAULT 'human',
  ADD COLUMN IF NOT EXISTS ai_voice text,
  ADD COLUMN IF NOT EXISTS ai_voice_rate numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS ai_idle_timeout integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_questions_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS audience_question text,
  ADD COLUMN IF NOT EXISTS audience_question_answer text,
  ADD COLUMN IF NOT EXISTS audience_question_at timestamptz;

CREATE TABLE IF NOT EXISTS public.slide_scripts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  presentation_id uuid NOT NULL,
  slide_number integer NOT NULL,
  script_text text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (presentation_id, slide_number)
);

GRANT SELECT ON public.slide_scripts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.slide_scripts TO authenticated;
GRANT ALL ON public.slide_scripts TO service_role;

ALTER TABLE public.slide_scripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "slide_scripts_select_public"
  ON public.slide_scripts FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "slide_scripts_insert_owner"
  ON public.slide_scripts FOR INSERT
  TO authenticated
  WITH CHECK (public.is_presentation_owner(presentation_id));

CREATE POLICY "slide_scripts_update_owner"
  ON public.slide_scripts FOR UPDATE
  TO authenticated
  USING (public.is_presentation_owner(presentation_id))
  WITH CHECK (public.is_presentation_owner(presentation_id));

CREATE POLICY "slide_scripts_delete_owner"
  ON public.slide_scripts FOR DELETE
  TO authenticated
  USING (public.is_presentation_owner(presentation_id));

CREATE TRIGGER slide_scripts_touch_updated_at
  BEFORE UPDATE ON public.slide_scripts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.slide_scripts;
