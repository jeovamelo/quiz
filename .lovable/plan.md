## Objetivo

Refatorar o fluxo "Iniciar Apresentação" para que o projetor primeiro mostre uma **tela de pareamento de até 2 controles remotos** via QR Code, o celular peça apenas o **nome do apresentador** (sem login) e o controle remoto ganhe uma **nova UI ergonômica** (Avançar gigante + Voltar pequeno + gaveta "Outras Funcionalidades") com controle duplo síncrono.

---

## Fase 1 — Tela de pareamento no projetor (`/present/$id/pair`)

Nova rota intermediária mostrada **antes** do primeiro slide quando o palestrante clica em "Iniciar Apresentação" no Dashboard.

- Título: **"Conectar Controles Remotos"**
- QR Code único da sessão apontando para `/remote/$id/join?slot=auto`
- **2 slots visuais**:
  - Slot 1: amarelo piscante "📱 Controle 1: Aguardando conexão..." → verde "🟢 Controle 1 Ativo: {nome}"
  - Slot 2: amarelo "📱 Controle 2: Aguardando conexão (Opcional)..." → verde "🟢 Controle 2 Ativo: {nome}"
- Botão rodapé: **"Iniciar Apresentação Agora 🚀"** (sempre ativo, mesmo com 0 controles) → navega para `/present/$id`
- Atualização em tempo real via Supabase Realtime na nova tabela `session_remotes`

## Fase 2 — Captura de nome no celular (`/remote/$id/join`)

Tela pública (sem login):
- Campo: "Qual é o seu nome?" (obrigatório, validado)
- Botão gradiente BNB (#A6193C → #F68B1F): **"Ativar Controle Remoto 📱"**
- Ao enviar: insere em `session_remotes` ocupando o próximo slot livre (1 ou 2). Se ambos cheios, mensagem "Os 2 controles já estão conectados."
- Salva `remote_id` em `localStorage` e redireciona para `/remote/$id` com slot e nome no estado.

## Fase 3 — Nova interface do celular (`/remote/$id`)

Layout **estático `100dvh` sem rolagem**.

**Cabeçalho fixo:** "Você é o Controle {N} ({Nome})" + badge de status de conexão.

**Tela principal:**
- **AVANÇAR** (70% da área inferior): botão gigante, gradiente BNB, ícone de seta, dispara `handleMasterAdvance` no projetor (mesmo comportamento do clique do mouse, já implementado).
- **VOLTAR**: pequeno, cinza escuro, base extrema.
- **⚙️ Outras Funcionalidades**: botão central que abre `Drawer` (shadcn) cobrindo a tela.

**Gaveta de funcionalidades** (toggles + ações):
- Alternar Tela Cheia (F11) — `is_fullscreen` na sessão
- Exibir/Ocultar QR Code no Projetor — novo campo `show_join_qr`
- Exibir/Ocultar Classificação Geral — novo campo `show_ranking`
- Exibir/Ocultar Barra Lateral Direita — novo campo `show_sidebar`
- **Encerrar Apresentação** (vermelho) → modal full-screen "Deseja realmente encerrar o evento e revelar o pódio agora?" → ao confirmar, dispara transição imediata do projetor para a tela de pódio.

## Fase 4 — Controle duplo síncrono

Ambos os controles compartilham os mesmos privilégios. Como toda ação já passa pelo canal Broadcast `remote-bridge-{sessionId}` e/ou updates na tabela `sessions`, basta garantir que:
- O projetor escuta todas as ações independentemente do `from`.
- O badge de status no celular mostra qual slot ele ocupa.
- A presença na tabela `session_remotes` (com heartbeat) define quem está ativo.

---

## Detalhes técnicos

### Banco de dados (1 migration)

```sql
-- Slots de controles remotos pareados por sessão
CREATE TABLE public.session_remotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  slot integer NOT NULL CHECK (slot IN (1, 2)),
  operator_name text NOT NULL,
  device_token text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, slot)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_remotes TO anon, authenticated;
GRANT ALL ON public.session_remotes TO service_role;
ALTER TABLE public.session_remotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY open_all ON public.session_remotes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.session_remotes;

-- Toggles de visibilidade controlados pelo celular
ALTER TABLE public.sessions
  ADD COLUMN show_join_qr boolean NOT NULL DEFAULT true,
  ADD COLUMN show_ranking boolean NOT NULL DEFAULT true,
  ADD COLUMN show_sidebar boolean NOT NULL DEFAULT true,
  ADD COLUMN force_podium boolean NOT NULL DEFAULT false;
```

### Arquivos criados
- `src/routes/present.$id.pair.tsx` — tela de pareamento no projetor
- `src/routes/remote.$id.join.tsx` — captura de nome no celular
- `src/components/remote-drawer.tsx` — gaveta "Outras Funcionalidades"

### Arquivos editados
- `src/routes/dashboard.tsx` — `startSession()` agora navega para `/present/$id/pair` em vez de `/present/$id`
- `src/routes/lobby.$id.tsx` — botão "Iniciar Apresentação" idem
- `src/routes/remote.$id.tsx` — nova UI ergonômica (Avançar gigante, Voltar pequeno, gaveta), leitura de slot/nome
- `src/routes/remote.index.tsx` — passa a redirecionar para `/remote/$id/join` quando há sessão alvo
- `src/routes/present.$id.tsx` — respeita `show_join_qr`, `show_ranking`, `show_sidebar` e `force_podium`; remove cards condicionalmente
- `src/hooks/use-pairing-presence.tsx` — heartbeat passa a atualizar `session_remotes.last_seen_at` do slot atual

### Pontos de atenção
- A rota `/present/$id/pair` deve ser acessível só pelo palestrante logado (igual a `/present/$id`).
- O QR Code do pareamento é **diferente** do QR de participantes (que continua em `/join?session=...`).
- O slot é atribuído server-side por ordem de chegada (transação curta) para evitar corrida entre 2 celulares escaneando ao mesmo tempo.
- Toda UI em **PT-BR**.

---

## Fora do escopo
- Persistir controles entre sessões diferentes (cada sessão começa do zero).
- Autenticação dos controles (continua público, identificado só pelo nome).
- Mudanças no fluxo do participante final (`/join`).

Aprove para eu implementar.