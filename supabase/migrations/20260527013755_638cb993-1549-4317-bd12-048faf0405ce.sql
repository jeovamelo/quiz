ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS is_fullscreen boolean NOT NULL DEFAULT false;