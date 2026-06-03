ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS is_paused boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS last_resume_at timestamptz;

-- Sincroniza last_resume_at com started_at para sessões já em andamento ou novas
UPDATE public.sessions SET last_resume_at = started_at WHERE started_at IS NOT NULL AND last_resume_at IS NULL;