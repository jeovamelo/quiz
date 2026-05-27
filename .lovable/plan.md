## Objetivo

Transformar o celular do palestrante logado em um "clicker" físico: ele escolhe a apresentação no celular, dispara no projetor via Realtime e comanda tudo com botão "Avançar" gigante. O projetor (computador) fica em modo lobby ouvindo comandos.

## 1. Detecção de dispositivo + redirecionamento

- Em `src/routes/dashboard.tsx`: ao detectar mobile (`useIsMobile`) + usuário logado, redirecionar automaticamente para nova rota `/remote` (hub do celular). Manter dashboard normal em desktop.

## 2. Nova rota `/remote` — Hub de seleção no celular

Novo arquivo `src/routes/remote.index.tsx`:
- Lista eventos do palestrante e, dentro de cada um, cards de apresentações
- Cada card tem botão destacado **"Apresentar no Projetor"** (ícone Tv/Play)
- Ao clicar: cria/atualiza uma `session` para aquela apresentação, marca `status='presenting'`, e envia broadcast Realtime no canal `event-lobby-{event_id}` com `{ type: 'launch', session_id, presentation_id }`
- Em seguida, navega o celular para `/remote/$id` (controle remoto já existente)

## 3. Nova rota `/event/$id/lobby` — Modo Receptor (projetor)

Novo arquivo `src/routes/event.$id.lobby.tsx`:
- Tela cheia em modo espera com mensagem "Aguardando palestrante iniciar apresentação pelo celular..."
- Mostra QR/lista das apresentações do evento (só visual)
- Inscreve-se no canal Realtime `event-lobby-{id}`
- Ao receber evento `launch`, navega automaticamente para `/present/{session_id}` em tela cheia
- Também ouve evento `return_to_lobby` para voltar à espera

## 4. Refatorar `/remote/$id` — Interface clicker otimizada

Editar `src/routes/remote.$id.tsx`:
- **Remover** exibição do texto/alternativas/gabarito da pergunta atual (regra de ouro)
- Cabeçalho compacto: título da palestra + indicador "Slide X de Y" + contador de usuários online + botão "Sair" (volta ao hub via modal de confirmação que dispara `return_to_lobby` no canal e limpa `active_question_id`)
- **Console de Quiz** (somente se slide atual tem pergunta vinculada):
  - Botão "Lançar Quiz"
  - Botão "Mostrar Resultados" (dispara broadcast `toggle_ranking` show=true ou marca `question_revealed`)
  - Switch "Ativar Pergunta Prêmio" (toggla `is_prize_question` + `prize_multiplier` 3-5x na pergunta)
- **Botão herói "AVANÇAR"**: ~70% da área útil inferior, gradiente `#A6193C → #F68B1F`, ícone `ArrowRight` grande, texto "AVANÇAR" em tamanho dominante
- **Botão "Voltar"**: pequeno, isolado no canto, estilo outline cinza `#1E2235`, ícone `ChevronLeft`

## 5. Modal "Sair da Apresentação"

No cabeçalho do `/remote/$id`:
- Botão "Mudar de Palestra" abre `AlertDialog`: "Deseja fechar esta apresentação no projetor e escolher outra?"
- Confirmar: marca session como `ended` (ou limpa `active_question_id`), envia broadcast `return_to_lobby` no canal `event-lobby-{event_id}`, navega celular para `/remote`
- Projetor recebe e volta para `/event/$id/lobby`

## 6. Detalhes técnicos

- Canal Realtime novo: `event-lobby-${event_id}` (broadcast events: `launch`, `return_to_lobby`)
- Total de usuários online: count de `participants` por `event_id` agregando sessões do evento
- Para pergunta prêmio: update na tabela `questions` (`is_prize_question`, `prize_multiplier`)
- Nenhuma mudança de schema necessária — colunas já existem

## Arquivos

- **Criar**: `src/routes/remote.index.tsx`, `src/routes/event.$id.lobby.tsx`
- **Editar**: `src/routes/remote.$id.tsx` (refatoração de UI + console quiz + botão herói + sair), `src/routes/dashboard.tsx` (redirect mobile→/remote)
- **Auto-gerado**: `src/routeTree.gen.ts`
