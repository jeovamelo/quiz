ALTER TABLE public.presentations ADD COLUMN IF NOT EXISTS speaker_email TEXT;
CREATE INDEX IF NOT EXISTS presentations_speaker_email_idx ON public.presentations (lower(speaker_email));