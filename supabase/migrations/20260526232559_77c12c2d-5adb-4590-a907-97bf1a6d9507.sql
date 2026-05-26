
ALTER TABLE public.presentations
  ADD COLUMN IF NOT EXISTS execution_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS presented_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS chronological_index INTEGER;

ALTER TABLE public.presentations
  DROP CONSTRAINT IF EXISTS presentations_execution_status_check;

ALTER TABLE public.presentations
  ADD CONSTRAINT presentations_execution_status_check
  CHECK (execution_status IN ('pending','active','completed_full','completed_partial'));
