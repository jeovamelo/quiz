## Plano: Edição Avançada de Apresentação + Pergunta Prêmio

### 1. Banco de Dados (migration)
Adicionar colunas:
- `presentations.default_time_limit` (integer, default 30) — tempo geral padrão da apresentação
- `questions.is_prize_question` (boolean, default false) — marca pergunta prêmio
- `questions.prize_multiplier` (integer, default 5) — multiplicador 3/4/5x
- `questions.difficulty` (text, default 'medium') — easy/medium/hard/extreme (se ainda não existir; verificar schema atual)

Observação: `questions.time_limit` já existe. NULL/0 = usar padrão geral.

### 2. Tela de Edição (`src/routes/quiz.$id.edit.tsx`)

**Cabeçalho novo:**
- Input "Nome da Apresentação" pré-preenchido com `presentations.title`
- Seletor "Tempo Geral de Resposta (Padrão)" com opções 15s/30s/45s/60s/90s

**Card de cada pergunta:**
- Campo numérico "Tempo de Resposta para esta pergunta" — placeholder mostra o tempo geral; se vazio, salva como `time_limit = 0` (usa padrão)
- Switch "Definir como Pergunta Prêmio 🏆"
- Quando ativo: dificuldade trava em "Extremo", seletor de multiplicador (3x/4x/5x), badge animado "⚡ PERGUNTA PRÊMIO", borda dourada `#FFCB05`, fundo `#1F1E24`

**Save:**
- UPDATE em `presentations` (title, default_time_limit)
- UPSERT em `questions` com novos campos

### 3. Tela de Projeção (`src/routes/present.$id.tsx`)
- Resolver tempo: `question.time_limit > 0 ? question.time_limit : presentation.default_time_limit`
- Se `is_prize_question`: cronômetro amarelo `#FFCB05` com `animate-pulse`, badge gigante piscando "ATENÇÃO: PERGUNTA PRÊMIO VALENDO {multiplier}X MAIS PONTOS!"
- Pontuação multiplicada por `prize_multiplier` ao gravar resposta correta

### 4. Tela do Participante (`src/routes/join.tsx` ou rota de quiz ao vivo)
- Quando pergunta ativa tem `is_prize_question`: overlay fullscreen dourado/laranja com faíscas, texto "⚡ HORA DA VIRADA! Pergunta Prêmio Ativa! Vale até {max} pontos!"
- Disparar `navigator.vibrate([200,100,200,100,200])` em loop curto

### 5. Cálculo de Pontos
No handler de resposta (provavelmente no celular ou trigger de score), multiplicar pontos base pelo `prize_multiplier` quando `is_prize_question = true`.

### Arquivos a tocar
- migration nova
- `src/routes/quiz.$id.edit.tsx`
- `src/routes/present.$id.tsx`
- rota do participante ao vivo (preciso localizar — provavelmente `src/routes/play.$id.tsx` ou similar dentro de `join`)

### Perguntas antes de continuar
1. Existe coluna `difficulty` em `questions` hoje? (não aparece no schema fornecido — vou adicionar)
2. Qual o valor base de pontos por pergunta hoje? Há lógica de pontuação por dificuldade já implementada ou todos valem igual? Vou assumir que o `prize_multiplier` apenas multiplica o score atual calculado.

Confirma para eu prosseguir com a migration + implementação?