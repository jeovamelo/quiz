
# Refator: Fluxo Sequencial, Controle Único e Overlays Centrais

Este é um refator amplo. Antes de implementar, confirme se a direção abaixo está correta — vários itens conflitam com o estado atual do projeto.

## Escopo

### 1. Fluxo sequencial em 3 etapas no projetor

**Etapa 1 — `/present/$id/pair` (volta a ser uma tela real, não redireciona)**
- Tela escura centralizada: "Conectar Controle Remoto"
- QR code apontando para `/remote-setup/[SESSION_ID]`
- **Um único slot** "📱 Aguardando conexão do controle..." (amarelo piscante)
- Quando o slot ficar verde ("🟢 Controle Conectado: [Nome]"), habilita botão **"Avançar para o Lobby"**

**Etapa 2 — `/present/$id/lobby` (nova rota intermediária)**
- QR code gigante centralizado + link de acesso para participantes
- Avatares/nomes aparecendo em tempo real
- Botão "Iniciar Apresentação" (no celular do palestrante e no computador)

**Etapa 3 — `/present/$id` (apresentação limpa)**
- Slide em tela cheia, fundo `#000000`, **sem barra lateral fixa de QR/ranking**
- Apenas o slide. QR e ranking só aparecem via overlay sob comando do celular.

### 2. Controle único (de 2 → 1 slot)

Atualmente o sistema permite 2 controles concorrentes (slot 1 e 2). A spec pede **um único controle**. Mudanças:
- `claimRemoteSlot` em `src/lib/session-remotes.ts`: limita a 1 slot
- `pairing-frame-overlay.tsx`, `dashboard.tsx`, `remote.$id.tsx`: removem referências ao slot 2
- 2º túnel WebRTC (`tunnel2`) removido em `-present.$id.component.tsx`

### 3. Overlays centrais (substituem coluna lateral)

- **Frame QR Central**: modal flutuante centralizada (fundo `#161A23`, borda `#262D3D`), com QR de entrada + texto "Entre a qualquer momento!". Disparada por `TOGGLE_GIANT_QR` do celular.
- **Frame Ranking Central**: painel vertical flutuante central com lista ordenada (pontuação ↓, tempo médio ↑, idade ↑). Disparada por novo sinal `TOGGLE_RANKING`.
- Remover toda a coluna lateral atual de QR/ranking no projetor.

### 4. Nova UI do celular (`/remote/$id`)

Layout `100dvh` sem rolagem, hierarquia:
1. **AVANÇAR** (herói) — 60–70% largura, gradiente `#A6193C → #F68B1F`
2. **VOLTAR** — 44–48px, `#1E2235`
3. **Outras Funcionalidades ⚙️** — abre gaveta com toggles:
   - Alternar Tela Cheia (F11)
   - Mostrar/Ocultar QR Code Central
   - Mostrar/Ocultar Classificação Central
   - Encerrar Apresentação Precocemente (vermelho → pula para pódio Top 3 + confetes)

A gaveta de cadastrar controle e os controles de laser/áudio existentes serão preservados ou movidos para dentro dessa gaveta única.

### 5. Idioma PT-BR

Auditar toda UI nova/alterada para usar exclusivamente: celular, tela, usuário, cadastrar, arquivo.

## Arquivos afetados

- `src/lib/session-remotes.ts` — limitar a 1 slot
- `src/routes/present.$id.pair.tsx` — restaurar tela de pareamento (Etapa 1)
- `src/routes/present.$id.lobby.tsx` — **novo arquivo** (Etapa 2)
- `src/routes/-present.$id.component.tsx` — remover sidebar, adicionar overlay ranking central, remover 2º túnel, ajustar handlers
- `src/components/pairing-frame-overlay.tsx` — simplificar para 1 slot (ou substituir pela tela cheia da Etapa 1)
- `src/components/giant-qr-overlay.tsx` — manter mas estilizar como frame central
- `src/components/ranking-overlay.tsx` — **novo** (frame central de ranking)
- `src/components/remote-drawer.tsx` — nova organização da gaveta
- `src/routes/remote.$id.tsx` — nova UI hero AVANÇAR/VOLTAR/⚙️
- `src/routes/dashboard.tsx` — botão "Iniciar Apresentação" deve ir para `/present/$id/pair`
- `src/hooks/use-remote-bridge.tsx` — adicionar `TOGGLE_RANKING`, `END_EARLY`

## Perguntas antes de implementar

1. **Controle único vs duplo**: confirma reduzir de 2 para 1 slot? Isso quebra o pareamento existente de qualquer sessão em uso.
2. **Lobby separado**: criar nova rota `/present/$id/lobby` ou reaproveitar a já existente `/lobby/$id`?
3. **Funcionalidades existentes do celular** (laser por giroscópio, áudio, navegação por slides com keyboard): mantenho dentro da nova gaveta ⚙️ ou removo para simplificar?
4. **Coluna lateral atual** do projetor: remover completamente, ou manter como opção legada acionável via toggle?
