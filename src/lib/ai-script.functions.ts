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

const QuestionSubmitInput = z.object({
  sessionId: z.string().uuid(),
  question: z.string().min(1).max(1000),
  participantId: z.string().uuid().optional(),
});

export const submitAudienceQuestion = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => QuestionSubmitInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Verifica se o microfone está habilitado na sessão
    const { data: sess } = await (supabaseAdmin
      .from("sessions") as any)
      .select("mic_enabled")
      .eq("id", data.sessionId)
      .maybeSingle();

    if (sess && sess.mic_enabled === false) {
      throw new Error("O microfone da plateia está desativado pelo palestrante.");
    }

    const { error } = await ((supabaseAdmin as any)
      .from("audience_questions"))
      .insert({
        session_id: data.sessionId,
        participant_id: data.participantId,
        question_text: data.question,
        status: "pending",
      });

    if (error) throw new Error(error.message);
    return { success: true };
  });

const QuestionStatusInput = z.object({
  questionId: z.string().uuid(),
  status: z.enum(["pending", "approved", "ignored", "answered"]),
});

export const updateAudienceQuestionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => QuestionStatusInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await ((supabaseAdmin as any)
      .from("audience_questions"))
      .update({ status: data.status })
      .eq("id", data.questionId);

    if (error) throw new Error(error.message);

    // Se aprovado e for modo IA, pode disparar a resposta automática (ou o palestrante decide quando)
    // Para simplificar, se status for 'answered', o trigger já sincroniza com a sessão.
    
    return { success: true };
  });

const AnswerInput = z.object({
  sessionId: z.string().uuid(),
  questionId: z.string().uuid(),
});

export const answerAudienceQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AnswerInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: qRow } = await ((supabaseAdmin as any)
      .from("audience_questions"))
      .select("*")
      .eq("id", data.questionId)
      .maybeSingle();
    
    if (!qRow) throw new Error("Pergunta não encontrada");

    const { data: sess } = await supabaseAdmin
      .from("sessions")
      .select("id, presentation_id, current_slide")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (!sess) throw new Error("Sessão não encontrada");

    const { data: pres } = await supabaseAdmin
      .from("presentations")
      .select("title, ai_context, ai_max_answer_seconds")
      .eq("id", sess.presentation_id)
      .maybeSingle();

    const { data: script } = await (supabaseAdmin.from("slide_scripts") as any)
      .select("script_text")
      .eq("presentation_id", sess.presentation_id)
      .eq("slide_number", sess.current_slide)
      .maybeSingle();

    const maxSec = Math.max(5, Number((pres as any)?.ai_max_answer_seconds ?? 30));
    const wordBudget = Math.max(15, Math.round((maxSec / 60) * 150));

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
            "Se for relevante, responda usando APENAS o contexto fornecido (apresentação + roteiro do slide atual). " +
            `Seja conciso: NO MÁXIMO ${wordBudget} palavras (cabe em ${maxSec}s de fala). ` +
            "Fale como uma pessoa explicando ao vivo, respeitando a gestão de tempo. " +
            "NUNCA use markdown — apenas prosa simples para ser lida em voz alta.",
        },
        { role: "user", content: `${ctx}\n\nPergunta da plateia: ${(qRow as any).question_text}` },
      ],
      max_tokens: 400,
      temperature: 0.6,
    });

    const answer: string = json.choices?.[0]?.message?.content?.trim() ?? "";
    const answerWords = answer.trim().split(/\s+/).filter(Boolean).length;
    const spentSec = Math.max(1, Math.round(answerWords / 2.5));

    const { data: sessTime } = await (supabaseAdmin.from("sessions") as any)
      .select("time_used_seconds")
      .eq("id", data.sessionId)
      .maybeSingle();
    
    const newUsed = Number((sessTime as any)?.time_used_seconds ?? 0) + spentSec;

    // Atualiza a pergunta para 'answered'
    await ((supabaseAdmin as any)
      .from("audience_questions"))
      .update({ 
        answer_text: answer,
        status: "answered"
      })
      .eq("id", data.questionId);

    // O tempo usado é atualizado na sessão (o trigger cuida do texto da resposta)
    await (supabaseAdmin.from("sessions") as any)
      .update({ time_used_seconds: newUsed })
      .eq("id", data.sessionId);

    try {
      await maybeAutoCondense(supabaseAdmin, data.sessionId);
    } catch (e) {
      console.error("auto-condense failed", e);
    }

    return { answer, spentSec };
  });

// ============ Dynamic time management helpers ============

