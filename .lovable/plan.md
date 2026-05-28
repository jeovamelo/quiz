## QuizBini Pro — Plataforma de Eventos, Quiz e Certificação

Refatoração grande que toca banco de dados, autenticação, telas do participante e do palestrante. Vou entregar em fases para conseguirmos validar cada etapa antes da próxima.

### Fase 1 — Banco de dados e auth

**Migração SQL** (uma única migration, com GRANTs + RLS):

- `events`: adicionar `description text`, `start_date timestamptz`, `completion_threshold numeric default 0.7`.
- `presentations`: já existe com `status` (`execution_status`) e `sort_order`. Sem mudança estrutural.
- `participants`: adicionar `email text`, `google_user_id uuid` (referência lógica a `auth.users.id`, sem FK para não acoplar ao schema auth), índice em `google_user_id` e em `device_token`.
- `certificates` (nova): `id`, `participant_id`, `event_id`, `presentation_id` (nullable — null = certificado do evento inteiro), `google_user_id` (nullable, para lookup rápido do "meu histórico"), `participant_name`, `event_title`, `presentation_title` (nullable), `score`, `correct_count`, `answer_count`, `generated_at`.
- Tabela `responses` do brief já é coberta por `answers` existente — vou reutilizar `answers` em vez de duplicar.
- RLS: `certificates` legível por `auth.uid() = google_user_id` (logados) + insert anônimo aberto (a emissão acontece no momento que o participante clica). Demais tabelas mantêm policies atuais para não quebrar o quiz anônimo.

**Auth Google**: habilitar provider Google via `configure_social_auth` (mantendo email/senha desabilitado — login só pra salvar histórico).

### Fase 2 — Fluxo do participante (dual mode)

- `/join`: botão "Salvar meu histórico — entrar com Google" acima do form atual. Login não-bloqueante. Se logado, preencher nome/email automaticamente e gravar `google_user_id` no `participants`/`participant_scores`.
- Anônimo continua exatamente como hoje (device_token no localStorage).
- Ao final da apresentação, se participante atingiu `completion_threshold`, gravar linha em `certificates` automaticamente (idempotente: unique em `(participant_id, event_id, presentation_id)`).

### Fase 3 — Certificado PDF

- Adicionar `jspdf`.
- Helper `src/lib/certificate.ts` que gera PDF A4 paisagem com: nome do participante, título do evento, título da palestra (se houver), data, pontuação, "QuizBini".
- Botão "Baixar certificado" na tela de pódio/encerramento quando elegível.

### Fase 4 — Tela `/meu-historico`

- Rota protegida (requer login Google).
- Lista eventos/palestras que o usuário participou (join `participants` + `participant_scores` + `events` + `presentations` por `google_user_id`).
- Para cada item: data, pontuação, % de acerto, botão "Baixar certificado" se houver registro em `certificates`.
- Item no header do dashboard/login: link "Meu histórico".

### Fase 5 — Analítica para o palestrante

- Em `event.$id`: nova seção "Engajamento por palestra".
  - Para cada presentation do evento: total de participantes conectados (`participants` por `event_id` + `presentation_id` da sessão) vs. participantes que responderam ≥1 pergunta (distinct `participant_id` em `answers`).
  - Gráfico de barras simples (Recharts já presente? se não, SVG inline para não inflar deps).
- Lista "Quem participou": nome, pontuação, % acerto, tempo médio de resposta (`total_response_ms / answer_count`).

### Detalhes técnicos

- Toda escrita de `certificates` feita via cliente browser (RLS aberta para insert mas com WITH CHECK validando `correct_count::numeric / NULLIF(answer_count,0) >= completion_threshold`). Isso evita server function só pra isso.
- Login Google usa `lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/join" })`.
- `useAuthSession` já existe — reutilizar.
- PT-BR em todos os textos novos.
- Sem mudança nos fluxos existentes de apresentação/controle remoto/pódio.

### Riscos / pontos de atenção

- O scanner de segurança já flagueou as policies `open_all`. Esta refatoração não piora a situação, mas também não corrige. Se quiser endurecer RLS junto, é uma fase 6 separada (mover escrita anônima para server functions). Fora do escopo desta entrega para não atrasar o produto.
- `completion_threshold` por evento exige UI no `event.new` / `event.$id` para editar (vou adicionar input simples).

### Ordem de execução

1. Migration (aguarda aprovação do usuário).
2. Habilitar Google auth.
3. Instalar `jspdf`.
4. Código das fases 2→5.
