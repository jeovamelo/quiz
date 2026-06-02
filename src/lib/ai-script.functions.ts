import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";

async function callDeepseek(body: any): Promise<any> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY ausente");
  const res = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("DeepSeek error", res.status, t);
    throw new Error(`Falha na IA (${res.status})`);
  }
  return res.json();
}

// ============ Generate script per slide ============

const GenInput = z.object({
  presentationId: z.string().uuid(),
  pdfText: z.string().min(1).max(200000),
  numPages: z.number().min(1).max(500),
  context: z.string().max(5000).optional().default(""),
});

export const generateSlideScripts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => GenInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // Verifica que o usuário é dono
    const { data: pres } = await supabase
      .from("presentations")
      .select("id, title")
      .eq("id", data.presentationId)
      .maybeSingle();
    if (!pres) throw new Error("Apresentação não encontrada");

    const sys =
      "Você é um redator de roteiros para apresentações em Português do Brasil (PT-BR). " +
      "Dado o texto extraído de cada slide, gere um RESUMO FALADO conciso (3-6 frases, máx ~80 palavras) " +
      "para o palestrante autônomo ler em voz alta. Tom natural, claro, didático. " +
      "Use VOCABULÁRIO PT-BR: 'tela', 'celular', 'usuário'. NUNCA termos PT-PT. " +
      "NÃO use marcadores, listas ou markdown — apenas prosa fluida. " +
      "Responda chamando a função generate_scripts com um array contendo um item por slide.";

    const truncated = data.pdfText.slice(0, 80000);
    const user =
      `Contexto adicional: ${data.context || "(nenhum)"}\n\n` +
      `Título: ${pres.title}\n` +
      `Total de slides: ${data.numPages}\n\n` +
      `Texto dos slides:\n${truncated}\n\n` +
      `Gere ${data.numPages} roteiros, um para cada slide na ordem.`;

    const json = await callDeepseek({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "generate_scripts",
            description: "Retorna roteiros falados por slide em PT-BR",
            parameters: {
              type: "object",
              properties: {
                scripts: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      slide_number: { type: "number" },
                      script_text: { type: "string" },
                    },
                    required: ["slide_number", "script_text"],
                  },
                },
              },
              required: ["scripts"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "generate_scripts" } },
      max_tokens: 8000,
      temperature: 0.7,
    });

    const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
    const raw: string = toolCall?.function?.arguments ?? "";
    let parsed: { scripts: Array<{ slide_number: number; script_text: string }> };
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("IA retornou formato inválido");
      parsed = JSON.parse(m[0]);
    }

    // Upsert cada roteiro
    const rows = parsed.scripts
      .filter((s) => s.slide_number >= 1 && s.slide_number <= data.numPages)
      .map((s) => ({
        presentation_id: data.presentationId,
        slide_number: s.slide_number,
        script_text: (s.script_text || "").trim(),
      }));

    if (rows.length > 0) {
      const { error } = await (supabase.from("slide_scripts") as any).upsert(rows, {
        onConflict: "presentation_id,slide_number",
      });
      if (error) throw new Error(error.message);
    }

    return { count: rows.length };
  });

// ============ Audience question answering ============

const AnswerInput = z.object({
  sessionId: z.string().uuid(),
  question: z.string().min(1).max(1000),
});

export const answerAudienceQuestion = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => AnswerInput.parse(d))
  .handler(async ({ data }) => {
    // Usa admin para ler contexto da sessão (qualquer participante pode perguntar)
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: sess } = await supabaseAdmin
      .from("sessions")
      .select("id, presentation_id, current_slide")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (!sess) throw new Error("Sessão não encontrada");

    const { data: pres } = await supabaseAdmin
      .from("presentations")
      .select("title, ai_context")
      .eq("id", sess.presentation_id)
      .maybeSingle();

    const { data: script } = await (supabaseAdmin.from("slide_scripts") as any)
      .select("script_text")
      .eq("presentation_id", sess.presentation_id)
      .eq("slide_number", sess.current_slide)
      .maybeSingle();

    const ctx =
      `Apresentação: ${pres?.title ?? "(sem título)"}\n` +
      `Contexto geral: ${pres?.ai_context ?? "(nenhum)"}\n` +
      `Slide atual: ${sess.current_slide}\n` +
      `Roteiro do slide atual:\n${script?.script_text ?? "(não disponível)"}`;

    const json = await callDeepseek({
      model: "deepseek-chat",
      messages: [
        {
          role: "system",
          content:
            "Você é o palestrante virtual (mestre de cerimônias) respondendo perguntas da plateia em PT-BR. " +
            "TRIAGEM: avalie a RELEVÂNCIA da pergunta em relação ao tema do slide atual e ao roteiro. " +
            "Se a pergunta for ofensiva, fora de contexto, spam ou repetida, RECUSE educadamente em 1 frase. " +
            "Se for relevante, responda usando APENAS o contexto fornecido (apresentação + roteiro do slide atual). " +
            "Seja conciso (máx 4 frases, ~60 palavras), fale como uma pessoa explicando ao vivo, " +
            "respeitando a gestão de tempo da apresentação. " +
            "NUNCA use markdown — apenas prosa simples para ser lida em voz alta.",
        },
        { role: "user", content: `${ctx}\n\nPergunta da plateia: ${data.question}` },
      ],
      max_tokens: 400,
      temperature: 0.6,
    });

    const answer: string = json.choices?.[0]?.message?.content?.trim() ?? "";

    await (supabaseAdmin.from("sessions") as any)
      .update({
        audience_question: data.question,
        audience_question_answer: answer,
        audience_question_at: new Date().toISOString(),
      })
      .eq("id", data.sessionId);

    return { answer };
  });