-- Add ElevenLabs columns to public.profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS elevenlabs_api_key TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS elevenlabs_voice_id TEXT;

-- Drop check constraint on presentations to allow Google TTS and Gemini Multimodal
ALTER TABLE public.presentations DROP CONSTRAINT IF EXISTS presentations_ai_pro_tts_provider_check;
ALTER TABLE public.presentations ADD CONSTRAINT presentations_ai_pro_tts_provider_check CHECK (ai_pro_tts_provider IN ('openai', 'elevenlabs', 'google', 'gemini'));