async function condenseRemainingForSession(
  supabaseAdmin: any,
  sessionId: string,
  targetRemainingSeconds: number,
) {
  const { data: sess } = await supabaseAdmin
    .from("sessions")
    .select("presentation_id, current_slide")
    .eq("id", sessionId)
    .maybeSingle();
  if (!sess) throw new Error("Sessão não encontrada");

  const { data: rows } = await supabaseAdmin
    .from("slide_scripts")
    .select("slide_number, script_text, script_text_original")
    .eq("presentation_id", sess.presentation_id)
    .gte("slide_number", sess.current_slide)
    .order("slide_number");
  const scripts = (rows ?? []) as Array<{
    slide_number: number;
    script_text: string;
    script_text_original: string | null;
  }>;
  if (scripts.length === 0) return { count: 0 };

  // Distribui o orçamento entre os slides restantes (~150 palavras/min)
  const perSlideSec = Math.max(10, Math.floor(targetRemainingSeconds / scripts.length));
  const perSlideWords = Math.max(20, Math.round((perSlideSec / 60) * 150));

  // Marca que a IA está ajustando o roteiro (para a UI mostrar feedback)
  await supabaseAdmin
    .from("sessions")
    .update({ ai_adjusting: true })
    .eq("id", sessionId);

  try {
    const slidesPayload = scripts
      .map((s) => `Slide ${s.slide_number}:\n${(s.script_text ?? "").trim()}`)
      .join("\n\n---\n\n");

    const sys =
      "Você reescreve roteiros de slides em PT-BR para CONDENSAR o tempo de fala. " +
      `Cada slide deve caber em ~${perSlideWords} palavras (≈${perSlideSec}s). ` +
      "Preserve o sentido essencial; corte exemplos longos, repetições e digressões. " +
      "Vocabulário PT-BR ('tela', 'celular', 'usuário'). Prosa fluida, sem markdown. " +
      "Responda chamando a função condense_scripts.";

    const json = await callDeepseek({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: sys },
        {
          role: "user",
          content: `Reescreva os ${scripts.length} roteiros restantes:\n\n${slidesPayload}`,
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "condense_scripts",
            description: "Retorna roteiros condensados por slide em PT-BR",
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
      tool_choice: { type: "function", function: { name: "condense_scripts" } },
      max_tokens: 8000,
      temperature: 0.5,
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

    const byNum = new Map(parsed.scripts.map((s) => [s.slide_number, s.script_text]));
    const updates = scripts
      .filter((s) => byNum.has(s.slide_number))
      .map((s) => ({
        presentation_id: sess.presentation_id,
        slide_number: s.slide_number,
        script_text: (byNum.get(s.slide_number) || "").trim(),
        // Preserva original somente se ainda não houver backup
        script_text_original: s.script_text_original ?? s.script_text ?? "",
      }));

    if (updates.length > 0) {
      await supabaseAdmin.from("slide_scripts").upsert(updates, {
        onConflict: "presentation_id,slide_number",
      });
    }

    await supabaseAdmin
      .from("sessions")
      .update({
        ai_adjusting: false,
        ai_last_adjustment_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    return { count: updates.length };
  } catch (err) {
    await supabaseAdmin
      .from("sessions")
      .update({ ai_adjusting: false })
      .eq("id", sessionId);
    throw err;
  }
}

async function maybeAutoCondense(supabaseAdmin: any, sessionId: string) {
  const { data: sess } = await supabaseAdmin
    .from("sessions")
    .select(
      "presentation_id, current_slide, time_used_seconds, time_budget_seconds, ai_adjusting",
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (!sess) return;
  if (sess.ai_adjusting) return;

  // Carrega scripts restantes
  const { data: rows } = await supabaseAdmin
    .from("slide_scripts")
    .select("slide_number, script_text")
    .eq("presentation_id", sess.presentation_id)
    .gte("slide_number", sess.current_slide);
  const remaining = (rows ?? []) as Array<{ slide_number: number; script_text: string }>;
  if (remaining.length === 0) return;

  const remainingWords = remaining.reduce(
    (acc, s) => acc + (s.script_text?.trim().split(/\s+/).filter(Boolean).length ?? 0),
    0,
  );
  const remainingReadingSec = Math.round((remainingWords / 150) * 60);

  const budget = Number(sess.time_budget_seconds ?? 0);
  if (budget <= 0) return; // sem orçamento definido → nada a fazer

  const used = Number(sess.time_used_seconds ?? 0);
  const remainingBudget = budget - used;
  // Se a leitura restante já cabe (com folga de 5%), não mexe
  if (remainingReadingSec <= Math.floor(remainingBudget * 1.05)) return;

  // Caso contrário, condensa os slides restantes para caber no restante
  const target = Math.max(30, remainingBudget);
  await condenseRemainingForSession(supabaseAdmin, sessionId, target);
}

// Server-fn público: ajustar o tempo total da sessão (no início ou ao vivo)
const AdjustInput = z.object({
  sessionId: z.string().uuid(),
  totalMinutes: z.number().min(1).max(600),
  rewrite: z.boolean().optional().default(true),
});

export const adjustSessionTimeBudget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AdjustInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const seconds = Math.round(data.totalMinutes * 60);

    const { data: sess } = await supabaseAdmin
      .from("sessions")
      .select("started_at, time_used_seconds")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (!sess) throw new Error("Sessão não encontrada");

    await supabaseAdmin
      .from("sessions")
      .update({
        time_budget_seconds: seconds,
        started_at: (sess as any).started_at ?? new Date().toISOString(),
      })
      .eq("id", data.sessionId);

    if (data.rewrite) {
      const remainingBudget = Math.max(
        30,
        seconds - Number((sess as any).time_used_seconds ?? 0),
      );
      await condenseRemainingForSession(
        supabaseAdmin,
        data.sessionId,
        remainingBudget,
      );
    }
    return { ok: true, budgetSeconds: seconds };
  });

// ============ Expand / Revert scripts ============

const ExpandInput = z.object({
  presentationId: z.string().uuid(),
  level: z.enum(["concise", "standard", "extensive"]).default("standard"),
});

export const expandSlideScripts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ExpandInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: pres } = await supabase
      .from("presentations")
      .select("id, title, ai_context")
      .eq("id", data.presentationId)
      .maybeSingle();
    if (!pres) throw new Error("Apresentação não encontrada");

    const { data: rows } = await (supabase.from("slide_scripts") as any)
      .select("slide_number, script_text, script_text_original")
      .eq("presentation_id", data.presentationId)
      .order("slide_number");
    const scripts = (rows ?? []) as Array<{
      slide_number: number;
      script_text: string;
      script_text_original: string | null;
    }>;
    if (scripts.length === 0) throw new Error("Nenhum roteiro para expandir. Gere primeiro.");

    const levelInstr =
      data.level === "concise"
        ? "Mantenha CONCISO: ~80-120 palavras por slide."
        : data.level === "extensive"
        ? "Seja EXTENSO: ~220-300 palavras por slide, sem encher linguiça."
        : "Use detalhamento PADRÃO: ~150-200 palavras por slide.";

    const sys =
      "Você reescreve roteiros de slides em PT-BR para expandir o tempo de fala do palestrante. " +
      "REGRAS: (1) acrescente ANALOGIAS práticas e CASOS DE USO reais relacionados ao tema do slide; " +
      "(2) APROFUNDE conceitos técnicos explicando o 'porquê' e o 'como'; " +
      "(3) inclua FRASES DE CONEXÃO entre slides convidando a plateia a refletir; " +
      "(4) PRESERVE o sentido original e o vocabulário PT-BR ('tela', 'celular', 'usuário'); " +
      "(5) NUNCA use markdown, listas ou marcadores — apenas prosa fluida para ser lida em voz alta. " +
      levelInstr +
      " Responda chamando a função expand_scripts com um array contendo um item por slide.";

    const slidesPayload = scripts
      .map(
        (s) =>
          `Slide ${s.slide_number}:\n${(s.script_text_original ?? s.script_text ?? "").trim()}`,
      )
      .join("\n\n---\n\n");

    const user =
      `Título: ${pres.title}\n` +
      `Contexto adicional: ${pres.ai_context ?? "(nenhum)"}\n\n` +
      `Reescreva os ${scripts.length} roteiros abaixo, mantendo o mesmo número de slides e ordem.\n\n` +
      slidesPayload;

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
            name: "expand_scripts",
            description: "Retorna roteiros expandidos por slide em PT-BR",
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
      tool_choice: { type: "function", function: { name: "expand_scripts" } },
      max_tokens: 12000,
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

    const byNum = new Map(parsed.scripts.map((s) => [s.slide_number, s.script_text]));
    const updates = scripts
      .filter((s) => byNum.has(s.slide_number))
      .map((s) => ({
        presentation_id: data.presentationId,
        slide_number: s.slide_number,
        script_text: (byNum.get(s.slide_number) || "").trim(),
        // Preserva o original na primeira expansão
        script_text_original: s.script_text_original ?? s.script_text ?? "",
      }));

    if (updates.length > 0) {
      const { error } = await (supabase.from("slide_scripts") as any).upsert(updates, {
        onConflict: "presentation_id,slide_number",
      });
      if (error) throw new Error(error.message);
    }

    return { count: updates.length };
  });

const RevertInput = z.object({
  presentationId: z.string().uuid(),
});

export const revertSlideScripts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RevertInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: rows } = await (supabase.from("slide_scripts") as any)
      .select("slide_number, script_text_original")
      .eq("presentation_id", data.presentationId)
      .not("script_text_original", "is", null);
    const scripts = (rows ?? []) as Array<{
      slide_number: number;
      script_text_original: string | null;
    }>;
    if (scripts.length === 0)
      throw new Error("Não há roteiro original para reverter.");

    const updates = scripts.map((s) => ({
      presentation_id: data.presentationId,
      slide_number: s.slide_number,
      script_text: s.script_text_original ?? "",
      script_text_original: null,
    }));

    const { error } = await (supabase.from("slide_scripts") as any).upsert(updates, {
      onConflict: "presentation_id,slide_number",
    });
    if (error) throw new Error(error.message);
    return { count: updates.length };
  });