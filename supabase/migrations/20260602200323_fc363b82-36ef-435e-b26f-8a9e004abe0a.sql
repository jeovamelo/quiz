ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS time_budget_seconds integer,
  ADD COLUMN IF NOT EXISTS time_used_seconds integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_adjusting boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_last_adjustment_at timestamptz;