ALTER TABLE public.presentations
  ADD COLUMN IF NOT EXISTS total_duration_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_max_answer_seconds integer NOT NULL DEFAULT 30;