
# Plano: Abas no Editor + Módulo Palestrante IA

Reestruturar `src/routes/quiz.$id.edit.tsx` com sistema de abas e criar um novo módulo de Palestrante Autônomo (IA) integrado ao DeepSeek e à síntese de voz do navegador.

## 1. Migração de banco de dados

Nova migração SQL adicionando colunas em `presentations`:

- `presenter_mode` text DEFAULT `'human'` — valores: `human` | `ai`
- `ai_voice` text DEFAULT `'pt-BR-Female'` — identificador da voz TTS
- `ai_voice_rate` numeric DEFAULT `1.0` — velocidade
- `ai_idle_timeout` integer DEFAULT `0` — segundos de inatividade para avanço automático (0 = desativado)
- `ai_questions_enabled` boolean DEFAULT `false` — habilita captura de dúvidas por voz no celular

Nova coluna em `questions` (reaproveitando a tabela para guardar roteiro por slide é ruim — então criar tabela dedicada):

Nova tabela `slide_scripts`:
- `id` uuid PK
- `presentation_id` uuid (FK lógico)
- `slide_number` int
- `script_text` text
- `updated_at` timestamptz
- Unique(presentation_id, slide_number)
- RLS: owner via `is_presentation_owner(presentation_id)` para INSERT/UPDATE/DELETE; SELECT público (igual `questions`)
- GRANTs para anon (SELECT) e authenticated (ALL) + service_role

Nova coluna em `sessions`:
- `audience_question` text — última pergunta capturada da plateia (para o palestrante responder)
- `audience_question_answer` text — resposta gerada pela IA

## 2. Server functions (novos arquivos)

`src/lib/ai-script.functions.ts`:
- `generateSlideScripts({ presentationId })` — protegido por `requireSupabaseAuth`. Lê o PDF text (já temos `ai_context` ou re-extrai), chama DeepSeek com tool calling para retornar um resumo falado curto por slide. Upserta em `slide_scripts`.
- `answerAudienceQuestion({ sessionId, question })` — busca slide atual + script daquele slide + contexto da apresentação, chama DeepSeek para gerar resposta concisa baseada APENAS nesse contexto. Salva em `sessions.audience_question_answer`.

Reaproveita padrão de `src/lib/ai.functions.ts` (DEEPSEEK_API_KEY já configurada).

## 3. UI — Editor com abas

Refatorar `src/routes/quiz.$id.edit.tsx`:

```text
┌─────────────────────────────────────┐
│ [Quiz] [Palestrante IA]             │  ← shadcn Tabs
├─────────────────────────────────────┤
│ (conteúdo da aba ativa)             │
└─────────────────────────────────────┘
```

**Aba "Quiz"**: move todo o conteúdo atual (lista de perguntas, geração via IA, etc) sem mudanças funcionais.

**Aba "Palestrante IA"**: nova UI com seções:

1. **Modo de Apresentação**
   - Select: `Apresentação Humana` | `Palestrante IA`
   - Select de voz TTS (popula via `speechSynthesis.getVoices()` filtrando pt-BR)
   - Slider de velocidade (0.5–2.0)
   - Input numérico: timeout de inatividade (segundos)
   - Switch: "Ativar Modo Perguntas da Plateia"

2. **Roteiro por Slide**
   - Botão `Gerar Roteiro da IA` (chama `generateSlideScripts`)
   - Lista expansível: um card por slide com `Textarea` editável + botão Salvar
   - Indicador de loading durante geração

## 4. Integração TTS no Presenter

Em `src/routes/-present.$id.component.tsx`:
- Quando `presentation.presenter_mode === 'ai'` e o slide muda, buscar `slide_scripts` para o `current_slide` e disparar `speechSynthesis.speak(new SpeechSynthesisUtterance(text))` com voice/rate configurados.
- Cancelar utterance ao trocar de slide.
- Se `ai_idle_timeout > 0`, agendar `nextSlide()` após o tempo configurado a partir do `onend` do utterance.

## 5. Captura de pergunta por voz (participante)

Em `src/routes/join.tsx`:
- Se `sessions.audience_question` está ativo (via realtime) e `presentation.ai_questions_enabled === true`, mostrar botão de microfone que usa `webkitSpeechRecognition` para gravar.
- Ao finalizar, chama `answerAudienceQuestion` server fn.
- Presenter (`-present.$id.component.tsx`) escuta `sessions.audience_question_answer` via realtime e usa TTS para falar a resposta.

## 6. Detalhes técnicos

- TTS usa `window.speechSynthesis` (Web Speech API) — não consome créditos de IA, suporte nativo do navegador para pt-BR.
- DeepSeek chamado via `https://api.deepseek.com/v1/chat/completions` com `tool_calls` (mesmo padrão de `ai.functions.ts`).
- Realtime: habilitar `slide_scripts` e adicionar `audience_question*` ao publication existente de `sessions`.
- Tipos auto-gerados em `src/integrations/supabase/types.ts` serão atualizados automaticamente após a migração.

## 7. Arquivos afetados

- novo: `supabase/migrations/<timestamp>_palestrante_ia.sql`
- novo: `src/lib/ai-script.functions.ts`
- novo: `src/components/ai-presenter-tab.tsx` (conteúdo da nova aba)
- editado: `src/routes/quiz.$id.edit.tsx` (envolver em Tabs)
- editado: `src/routes/-present.$id.component.tsx` (TTS + auto-advance)
- editado: `src/routes/join.tsx` (botão de microfone)
- editado: `src/integrations/supabase/types.ts` (auto)

## Pontos a confirmar antes de implementar

1. **TTS**: usar Web Speech API nativa do navegador (grátis, instantânea, qualidade variável por SO) ou integrar serviço pago (ElevenLabs/OpenAI TTS) por edge function?
2. **Reconhecimento de voz no celular**: usar Web Speech API (`webkitSpeechRecognition` — só funciona em Chrome/Edge mobile) ou aceitar pergunta digitada como fallback?
3. **Avanço automático**: quando timeout = 0 deve desativar completamente, ou usar default (ex: tempo de fala + 5s)?
