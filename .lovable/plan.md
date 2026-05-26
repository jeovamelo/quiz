# Plano: Módulo de Eventos + Persistência de Participante + Ranking Acumulativo

## 1. Banco de Dados (migration única)

**Nova tabela `events`:**
- `id` (uuid, PK)
- `user_id` (uuid, dono/palestrante — default `'00000000-...'` como em `presentations` para manter compatibilidade)
- `title` (text)
- `created_at` (timestamptz)

**Alterações em `presentations`:**
- Adicionar `event_id` (uuid, nullable, FK → `events.id` ON DELETE SET NULL)
- Adicionar `sort_order` (int, default 0)

**Alterações em `participants`:**
- Adicionar `device_token` (text, nullable, indexado)
- Adicionar `event_id` (uuid, nullable) — para identificar o participante no escopo do evento
- Índice único parcial `(event_id, device_token)` quando ambos não-nulos (mesmo device = mesmo participante dentro do evento)

**Nova tabela `participant_scores`** (agregação por palestra):
- `id` (uuid, PK)
- `event_id` (uuid, nullable)
- `presentation_id` (uuid)
- `session_id` (uuid)
- `participant_id` (uuid → participants.id)
- `device_token` (text, nullable)
- `score` (int default 0)
- `correct_count` (int default 0)
- `answer_count` (int default 0)
- `total_response_ms` (bigint default 0)
- `updated_at` (timestamptz)
- Único `(presentation_id, participant_id)`

Grants + RLS abertos (`open_all`) seguindo o padrão atual do projeto.

## 2. Rotas novas / alteradas

**Novas rotas:**
- `src/routes/event.new.tsx` — criar evento (título).
- `src/routes/event.$id.tsx` — gerenciar evento: listar apresentações vinculadas, anexar PDFs existentes, criar nova apresentação dentro do evento, reordenar com botões ↑/↓ atualizando `sort_order`.
- `src/routes/event.$id.podium.tsx` — Grande Pódio do Evento (soma de `participant_scores` agrupado por `device_token` dentro do `event_id`).

**Alterações:**
- `src/routes/dashboard.tsx` — adicionar seção "Eventos" + botão "Novo Evento" ao lado de "Nova Apresentação".
- `src/routes/quiz.new.tsx` — aceitar `?eventId=` opcional para já vincular ao evento.
- `src/routes/join.tsx` — fluxo de device token (ver §3).
- `src/routes/present.$id.tsx` — após terminar a palestra, se `event_id` existir, oferecer botão "Próxima Apresentação" (pega próxima por `sort_order`) e "Ver Grande Pódio do Evento".
- `src/lib/ranking.ts` — adicionar helper `aggregateEventRanking(scores[])`.

## 3. Persistência do participante (`/join`)

- Ao montar `/join`, ler `localStorage.getItem('quiz_device_token')`. Se não existir, gerar `crypto.randomUUID()` e salvar.
- Resolver o `event_id` da sessão (via `presentation_id → event_id`).
- Buscar `participants` por `(event_id, device_token)`:
  - Se existir → reaproveitar (pular formulário), criar/atualizar registro vinculado à `session_id` atual via upsert se necessário.
  - Se não existir → mostrar formulário Nome + Data de Nascimento; ao submeter, inserir com `device_token` e `event_id`.
- O `participant_id` da sessão atual é derivado: se já existe participante para `(event_id, device_token)` mas em sessão diferente, criar novo registro de `participants` para esta sessão copiando nome/birth_date e mantendo o mesmo `device_token` (assim o histórico de answers da sessão continua coeso).

## 4. Pontuação acumulativa

- Toda vez que `participants` for atualizado (score/correct_count/etc.) após uma resposta em `/join`, fazer também um upsert em `participant_scores` com chave `(presentation_id, participant_id)` copiando os totais.
- `event_id` e `device_token` são preenchidos para permitir agregação por evento.
- Pódio da palestra: usa `participants` da `session_id` (comportamento atual mantido).
- Pódio do evento: `SELECT device_token, SUM(score), SUM(correct_count), SUM(total_response_ms), SUM(answer_count) FROM participant_scores WHERE event_id = ? GROUP BY device_token` + ordenação via `sortRanking`.

## 5. Arquivos a tocar

```
supabase migration (1 nova)
src/routes/dashboard.tsx           (editar)
src/routes/event.new.tsx           (novo)
src/routes/event.$id.tsx           (novo)
src/routes/event.$id.podium.tsx    (novo)
src/routes/quiz.new.tsx            (editar — aceitar eventId)
src/routes/join.tsx                (editar — device token + skip form)
src/routes/present.$id.tsx         (editar — upsert em participant_scores, botão próxima/pódio)
src/lib/ranking.ts                 (editar — helper de agregação)
```

## Notas técnicas

- RLS segue o padrão `open_all` já usado no projeto (mesmo modelo de `presentations`).
- Não mexer em `auth.users`, nem nos arquivos auto-gerados da Supabase.
- IDs e regras de pontuação por tempo permanecem como já implementados em `ranking.ts`.
- Idioma: toda UI em PT-BR ("evento", "apresentação", "celular", "usuário", "arquivo", "tela").

Após sua aprovação, começo pela migration (que precisa rodar isolada) e depois implemento todo o código em lote.