ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS is_ready boolean NOT NULL DEFAULT false;