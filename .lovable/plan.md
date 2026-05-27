# Plano de Refatoração: Controle Remoto P2P + Painel Multifuncional

Trabalho grande, dividido em 5 fases. Tudo em **PT-BR** (celular, tela, usuário, cadastrar, arquivo).

## Fase 1 — Tela de pareamento no projetor (`/present/$id/pair`)

Já existe (`src/routes/present.$id.pair.tsx`), mas hoje o Dashboard pula direto pro lobby/present. Vou:
- Garantir que **"Iniciar Apresentação"** no Dashboard e na página do Evento sempre passe por `/present/$id/pair` **antes** de qualquer slide.
- Redesenhar a tela: título "Conectar Controles Remotos", QR code grande, 2 slots (1 obrigatório visual, 2 opcional), botão de rodapé **"Iniciar Apresentação Agora 🚀"** sempre habilitado.
- Adicionar etiqueta de status de rede (verde "Conexão Direta Ativa" / amarela piscante "Redes Diferentes").

## Fase 2 — Captura de nome no celular (`/remote/$id/join`)

- Tela única: campo "Qual é o seu nome?" + botão gradiente BNB "Ativar Controle Remoto 📱".
- Sem login/email. Grava nome + `device_token` em `session_remotes` (já existe), reivindica slot 1 ou 2, redireciona para `/remote/$id`.

## Fase 3 — Túnel WebRTC P2P com fallback

Novo hook `src/hooks/use-webrtc-control.tsx`:
- **Sinalização** via canal Supabase Realtime `session_signaling_{sessionId}_{slot}` (broadcast SDP offer/answer + ICE candidates). Nada persistido em tabela.
- Projetor cria `RTCPeerConnection` por slot, emite SDP offer ao detectar novo remote pareado. Celular escuta o canal ao entrar, envia answer + ICE.
- `RTCDataChannel('control-channel')` ordenado.
- **Timeout 8s**: se `iceConnectionState` não chegar em `connected`/`completed`, marca `network: 'fallback'` e usa Supabase Realtime broadcast como transporte.
- Estados expostos: `transport: 'p2p' | 'fallback' | 'connecting'`, `send(msg)`, `onMessage(cb)`.
- Etiqueta verde quando P2P; barra amarela piscante no topo do celular e do projetor quando fallback.

Protocolo de mensagens (JSON):
```
{ type: 'NEXT_STEP' | 'PREV_STEP' | 'TOGGLE_FULLSCREEN' | 'TOGGLE_QR_SIDEBAR'
       | 'TOGGLE_RANKING' | 'TOGGLE_SIDEBAR' | 'SHOW_GIANT_QR' | 'HIDE_GIANT_QR'
       | 'END_PRESENTATION', ts: number, from: 1 | 2 }
```
Projetor executa por ordem cronológica de chegada (concorrência natural do socket).

## Fase 4 — Nova UI do controle remoto (`/remote/$id`)

`height: 100dvh`, sem rolagem:
- **AVANÇAR** gigante (70% do rodapé, gradiente BNB, envia `NEXT_STEP`).
- **VOLTAR** pequeno, cinza escuro, base extrema (`PREV_STEP`).
- Botão central **"Outras Funcionalidades ⚙️"** abre Drawer com:
  - Alternar Tela Cheia
  - Exibir/Ocultar QR Code lateral
  - Exibir/Ocultar Ranking
  - Exibir/Ocultar Barra Lateral
  - Exibir QR Code Gigante 🎯
  - Encerrar Apresentação (vermelho, com confirmação)
- Badge de transporte (verde P2P / amarela fallback).

## Fase 5 — Receptor no projetor (`-present.$id.component.tsx`)

- Monta `useWebRTCControl({ role: 'host' })` por slot.
- Handlers para cada tipo de mensagem (já existem flags em `sessions`: `show_sidebar`, `show_ranking`, `show_join_qr`, `is_fullscreen`).
- **Overlay QR Gigante**: novo modal full-screen translúcido com o QR de `/join?session=ID`.
- **Chevron flutuante** na borda interna da sidebar direita para ocultar/exibir localmente.
- Badge no topo do projetor: "🟢 Conexão Direta Ativa" ou "⚠️ Redes Diferentes Detectadas".

## Arquivos afetados

**Novos:**
- `src/hooks/use-webrtc-control.tsx` — handshake + fallback + send/recv
- `src/components/network-status-badge.tsx`
- `src/components/giant-qr-overlay.tsx`

**Editados:**
- `src/routes/dashboard.tsx` — sempre navegar para `/present/$id/pair`
- `src/routes/event.$id.tsx` — idem
- `src/routes/present.$id.pair.tsx` — host WebRTC + UI refinada
- `src/routes/remote.$id.join.tsx` — tela "Qual é o seu nome?"
- `src/routes/remote.$id.tsx` — nova UI ergonômica + drawer + WebRTC client
- `src/routes/-present.$id.component.tsx` — receptor multi-canal, overlay QR gigante, chevron sidebar, badge de rede
- `src/routes/remote-setup.$id.tsx` — manter redirect

**Sem mudanças de schema:** `session_remotes` e `sessions` já cobrem todas as flags necessárias. Sinalização WebRTC é efêmera via Realtime broadcast.

## Riscos e notas

- WebRTC em browsers sem permissão de rede local: fallback automático em 8s, sem bloquear o usuário.
- Concorrência dos 2 controles: cada slot tem seu próprio `RTCPeerConnection`; o projetor processa mensagens na ordem de chegada (não há merge/dedupe — comportamento solicitado).
- Sem servidor STUN/TURN próprio: uso `stun:stun.l.google.com:19302` (público) só para descoberta ICE local; o caminho P2P real é LAN.
- Tudo PT-BR, paleta BNB já existente (`#A6193C` → `#F68B1F`).
