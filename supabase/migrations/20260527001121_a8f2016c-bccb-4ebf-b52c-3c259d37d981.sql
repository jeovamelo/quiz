ALTER TABLE public.presentations ADD COLUMN IF NOT EXISTS default_time_limit integer NOT NULL DEFAULT 30;
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS is_prize_question boolean NOT NULL DEFAULT false;
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS prize_multiplier integer NOT NULL DEFAULT 5;
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS difficulty text NOT NULL DEFAULT 'medium';