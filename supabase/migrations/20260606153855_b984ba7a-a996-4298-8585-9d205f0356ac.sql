ALTER TABLE public.presentations ADD COLUMN IF NOT EXISTS ai_model TEXT DEFAULT 'deepseek';
COMMENT ON COLUMN public.presentations.ai_model IS 'The AI model to use for generating scripts and answering questions: deepseek or gemini';
