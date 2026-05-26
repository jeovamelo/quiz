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
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY ausente");

    const sys =
      "Você gera perguntas de fixação em Português do Brasil a partir do conteúdo de slides de uma apresentação corporativa. " +
      "Misture perguntas de Múltipla Escolha (4 alternativas A, B, C, D) e Verdadeiro/Falso (use as chaves A='Verdadeiro' e B='Falso'). " +
      "Vincule cada pergunta ao número do slide mais relevante. Sempre responda chamando a função generate_quiz.";

    const truncated = data.pdfText.slice(0, 80000);
    const user =
      `Contexto adicional do palestrante: ${data.context || "(nenhum)"}\n\n` +
      `Total de slides: ${data.numPages}\n\n` +
      `Texto extraído dos slides:\n${truncated}\n\n` +
      `Gere exatamente ${data.count} perguntas variadas.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
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
                            D: { type: "string" },
                          },
                          required: ["A", "B"],
                        },
                        correct_option: { type: "string", enum: ["A", "B", "C", "D"] },
                        slide_number: { type: "number" },
                      },
                      required: [
                        "question_text",
                        "question_type",
                        "options",
                        "correct_option",
                        "slide_number",
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
      }>;
    };
    return { questions: parsed.questions };
  });
