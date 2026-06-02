ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS question_expires_at timestamptz;

CREATE OR REPLACE FUNCTION public.validate_answer_within_time()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s_active uuid;
  s_expires timestamptz;
  s_revealed boolean;
BEGIN
  SELECT active_question_id, question_expires_at, question_revealed
    INTO s_active, s_expires, s_revealed
  FROM public.sessions
  WHERE id = NEW.session_id;

  IF s_active IS NULL OR s_active <> NEW.question_id THEN
    RAISE EXCEPTION 'question_not_active';
  END IF;
  IF s_revealed THEN
    RAISE EXCEPTION 'question_already_closed';
  END IF;
  IF s_expires IS NOT NULL AND s_expires < now() THEN
    RAISE EXCEPTION 'question_expired';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_answer_within_time_trigger ON public.answers;
CREATE TRIGGER validate_answer_within_time_trigger
BEFORE INSERT ON public.answers
FOR EACH ROW EXECUTE FUNCTION public.validate_answer_within_time();