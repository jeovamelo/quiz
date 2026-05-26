import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  pdfText: z.string().min(1).max(200000),
  context: z.string().max(5000).optional().default(""),
  count: z.number().min(1).max(20).default(5),
  numPages: z.number().min(1).max(500),
  difficulty: z.enum(["easy", "medium", "hard"]).optional().default("medium"),
  displayMode: z.enum(["simultaneous", "after_slide"]).optional().default("simultaneous"),
});

export const generateQuestions = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) throw new Error("DEEPSEEK_API_KEY ausente");

    const difficultyInstruction =
      data.difficulty === "easy"
        ? "NÍVEL DE DIFICULDADE: FÁCIL. Gere perguntas diretas e conceituais, com enunciados curtos e respostas óbvias para quem prestou atenção no slide."
        : data.difficulty === "hard"
        ? "NÍVEL DE DIFICULDADE: DIFÍCIL. Gere perguntas analíticas e desafiadoras, que exijam interpretação, análise crítica e atenção a detalhes sutis do conteúdo."
        : "NÍVEL DE DIFICULDADE: MÉDIO. Gere perguntas que exijam atenção aos detalhes do conteúdo, equilibrando clareza e desafio.";

    const displayModeInstruction =
      data.displayMode === "after_slide"
        ? "MOMENTO DE ENVIO PADRÃO: defina 'display_mode' = 'after_slide' em TODAS as perguntas."
        : "MOMENTO DE ENVIO PADRÃO: defina 'display_mode' = 'simultaneous' em TODAS as perguntas.";

    const sys =
      "Você gera perguntas de fixação ESTRITAMENTE em Português do Brasil (PT-BR) a partir do conteúdo de slides de uma apresentação corporativa. " +
      "VOCABULÁRIO OBRIGATÓRIO PT-BR: use 'tela', 'celular', 'usuário'. NUNCA use termos de Português de Portugal (ex.: 'ecrã', 'telemóvel', 'utilizador'). " +
      "REGRA DE PROPORÇÃO (OBRIGATÓRIA): exatamente 80% das perguntas devem ser do tipo 'true_false' e 20% do tipo 'multiple_choice'. " +
      "Arredonde a favor de V/F. Ex.: 5 perguntas => 4 V/F + 1 MC; 10 => 8 V/F + 2 MC; 3 => 2 V/F + 1 MC; 1 => 1 V/F. " +
      "Para 'true_false', use SEMPRE apenas as chaves A='VERDADEIRO' e B='FALSO'. " +
      "Para 'multiple_choice', use APENAS 2 ou 3 alternativas (A e B, opcionalmente C). NUNCA gere 4 opções. " +
      "Alternativas de múltipla escolha devem ser extremamente curtas, diretas e objetivas (palavras-chave, números ou frases curtas). " +
      "Evite pegadinhas, enunciados longos e alternativas parecidas — o usuário responde pelo celular e precisa de leitura rápida. " +
      "Vincule cada pergunta ao número do slide mais relevante via 'slide_number'. " +
      displayModeInstruction + " " +
      difficultyInstruction + " " +
      "Sempre responda chamando a função generate_quiz. " +
      "FORMATO DA RESPOSTA: responda APENAS e EXCLUSIVAMENTE com o objeto JSON estruturado nos argumentos da função. " +
      "Não adicione saudações, não use delimitadores de markdown (como ```json ou ```), não dê explicações complementares " +
      "e não insira nenhum caractere, comentário ou quebra de linha após o fechamento da última chave '}' do objeto.";

    const truncated = data.pdfText.slice(0, 80000);
    const user =
      `Contexto adicional do palestrante: ${data.context || "(nenhum)"}\n\n` +
      `Total de slides: ${data.numPages}\n\n` +
      `Texto extraído dos slides:\n${truncated}\n\n` +
      `Gere exatamente ${data.count} perguntas variadas.`;

    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_quiz",
              description: "Retorna perguntas estruturadas em PT-BR",
              parameters: {
                type: "object",
                properties: {
                  questions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        question_text: { type: "string" },
                        question_type: {
                          type: "string",
                          enum: ["multiple_choice", "true_false"],
                        },
                        options: {
                          type: "object",
                          properties: {
                            A: { type: "string" },
                            B: { type: "string" },
                            C: { type: "string" },
                          },
                          required: ["A", "B"],
                        },
                        correct_option: { type: "string", enum: ["A", "B", "C"] },
                        slide_number: { type: "number" },
                        display_mode: {
                          type: "string",
                          enum: ["simultaneous", "after_slide"],
                        },
                      },
                      required: [
                        "question_text",
                        "question_type",
                        "options",
                        "correct_option",
                        "slide_number",
                        "display_mode",
                      ],
                    },
                  },
                },
                required: ["questions"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "generate_quiz" } },
        max_tokens: 8000,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("AI gateway error:", res.status, body);
      if (res.status === 429)
        throw new Error("Limite de requisições atingido. Tente novamente em instantes.");
      if (res.status === 402)
        throw new Error("Créditos de IA esgotados. Adicione créditos no workspace.");
      throw new Error(`Falha na IA (${res.status})`);
    }

    const json = await res.json();
    const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      throw new Error("IA não retornou perguntas estruturadas");
    }
    const rawArgs: string = toolCall.function.arguments;
    const finishReason = json.choices?.[0]?.finish_reason;
    if (finishReason === "length") {
      console.error("DeepSeek truncou a resposta (finish_reason=length)");
      throw new Error("Resposta da IA foi truncada. Reduza a quantidade de perguntas ou o tamanho do PDF.");
    }

    // Extração robusta: alguns modelos concatenam mais de um objeto JSON
    // ou adicionam texto/markdown fora do bloco. Pegamos apenas o primeiro
    // objeto JSON bem-formado equilibrando chaves.
    function extractFirstJsonObject(s: string): string {
      const start = s.indexOf("{");
      if (start < 0) return s;
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === "\\") esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) return s.slice(start, i + 1);
        }
      }
      return s.slice(start);
    }

    // Parse defensivo com RegEx guard: limpa markdown e isola o bloco JSON.
    function safeParseAIResponse(rawResponse: string): unknown {
      const cleanedText = rawResponse
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      // 1ª tentativa: parse direto
      try {
        return JSON.parse(cleanedText);
      } catch {
        // continua para fallback
      }

      // 2ª tentativa: RegEx capturando entre a primeira '{' e a última '}'
      const jsonRegex = /\{[\s\S]*\}/;
      const match = cleanedText.match(jsonRegex);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch {
          // continua para fallback
        }
      }

      // 3ª tentativa: extrai o primeiro objeto JSON bem-formado
      try {
        return JSON.parse(extractFirstJsonObject(cleanedText));
      } catch (error) {
        console.error(
          "[ERRO AUDITORIA IA]: Falha crítica ao fazer o parse do JSON.",
          error,
        );
        throw new Error(
          "A resposta da IA veio em um formato inválido. Por favor, clique em gerar novamente.",
        );
      }
    }

    let parsed: {
      questions: Array<{
        question_text: string;
        question_type: "multiple_choice" | "true_false";
        options: Record<string, string>;
        correct_option: string;
        slide_number: number;
        display_mode: "simultaneous" | "after_slide";
      }>;
    };
    parsed = safeParseAIResponse(rawArgs) as typeof parsed;
    const _typed = parsed as {
      questions: Array<{
        question_text: string;
        question_type: "multiple_choice" | "true_false";
        options: Record<string, string>;
        correct_option: string;
        slide_number: number;
        display_mode: "simultaneous" | "after_slide";
      }>;
    };
    void _typed;

    // Normalização defensiva: garante V/F com A=VERDADEIRO/B=FALSO e MC com no máximo 3 opções
    const normalized = parsed.questions.map((q) => {
      if (q.question_type === "true_false") {
        return {
          ...q,
          options: { A: "VERDADEIRO", B: "FALSO" },
          correct_option: q.correct_option === "B" ? "B" : "A",
        };
      }
      const opts: Record<string, string> = { A: q.options.A, B: q.options.B };
      if (q.options.C) opts.C = q.options.C;
      const allowed = Object.keys(opts);
      return {
        ...q,
        options: opts,
        correct_option: allowed.includes(q.correct_option) ? q.correct_option : "A",
      };
    });

    return { questions: normalized };
  });
