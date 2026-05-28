import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Upload, FileCheck2, Loader2, Sparkles, ChevronLeft, ChevronRight, Trash2, Shield, Zap, Clock, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRequireSpeaker } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { extractPdfText } from "@/lib/pdf-extract";
import { generateQuestions } from "@/lib/ai.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/quiz/new")({
  head: () => ({ meta: [{ title: "Novo Quiz — QuizBini" }] }),
  validateSearch: (s: Record<string, unknown>): { eventId?: string } => ({
    eventId: (s.eventId as string) || undefined,
  }),
  component: NewQuiz,
});

type DraftQuestion = {
  question_text: string;
  question_type: "multiple_choice" | "true_false";
  options: Record<string, string>;
  correct_option: string;
  slide_number: number;
  display_mode: "simultaneous" | "after_slide";
  time_limit: number;
};

function Stepper({ step }: { step: number }) {
  const labels = ["Carregar PDF", "IA & Configuração", "Revisão"];
  return (
    <div className="mb-8 flex items-center gap-2">
      {labels.map((l, i) => {
        const idx = i + 1;
        const active = step === idx;
        const done = step > idx;
        return (
          <div key={l} className="flex flex-1 items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                done
                  ? "bg-[oklch(0.66_0.14_165)] text-background"
                  : active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {done ? "✓" : idx}
            </div>
            <span className={`text-sm ${active ? "font-semibold" : "text-muted-foreground"}`}>{l}</span>
            {idx < 3 && <div className="ml-2 h-px flex-1 bg-border" />}
          </div>
        );
      })}
    </div>
  );
}

