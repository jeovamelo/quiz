-- Tabela de perguntas da plateia (re-garantindo a existência)
CREATE TABLE IF NOT EXISTS public.audience_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    participant_id UUID REFERENCES public.participants(id) ON DELETE SET NULL,
    question_text TEXT NOT NULL,
    answer_text TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'ignored', 'answered'
    priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audience_questions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audience_questions TO anon;
GRANT ALL ON public.audience_questions TO service_role;

ALTER TABLE public.audience_questions ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'Todos podem criar perguntas em uma sessão') THEN
        CREATE POLICY "Todos podem criar perguntas em uma sessão" ON public.audience_questions FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'Todos podem ver perguntas aprovadas ou respondidas') THEN
        CREATE POLICY "Todos podem ver perguntas aprovadas ou respondidas" ON public.audience_questions FOR SELECT USING (status IN ('approved', 'answered'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'Palestrantes podem gerenciar todas as perguntas') THEN
        CREATE POLICY "Palestrantes podem gerenciar todas as perguntas" ON public.audience_questions FOR ALL USING (true);
    END IF;
END $$;

-- Adiciona campos de configuração avançada de IA na tabela de apresentações
ALTER TABLE public.presentations
ADD COLUMN IF NOT EXISTS ai_personality_instructions TEXT,
ADD COLUMN IF NOT EXISTS ai_pro_tts_provider TEXT CHECK (ai_pro_tts_provider IN ('openai', 'elevenlabs')),
ADD COLUMN IF NOT EXISTS ai_pro_tts_api_key TEXT,
ADD COLUMN IF NOT EXISTS ai_pro_tts_voice_id TEXT;

-- Adiciona flag de pensamento da IA na sessão
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS ai_thinking BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS mic_enabled BOOLEAN DEFAULT true;

-- Garante que as novas colunas sejam acessíveis
GRANT SELECT, UPDATE ON public.presentations TO authenticated;
GRANT SELECT ON public.presentations TO anon;
GRANT SELECT, UPDATE ON public.sessions TO authenticated;
GRANT SELECT ON public.sessions TO anon;

-- Trigger para sincronizar perguntas respondidas (conforme migração anterior)
CREATE OR REPLACE FUNCTION public.sync_answered_question_to_session()
RETURNS TRIGGER AS $$ 
BEGIN
    IF NEW.status = 'answered' AND (OLD.status IS NULL OR OLD.status != 'answered') THEN
        UPDATE public.sessions 
        SET 
            audience_question = NEW.question_text,
            audience_question_answer = NEW.answer_text,
            audience_question_at = now()
        WHERE id = NEW.session_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS sync_answered_question_to_session_trigger ON public.audience_questions;
CREATE TRIGGER sync_answered_question_to_session_trigger
AFTER UPDATE ON public.audience_questions
FOR EACH ROW EXECUTE FUNCTION public.sync_answered_question_to_session();
