import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  pdfText: z.string().min(1).max(200000),
  context: z.string().max(5000).optional().default(""),
  count: z.number().min(1).max(20).default(5),
  numPages: z.number().min(1).max(500),
});

export const generateQuestions = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) throw new Error("DEEPSEEK_API_KEY ausente");

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
      "Defina 'display_mode' como 'simultaneous' (mostrada junto com o slide) ou 'after_slide' (após o slide). " +
      "Sempre responda chamando a função generate_quiz.";

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
    const parsed = JSON.parse(toolCall.function.arguments) as {
      questions: Array<{
        question_text: string;
        question_type: "multiple_choice" | "true_false";
        options: Record<string, string>;
        correct_option: string;
        slide_number: number;
        display_mode: "simultaneous" | "after_slide";
      }>;
    };

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