function NewQuiz() {
  const navigate = useNavigate();
  const { user } = useRequireSpeaker();
  const userId = user?.id;
  const { eventId } = Route.useSearch();
  const [step, setStep] = useState(1);

  // step 1
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [pdfText, setPdfText] = useState("");
  const [numPages, setNumPages] = useState(1);

  // step 2
  const [title, setTitle] = useState("");
  const [timeLimit, setTimeLimit] = useState(10);
  const [count, setCount] = useState(5);
  const [aiContext, setAiContext] = useState("");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [displayMode, setDisplayMode] = useState<"simultaneous" | "after_slide">("simultaneous");
  const [generating, setGenerating] = useState(false);

  // step 3
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [saving, setSaving] = useState(false);

  const generateFn = useServerFn(generateQuestions);

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    try {
      const path = `${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      const { error } = await supabase.storage.from("presentations").upload(path, file, {
        contentType: "application/pdf",
      });
      if (error) throw error;
      const { data } = supabase.storage.from("presentations").getPublicUrl(path);
      setFileUrl(data.publicUrl);
      const { text, numPages } = await extractPdfText(file);
      setPdfText(text);
      setNumPages(numPages);
      toast.success(`PDF carregado (${numPages} slides)`);
    } catch (e: any) {
      toast.error(e.message || "Falha no upload");
    } finally {
      setUploading(false);
    }
  }

  async function handleGenerate() {
    if (!title.trim()) {
      toast.error("Informe o título do quiz");
      return;
    }
    setGenerating(true);
    try {
      const res = await generateFn({
        data: { pdfText, context: aiContext, count, numPages, difficulty, displayMode },
      });
      const drafts: DraftQuestion[] = res.questions.map((q) => {
        let options: Record<string, string>;
        if (q.question_type === "true_false") {
          options = { A: "Verdadeiro", B: "Falso" };
        } else {
          // Inclui apenas alternativas com texto válido (sem campos em branco)
          const raw = (q.options || {}) as Record<string, string>;
          const filled = ["A", "B", "C", "D"]
            .map((k) => (typeof raw[k] === "string" ? raw[k].trim() : ""))
            .filter((t) => t.length > 0)
            .slice(0, 3); // máximo 3 alternativas (A, B, C)
          options = {};
          filled.forEach((text, idx) => {
            options[String.fromCharCode(65 + idx)] = text;
          });
          if (Object.keys(options).length < 2) {
            options = { A: raw.A || "Alternativa A", B: raw.B || "Alternativa B" };
          }
        }
        const correct = options[q.correct_option] ? q.correct_option : "A";
        return {
        question_text: q.question_text,
        question_type: q.question_type,
        options,
        correct_option: correct,
        slide_number: Math.min(Math.max(1, q.slide_number || 1), numPages),
        display_mode: displayMode,
        time_limit: timeLimit,
        };
      });
      setQuestions(drafts);
      setStep(3);
    } catch (e: any) {
      toast.error(e.message || "Falha ao gerar perguntas");
    } finally {
      setGenerating(false);
    }
  }

  function updateQ(i: number, patch: Partial<DraftQuestion>) {
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }

  function toggleType(i: number, type: "multiple_choice" | "true_false") {
    const q = questions[i];
    if (type === "true_false") {
      updateQ(i, {
        question_type: "true_false",
        options: { A: "Verdadeiro", B: "Falso" },
        correct_option: q.correct_option === "A" || q.correct_option === "B" ? q.correct_option : "A",
      });
    } else {
      updateQ(i, {
        question_type: "multiple_choice",
        options: { A: q.options.A || "", B: q.options.B || "" },
      });
    }
  }

  async function handleSave() {
    if (!fileUrl) return;
    setSaving(true);
    try {
      // Calcula sort_order = (maior atual + 1) dentro do evento
      let nextSortOrder = 0;
      if (eventId) {
        const { data: existing } = await (supabase.from("presentations") as any)
          .select("sort_order")
          .eq("event_id", eventId)
          .order("sort_order", { ascending: false })
          .limit(1);
        if (existing && existing.length > 0) {
          nextSortOrder = (existing[0].sort_order ?? 0) + 1;
        }
      }
      const insertPayload: Record<string, unknown> = {
        user_id: userId,
        title,
        file_url: fileUrl,
        ai_context: aiContext || null,
      };
      if (eventId) {
        insertPayload.event_id = eventId;
        insertPayload.sort_order = nextSortOrder;
      }
      const { data: pres, error: pErr } = await (supabase.from("presentations") as any)
        .insert(insertPayload)
        .select("id")
        .single();
      if (pErr) throw pErr;
      const rows = questions.map((q, idx) => {
        let opts: Record<string, string>;
        let correct = q.correct_option;
        if (q.question_type === "true_false") {
          opts = { A: "Verdadeiro", B: "Falso" };
        } else {
          const keys = Object.keys(q.options).sort();
          const kept = keys.filter(
            (k) => typeof q.options[k] === "string" && q.options[k].trim() !== "",
          );
          opts = {};
          kept.forEach((oldK, j) => {
            const newK = String.fromCharCode(65 + j);
            opts[newK] = q.options[oldK].trim();
            if (oldK === q.correct_option) correct = newK;
          });
          if (!opts[correct]) correct = "A";
        }
        return {
        presentation_id: pres.id,
        question_text: q.question_text,
        question_type: q.question_type,
        options: opts,
        correct_option: correct,
        slide_number: q.slide_number,
        display_mode: q.display_mode,
        time_limit: q.time_limit,
        position: idx,
        };
      });
      const { error: qErr } = await supabase.from("questions").insert(rows);
      if (qErr) throw qErr;
      toast.success("Quiz salvo com sucesso!");
      if (eventId) {
        navigate({ to: "/event/$id", params: { id: eventId } });
      } else {
        navigate({ to: "/dashboard" });
      }
    } catch (e: any) {
      toast.error(e.message || "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-[#0E1015] text-white">
        <header className="border-b border-[#262D3D] bg-[#131722] px-4 py-3">
          <button
            type="button"
            onClick={() => navigate({ to: "/remote" })}
            className="inline-flex items-center gap-1 text-xs font-medium text-[#9CA3AF]"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Voltar
          </button>
          <h1 className="mt-1 text-lg font-bold">Novo Quiz</h1>
        </header>
        <main className="flex flex-1 items-center justify-center p-5">
          <div className="w-full max-w-sm rounded-2xl border border-[#262D3D] bg-[#161A23] p-6 text-center">
            <Sparkles className="mx-auto h-10 w-10 text-[#F68B1F]" />
            <h2 className="mt-3 text-base font-bold text-white">Recomendado no computador</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#9CA3AF]">
              Para enviar novos arquivos PDF e gerar quizzes com IA de forma confortável, utilize o seu computador.
            </p>
            <p className="mt-3 text-xs text-[#9CA3AF]">
              No celular, você pode <span className="font-semibold text-[#F68B1F]">iniciar e comandar</span> as apresentações ao vivo.
            </p>
            <button
              type="button"
              onClick={() => navigate({ to: "/remote" })}
              className="mt-5 flex min-h-[60px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-sm font-extrabold uppercase tracking-wide text-white shadow-lg transition-all duration-100 active:scale-95"
            >
              Ir para o Controle Remoto
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => navigate({ to: "/dashboard" })}
              className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-[#9CA3AF] transition-colors hover:text-[#F68B1F]"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Voltar ao Painel
            </button>
            <h1 className="text-2xl font-bold">Novo Quiz</h1>
            <p className="text-sm text-muted-foreground">Siga as 3 etapas para criar seu quiz</p>
          </div>
          <Button variant="ghost" onClick={() => navigate({ to: "/dashboard" })}>
            Cancelar
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <Stepper step={step} />

        {step === 1 && (
          <div className="space-y-6 rounded-xl border border-border bg-card p-6">
            <div>
              <h2 className="text-lg font-semibold">Etapa 1 — Carregar Apresentação</h2>
              <p className="text-sm text-muted-foreground">Envie o PDF dos slides.</p>
            </div>
            <div className="rounded-lg border-2 border-dashed border-border bg-background/50 p-8 text-center">
              <Upload className="mx-auto h-10 w-10 text-muted-foreground" />
              <input
                id="pdf-input"
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setFile(f);
                    setFileUrl(null);
                  }
                }}
              />
              <div className="mt-4">
                <label htmlFor="pdf-input">
                  <Button asChild variant="outline">
                    <span>{file ? "Trocar arquivo" : "Selecionar PDF"}</span>
                  </Button>
                </label>
              </div>
              {file && <p className="mt-3 text-sm text-muted-foreground">{file.name}</p>}
              {file && !fileUrl && (
                <Button className="mt-4" onClick={handleUpload} disabled={uploading}>
                  {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  Enviar para a nuvem
                </Button>
              )}
              {fileUrl && (
                <div className="mt-4 flex items-center justify-center gap-2 text-sm text-[oklch(0.66_0.14_165)]">
                  <FileCheck2 className="h-4 w-4" /> Upload concluído ({numPages} slides)
                </div>
              )}
            </div>
            <div className="flex justify-end">
              <Button disabled={!fileUrl} onClick={() => setStep(2)}>
                Próxima Etapa <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6 rounded-xl border border-border bg-card p-6">
            <div>
              <h2 className="text-lg font-semibold">Etapa 2 — IA & Configuração</h2>
              <p className="text-sm text-muted-foreground">Dê instruções para a IA gerar as perguntas.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="title">Título do Quiz</Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Inovação Aberta BNB" />
              </div>
              <div>
                <Label htmlFor="time">Tempo limite por pergunta</Label>
                <select
                  id="time"
                  value={timeLimit}
                  onChange={(e) => setTimeLimit(Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value={10}>10 segundos</option>
                  <option value={20}>20 segundos</option>
                  <option value={30}>30 segundos</option>
                </select>
              </div>
              <div>
                <Label htmlFor="count">Quantidade de perguntas</Label>
                <Input
                  id="count"
                  type="number"
                  min={1}
                  max={20}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="ctx">Contexto adicional para a IA (opcional)</Label>
              <Textarea
                id="ctx"
                value={aiContext}
                onChange={(e) => setAiContext(e.target.value)}
                placeholder="Ex: Foque nas diretrizes de inovação aberta do Banco do Nordeste"
                rows={4}
              />
            </div>

            <div>
              <Label className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" /> Nível de Dificuldade
              </Label>
              <div className="mt-2 grid gap-2 md:grid-cols-3">
                {([
                  { value: "easy", label: "Fácil", hint: "Perguntas diretas e conceituais" },
                  { value: "medium", label: "Médio", hint: "Exige atenção aos detalhes do conteúdo" },
                  { value: "hard", label: "Difícil", hint: "Perguntas analíticas e desafiadoras" },
                ] as const).map((opt) => {
                  const selected = difficulty === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDifficulty(opt.value)}
                      className={`rounded-lg border p-3 text-left transition-colors ${
                        selected
                          ? "border-primary bg-primary/10"
                          : "border-border bg-background/50 hover:border-primary/50"
                      }`}
                    >
                      <div className="text-sm font-semibold">{opt.label}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{opt.hint}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <Label className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" /> Momento de Envio das Perguntas
              </Label>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {([
                  {
                    value: "simultaneous",
                    label: "Simultâneo",
                    icon: Zap,
                    hint: "A pergunta é liberada no celular do usuário no mesmo instante em que você abre o slide correspondente.",
                  },
                  {
                    value: "after_slide",
                    label: "Pós-Slide",
                    icon: Clock,
                    hint: "O slide é exibido para sua explicação. A votação só abre quando você acionar o gatilho ou encerrar o slide.",
                  },
                ] as const).map((opt) => {
                  const selected = displayMode === opt.value;
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDisplayMode(opt.value)}
                      className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                        selected
                          ? "border-primary bg-primary/10"
                          : "border-border bg-background/50 hover:border-primary/50"
                      }`}
                    >
                      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                      <div>
                        <div className="text-sm font-semibold">{opt.label}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{opt.hint}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>
                <ChevronLeft className="mr-2 h-4 w-4" /> Voltar
              </Button>
              <Button onClick={handleGenerate} disabled={generating || !title.trim()}>
                {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Gerar perguntas com IA
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-lg font-semibold">Etapa 3 — Revisão e Vínculo de Slides</h2>
              <p className="text-sm text-muted-foreground">
                Edite cada pergunta, marque a alternativa correta, vincule ao slide e escolha o modo de exibição.
              </p>
            </div>

            {questions.map((q, i) => (
              <div key={i} className="space-y-3 rounded-xl border border-border bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <span className="rounded bg-primary/20 px-2 py-1 text-xs font-semibold text-primary">
                    Pergunta {i + 1}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setQuestions((qs) => qs.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <Textarea
                  value={q.question_text}
                  onChange={(e) => updateQ(i, { question_text: e.target.value })}
                  rows={2}
                />

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={q.question_type === "multiple_choice" ? "default" : "outline"}
                    onClick={() => toggleType(i, "multiple_choice")}
                  >
                    Múltipla Escolha
                  </Button>
                  <Button
                    size="sm"
                    variant={q.question_type === "true_false" ? "default" : "outline"}
                    onClick={() => toggleType(i, "true_false")}
                  >
                    Verdadeiro / Falso
                  </Button>
                </div>

                <div className="grid gap-2">
                  {(q.question_type === "true_false" ? ["A", "B"] : ["A", "B", "C", "D"]).map((k) => (
                    <label key={k} className="flex items-center gap-2 rounded-lg border border-border bg-background/50 p-2">
                      <input
                        type="radio"
                        name={`correct-${i}`}
                        checked={q.correct_option === k}
                        onChange={() => updateQ(i, { correct_option: k })}
                        className="h-4 w-4 accent-[oklch(0.66_0.14_165)]"
                      />
                      <span className="w-6 text-sm font-semibold text-muted-foreground">{k}.</span>
                      <Input
                        value={q.options[k] || ""}
                        onChange={(e) => updateQ(i, { options: { ...q.options, [k]: e.target.value } })}
                        disabled={q.question_type === "true_false"}
                      />
                    </label>
                  ))}
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <Label className="text-xs">Vincular ao Slide número</Label>
                    <Input
                      type="number"
                      min={1}
                      max={numPages}
                      value={q.slide_number}
                      onChange={(e) => updateQ(i, { slide_number: Math.min(Math.max(1, Number(e.target.value)), numPages) })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Tempo limite (s)</Label>
                    <Input
                      type="number"
                      min={5}
                      max={120}
                      value={q.time_limit}
                      onChange={(e) => updateQ(i, { time_limit: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Modo de exibição</Label>
                    <select
                      value={q.display_mode}
                      onChange={(e) =>
                        updateQ(i, { display_mode: e.target.value as "simultaneous" | "after_slide" })
                      }
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="simultaneous">Simultâneo (junto com o slide)</option>
                      <option value="after_slide">Pós-Slide (após a explicação)</option>
                    </select>
                  </div>
                </div>
              </div>
            ))}

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(2)}>
                <ChevronLeft className="mr-2 h-4 w-4" /> Voltar
              </Button>
              <Button onClick={handleSave} disabled={saving || questions.length === 0}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Salvar Quiz
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
