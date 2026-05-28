import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRequireSpeaker } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { AlertTriangle, ChevronLeft, Download, Loader2, Trash2, X, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export const Route = createFileRoute("/quiz/$id/edit")({
  head: () => ({ meta: [{ title: "Editar Quiz — QuizBini" }] }),
  validateSearch: (s: Record<string, unknown>): { redirect_to_event?: string } => ({
    redirect_to_event: (s.redirect_to_event as string) || undefined,
  }),
  component: EditQuizPage,
});

type EditableQuestion = {
  id: string;
  question_text: string;
  question_type: "multiple_choice" | "true_false";
  options: Record<string, string>;
  correct_option: string;
  slide_number: number;
  display_mode: "simultaneous" | "after_slide";
  time_limit: number;
  position: number;
  is_prize_question: boolean;
  prize_multiplier: number;
  difficulty: "easy" | "medium" | "hard" | "extreme";
};

function EditQuizPage() {
  useRequireSpeaker();
  const { id } = Route.useParams();
  const { redirect_to_event } = Route.useSearch();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [defaultTimeLimit, setDefaultTimeLimit] = useState<number>(30);
  const [allowDownload, setAllowDownload] = useState<boolean>(false);
  const [speakerEmail, setSpeakerEmail] = useState<string>("");
  const [questions, setQuestions] = useState<EditableQuestion[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: pres } = await supabase
        .from("presentations")
        .select("title, default_time_limit, allow_download, speaker_email")
        .eq("id", id)
        .maybeSingle();
      if (pres) {
        setTitle(pres.title);
        setDefaultTimeLimit((pres as any).default_time_limit ?? 30);
        setAllowDownload(!!(pres as any).allow_download);
        setSpeakerEmail(((pres as any).speaker_email as string) ?? "");
      }
      const { data: qs } = await supabase
        .from("questions")
        .select("*")
        .eq("presentation_id", id)
        .order("position");
      const normalized: EditableQuestion[] = ((qs as any[]) || []).map((q) => {
        let options: Record<string, string>;
        if (q.question_type === "true_false") {
          options = { A: "Verdadeiro", B: "Falso" };
        } else {
          // Manter apenas alternativas existentes (com chave presente no banco),
          // re-sequenciando as letras A, B, C... sem lacunas.
          const incoming = (q.options || {}) as Record<string, string>;
          const orderedKeys = ["A", "B", "C", "D", "E", "F"].filter((k) =>
            Object.prototype.hasOwnProperty.call(incoming, k),
          );
          const filled = orderedKeys.length >= 2 ? orderedKeys : ["A", "B"];
          options = {};
          filled.forEach((k, idx) => {
            const newKey = String.fromCharCode(65 + idx);
            options[newKey] = incoming[k] ?? "";
          });
        }
        // Reposicionar gabarito caso a letra antiga não exista mais
        let correct = q.correct_option as string;
        if (q.question_type !== "true_false" && !options[correct]) {
          correct = "";
        }
        return {
        id: q.id,
        question_text: q.question_text,
        question_type: q.question_type,
        options,
        correct_option: correct,
        slide_number: q.slide_number,
        display_mode: q.display_mode,
        time_limit: q.time_limit,
        position: q.position,
        is_prize_question: !!q.is_prize_question,
        prize_multiplier: q.prize_multiplier ?? 5,
        difficulty: (q.difficulty as any) ?? "medium",
        };
      });
      setQuestions(normalized);
      setLoading(false);
    })();
  }, [id]);

  function updateQ(i: number, patch: Partial<EditableQuestion>) {
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }

  function removeOption(i: number, key: string) {
    setQuestions((qs) =>
      qs.map((q, idx) => {
        if (idx !== i) return q;
        if (q.question_type !== "multiple_choice") return q;
        const keys = Object.keys(q.options).sort();
        if (keys.length <= 2) return q;
        const remaining = keys.filter((k) => k !== key);
        const newOptions: Record<string, string> = {};
        remaining.forEach((oldK, idx2) => {
          const newK = String.fromCharCode(65 + idx2);
          newOptions[newK] = q.options[oldK];
        });
        // Recalcular gabarito
        let newCorrect = q.correct_option;
        if (q.correct_option === key) {
          newCorrect = "";
        } else if (q.correct_option && q.correct_option > key) {
          // letra deslocada uma posição para trás
          newCorrect = String.fromCharCode(q.correct_option.charCodeAt(0) - 1);
        }
        return { ...q, options: newOptions, correct_option: newCorrect };
      }),
    );
  }

  function addOption(i: number) {
    setQuestions((qs) =>
      qs.map((q, idx) => {
        if (idx !== i) return q;
        if (q.question_type !== "multiple_choice") return q;
        const keys = Object.keys(q.options).sort();
        if (keys.length >= 6) return q;
        const newKey = String.fromCharCode(65 + keys.length);
        return { ...q, options: { ...q.options, [newKey]: "" } };
      }),
    );
  }

  function backToOrigin() {
    if (redirect_to_event) {
      navigate({ to: "/event/$id", params: { id: redirect_to_event } });
    } else {
      navigate({ to: "/dashboard" });
    }
  }

  async function handleSave() {
    // Validação: cada MC precisa de ao menos 2 alternativas preenchidas
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (q.question_type !== "multiple_choice") continue;
      const filledCount = Object.values(q.options).filter(
        (v) => typeof v === "string" && v.trim() !== "",
      ).length;
      if (filledCount < 2) {
        toast.error(
          `Pergunta ${i + 1}: uma pergunta de múltipla escolha precisa de pelo menos 2 alternativas preenchidas.`,
        );
        return;
      }
    }
    // Validação: gabarito precisa existir e ter texto
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (q.question_type !== "multiple_choice") continue;
      if (!q.correct_option || !q.options[q.correct_option]) {
        toast.error(
          `Pergunta ${i + 1}: selecione a nova resposta correta antes de salvar.`,
        );
        return;
      }
      const correctText = (q.options[q.correct_option] ?? "").trim();
      if (!correctText) {
        toast.error(
          `Pergunta ${i + 1}: a alternativa marcada como correta está em branco.`,
        );
        return;
      }
    }

    setSaving(true);
    try {
      // Atualiza nome da apresentação e tempo geral
      const { error: presErr } = await supabase
        .from("presentations")
        .update({
          title: title.trim() || "Sem título",
          default_time_limit: defaultTimeLimit,
          allow_download: allowDownload,
          speaker_email: speakerEmail.trim().toLowerCase() || null,
        } as any)
        .eq("id", id);
      if (presErr) throw presErr;
      for (const q of questions) {
        // Limpeza: remove opções em branco
        // Limpeza: envia somente alternativas com texto e reordena letras
        let filteredOptions: Record<string, string>;
        let savedCorrect = q.correct_option;
        if (q.question_type === "true_false") {
          filteredOptions = { A: "Verdadeiro", B: "Falso" };
        } else {
          const keys = Object.keys(q.options).sort();
          const kept = keys.filter(
            (k) => typeof q.options[k] === "string" && q.options[k].trim() !== "",
          );
          filteredOptions = {};
          kept.forEach((oldK, idx) => {
            const newK = String.fromCharCode(65 + idx);
            filteredOptions[newK] = q.options[oldK].trim();
            if (oldK === q.correct_option) savedCorrect = newK;
          });
        }
        const { error } = await supabase
          .from("questions")
          .update({
            question_text: q.question_text,
            question_type: q.question_type,
            options: filteredOptions,
            correct_option: savedCorrect,
            slide_number: q.slide_number,
            display_mode: q.display_mode,
            time_limit: q.time_limit,
            is_prize_question: q.is_prize_question,
            prize_multiplier: q.prize_multiplier,
            difficulty: q.is_prize_question ? "extreme" : q.difficulty,
          })
          .eq("id", q.id);
        if (error) throw error;
      }
      toast.success("Alterações salvas!");
      backToOrigin();
    } catch (e: any) {
      toast.error(e?.message || "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(i: number) {
    const q = questions[i];
    if (!confirm(`Excluir a pergunta ${i + 1}? Esta ação não pode ser desfeita.`)) return;
    const { error } = await supabase.from("questions").delete().eq("id", q.id);
    if (error) {
      toast.error("Falha ao excluir");
      return;
    }
    setQuestions((qs) => qs.filter((_, idx) => idx !== i));
    toast.success("Pergunta excluída");
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0E1015] text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando quiz...
      </div>
    );
  }

  // ============= Versão simplificada para celular =============
  if (isMobile) {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-[#0E1015] text-foreground">
        <header className="sticky top-0 z-10 border-b border-[#262D3D] bg-[#131722] px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={backToOrigin} className="px-2">
              <ChevronLeft className="mr-1 h-4 w-4" /> Voltar
            </Button>
            <h1 className="truncate text-sm font-bold text-white">Edição rápida</h1>
            <Button
              onClick={handleSave}
              disabled={saving}
              size="sm"
              className="bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-white"
            >
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Salvar
            </Button>
          </div>
        </header>

        <main className="flex-1 space-y-4 p-4">
          <div className="rounded-xl border border-[#262D3D] bg-[#161A23] p-4">
            <Label className="text-xs">Título da Palestra</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 min-h-[48px] bg-[#0E1015]"
            />
          </div>

          <div className="rounded-xl border border-[#262D3D] bg-[#161A23] p-4">
            <Label className="text-xs">Tempo Geral de Resposta</Label>
            <select
              value={defaultTimeLimit}
              onChange={(e) => setDefaultTimeLimit(Number(e.target.value))}
              className="mt-1 min-h-[48px] w-full rounded-md border border-[#262D3D] bg-[#0E1015] px-3 text-sm text-white"
            >
              <option value={15}>15 segundos</option>
              <option value={30}>30 segundos</option>
              <option value={45}>45 segundos</option>
              <option value={60}>60 segundos</option>
              <option value={90}>90 segundos</option>
            </select>
          </div>

          <div className="flex items-start justify-between gap-3 rounded-xl border border-[#262D3D] bg-[#161A23] p-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white">
                Permitir download do material
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Libera o PDF original aos usuários no Currículo após a palestra.
              </p>
            </div>
            <Switch checked={allowDownload} onCheckedChange={setAllowDownload} />
          </div>

          <div className="rounded-xl border border-[#262D3D] bg-[#161A23] p-4">
            <div className="mb-3 flex items-center gap-2">
              <Zap className="h-4 w-4 text-[#FFCB05]" />
              <h2 className="text-sm font-bold text-white">Pergunta Prêmio</h2>
            </div>
            <p className="mb-3 text-[11px] text-muted-foreground">
              Escolha quais perguntas valem multiplicador.
            </p>
            {questions.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma pergunta cadastrada.</p>
            ) : (
              <div className="space-y-2">
                {questions.map((q, i) => (
                  <div
                    key={q.id}
                    className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${
                      q.is_prize_question
                        ? "border-[#FFCB05] bg-[#FFCB05]/5"
                        : "border-[#262D3D] bg-[#0E1015]"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                        Pergunta {i + 1} · Slide {q.slide_number}
                      </p>
                      <p className="line-clamp-2 text-xs text-white">{q.question_text}</p>
                    </div>
                    <Switch
                      checked={q.is_prize_question}
                      onCheckedChange={(v) =>
                        updateQ(i, {
                          is_prize_question: v,
                          difficulty: v
                            ? "extreme"
                            : q.difficulty === "extreme"
                            ? "hard"
                            : q.difficulty,
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[#262D3D] bg-[#131722] p-4 text-center text-[11px] text-[#9CA3AF]">
            💡 Para reordenar perguntas, editar alternativas e ajustar a estrutura completa do quiz, abra no computador.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0E1015] text-foreground">
      <header className="border-b border-[#262D3D] bg-[#131722]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={backToOrigin}>
              <ChevronLeft className="mr-1 h-4 w-4" />
              {redirect_to_event ? "Voltar ao evento" : "Voltar ao painel"}
            </Button>
            <div>
              <h1 className="text-xl font-bold">Editar Quiz</h1>
              <p className="text-sm text-muted-foreground">{title}</p>
            </div>
          </div>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-gradient-to-r from-[#A6193C] to-[#F26B1F] text-white hover:opacity-90"
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Salvar alterações
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-6 py-8">
        {/* Cabeçalho: nome + tempo geral */}
        <div className="grid gap-4 rounded-xl border border-[#262D3D] bg-[#161A23] p-5 md:grid-cols-[1fr_220px]">
          <div>
            <Label className="text-xs">Nome da Apresentação</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Estratégia Comercial 2026"
              className="bg-[#0E1015]"
            />
          </div>
          <div>
            <Label className="text-xs">Tempo Geral de Resposta (Padrão)</Label>
            <select
              value={defaultTimeLimit}
              onChange={(e) => setDefaultTimeLimit(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-[#262D3D] bg-[#0E1015] px-3 py-2 text-sm"
            >
              <option value={15}>15 segundos</option>
              <option value={30}>30 segundos</option>
              <option value={45}>45 segundos</option>
              <option value={60}>60 segundos</option>
              <option value={90}>90 segundos</option>
            </select>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Usado quando a pergunta não define um tempo próprio.
            </p>
          </div>
        </div>

        {/* Permissão de download do material */}
        <div className="flex items-start justify-between gap-4 rounded-xl border border-[#262D3D] bg-[#161A23] p-5">
          <div className="flex items-start gap-3">
            <Download className="mt-0.5 h-5 w-5 text-[#F68B1F]" />
            <div>
              <p className="text-sm font-semibold text-white">
                Permitir download do material após a apresentação
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Quando ativo, os usuários poderão baixar o arquivo PDF original na
                tela de Currículo deles, após concluírem a palestra.
              </p>
            </div>
          </div>
          <Switch checked={allowDownload} onCheckedChange={setAllowDownload} />
        </div>

        {questions.length === 0 && (
          <div className="rounded-xl border border-[#262D3D] bg-[#161A23] p-6 text-center text-sm text-muted-foreground">
            Este quiz ainda não tem perguntas.
          </div>
        )}
        {questions.map((q, i) => (
          <div
            key={q.id}
            className={`space-y-4 rounded-xl border p-5 transition-all ${
              q.is_prize_question
                ? "border-[#FFCB05] bg-[#1F1E24] shadow-[0_0_24px_-6px_#FFCB05]"
                : "border-[#262D3D] bg-[#161A23]"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded bg-primary/20 px-2 py-1 text-xs font-semibold text-primary">
                  Pergunta {i + 1}
                </span>
                {q.is_prize_question && (
                  <span className="flex items-center gap-1 rounded-full border border-[#FFCB05] bg-[#FFCB05]/10 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-[#FFCB05] animate-pulse">
                    <Zap className="h-3 w-3" /> PERGUNTA PRÊMIO
                  </span>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDelete(i)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {/* Switch Pergunta Prêmio */}
            <div className="flex items-center justify-between rounded-lg border border-[#262D3D] bg-[#0E1015]/60 p-3">
              <div>
                <p className="text-sm font-semibold text-white">
                  Definir como Pergunta Prêmio 🏆
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Dificuldade trava em <span className="text-[#FFCB05]">Extremo</span> e pontuação é multiplicada.
                </p>
              </div>
              <Switch
                checked={q.is_prize_question}
                onCheckedChange={(v) =>
                  updateQ(i, {
                    is_prize_question: v,
                    difficulty: v ? "extreme" : q.difficulty === "extreme" ? "hard" : q.difficulty,
                  })
                }
              />
            </div>

            <div>
              <Label className="text-xs">Enunciado</Label>
              <Textarea
                value={q.question_text}
                onChange={(e) => updateQ(i, { question_text: e.target.value })}
                rows={2}
                className="bg-[#0E1015]"
              />
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                variant={q.question_type === "multiple_choice" ? "default" : "outline"}
                onClick={() =>
                  updateQ(i, {
                    question_type: "multiple_choice",
                    options:
                      q.question_type === "multiple_choice"
                        ? q.options
                        : { A: "", B: "" },
                    correct_option:
                      q.question_type === "multiple_choice" ? q.correct_option : "",
                  })
                }
              >
                Múltipla Escolha
              </Button>
              <Button
                size="sm"
                variant={q.question_type === "true_false" ? "default" : "outline"}
                onClick={() =>
                  updateQ(i, {
                    question_type: "true_false",
                    options: { A: "Verdadeiro", B: "Falso" },
                    correct_option:
                      q.correct_option === "A" || q.correct_option === "B" ? q.correct_option : "A",
                  })
                }
              >
                Verdadeiro / Falso
              </Button>
            </div>

            <div className="grid gap-2">
              {(q.question_type === "true_false"
                ? ["A", "B"]
                : Object.keys(q.options).sort()
              ).map((k) => {
                const mcKeys = Object.keys(q.options);
                const canRemove =
                  q.question_type === "multiple_choice" && mcKeys.length > 2;
                return (
                <label
                  key={k}
                  className="flex items-center gap-2 rounded-lg border border-[#262D3D] bg-[#0E1015] p-2"
                >
                  <input
                    type="radio"
                    name={`correct-${i}`}
                    checked={q.correct_option === k}
                    onChange={() => updateQ(i, { correct_option: k })}
                    className="h-4 w-4 accent-[#FFCB05]"
                  />
                  <span className="w-6 text-sm font-semibold text-muted-foreground">{k}.</span>
                  <Input
                    value={q.options[k] || ""}
                    onChange={(e) =>
                      updateQ(i, { options: { ...q.options, [k]: e.target.value } })
                    }
                    disabled={q.question_type === "true_false"}
                    placeholder={
                      q.question_type === "multiple_choice"
                        ? `Texto da alternativa ${k}`
                        : undefined
                    }
                    className="bg-[#161A23]"
                  />
                  {canRemove && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        removeOption(i, k);
                      }}
                      title="Excluir alternativa"
                      aria-label={`Excluir alternativa ${k}`}
                      className="rounded p-1 text-gray-400 transition-colors hover:text-[#A6193C] hover:bg-[#1E2235]"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </label>
                );
              })}
              {q.question_type === "multiple_choice" && (
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Alternativas em branco serão ocultadas no celular dos participantes.
                  </p>
                  {Object.keys(q.options).length < 6 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => addOption(i)}
                      className="border-[#262D3D] text-xs"
                    >
                      + Adicionar alternativa
                    </Button>
                  )}
                </div>
              )}
              {q.question_type === "multiple_choice" &&
                (!q.correct_option || !q.options[q.correct_option]) && (
                  <div className="flex items-center gap-2 rounded-md border border-[#A6193C]/40 bg-[#A6193C]/10 px-3 py-2 text-xs text-[#F68B1F]">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    Selecione a nova resposta correta para esta questão antes de salvar.
                  </div>
                )}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <Label className="text-xs">Vincular ao slide</Label>
                <Input
                  type="number"
                  min={1}
                  value={q.slide_number}
                  onChange={(e) =>
                    updateQ(i, { slide_number: Math.max(1, Number(e.target.value)) })
                  }
                  className="bg-[#0E1015]"
                />
              </div>
              <div>
                <Label className="text-xs">Tempo de Resposta para esta pergunta (s)</Label>
                <Input
                  type="number"
                  min={0}
                  max={120}
                  value={q.time_limit}
                  onChange={(e) => updateQ(i, { time_limit: Number(e.target.value) })}
                  className="bg-[#0E1015]"
                  placeholder={`Padrão: ${defaultTimeLimit}s`}
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  0 = usa o tempo geral ({defaultTimeLimit}s).
                </p>
              </div>
              <div>
                <Label className="text-xs">Dinâmica de exibição</Label>
                <select
                  value={q.display_mode}
                  onChange={(e) =>
                    updateQ(i, {
                      display_mode: e.target.value as "simultaneous" | "after_slide",
                    })
                  }
                  className="mt-1 w-full rounded-md border border-[#262D3D] bg-[#0E1015] px-3 py-2 text-sm"
                >
                  <option value="simultaneous">Simultâneo (junto com o slide)</option>
                  <option value="after_slide">Pós-Slide (após a explicação)</option>
                </select>
              </div>
            </div>

            {/* Dificuldade + multiplicador */}
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label className="text-xs">Dificuldade</Label>
                <select
                  value={q.is_prize_question ? "extreme" : q.difficulty}
                  disabled={q.is_prize_question}
                  onChange={(e) => updateQ(i, { difficulty: e.target.value as any })}
                  className="mt-1 w-full rounded-md border border-[#262D3D] bg-[#0E1015] px-3 py-2 text-sm disabled:opacity-70"
                >
                  <option value="easy">Fácil</option>
                  <option value="medium">Média</option>
                  <option value="hard">Difícil</option>
                  <option value="extreme">Extremo (Prêmio)</option>
                </select>
              </div>
              {q.is_prize_question && (
                <div>
                  <Label className="text-xs text-[#FFCB05]">Multiplicador de Pontuação</Label>
                  <select
                    value={q.prize_multiplier}
                    onChange={(e) => updateQ(i, { prize_multiplier: Number(e.target.value) })}
                    className="mt-1 w-full rounded-md border border-[#FFCB05]/60 bg-[#0E1015] px-3 py-2 text-sm font-semibold text-[#FFCB05]"
                  >
                    <option value={3}>3x (até 3.000 pts)</option>
                    <option value={4}>4x (até 4.000 pts)</option>
                    <option value={5}>5x (até 5.000 pts)</option>
                  </select>
                </div>
              )}
            </div>
          </div>
        ))}

        {questions.length > 0 && (
          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-gradient-to-r from-[#A6193C] to-[#F26B1F] text-white hover:opacity-90"
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Salvar alterações
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
