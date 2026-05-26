import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/quiz/$id/edit")({
  head: () => ({ meta: [{ title: "Editar Quiz — QuizPulse" }] }),
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
};

function EditQuizPage() {
  const { id } = Route.useParams();
  const { redirect_to_event } = Route.useSearch();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [questions, setQuestions] = useState<EditableQuestion[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: pres } = await supabase
        .from("presentations")
        .select("title")
        .eq("id", id)
        .maybeSingle();
      if (pres) setTitle(pres.title);
      const { data: qs } = await supabase
        .from("questions")
        .select("*")
        .eq("presentation_id", id)
        .order("position");
      const normalized: EditableQuestion[] = ((qs as any[]) || []).map((q) => ({
        id: q.id,
        question_text: q.question_text,
        question_type: q.question_type,
        options:
          q.question_type === "true_false"
            ? { A: "Verdadeiro", B: "Falso" }
            : {
                A: q.options?.A ?? "",
                B: q.options?.B ?? "",
                C: q.options?.C ?? "",
                D: q.options?.D ?? "",
              },
        correct_option: q.correct_option,
        slide_number: q.slide_number,
        display_mode: q.display_mode,
        time_limit: q.time_limit,
        position: q.position,
      }));
      setQuestions(normalized);
      setLoading(false);
    })();
  }, [id]);

  function updateQ(i: number, patch: Partial<EditableQuestion>) {
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }

  function backToOrigin() {
    if (redirect_to_event) {
      navigate({ to: "/event/$id", params: { id: redirect_to_event } });
    } else {
      navigate({ to: "/dashboard" });
    }
  }

  async function handleSave() {
    // Validação: alternativa correta não pode estar vazia (em múltipla escolha)
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (q.question_type !== "multiple_choice") continue;
      const correctText = (q.options?.[q.correct_option] ?? "").trim();
      if (!correctText) {
        toast.error(
          `Pergunta ${i + 1}: você não pode apagar o texto da alternativa que foi marcada como correta!`,
        );
        return;
      }
    }

    setSaving(true);
    try {
      for (const q of questions) {
        // Limpeza: remove opções em branco
        const filteredOptions =
          q.question_type === "true_false"
            ? { A: "Verdadeiro", B: "Falso" }
            : Object.fromEntries(
                Object.entries(q.options).filter(
                  ([, v]) => typeof v === "string" && v.trim() !== "",
                ),
              );
        const { error } = await supabase
          .from("questions")
          .update({
            question_text: q.question_text,
            question_type: q.question_type,
            options: filteredOptions,
            correct_option: q.correct_option,
            slide_number: q.slide_number,
            display_mode: q.display_mode,
            time_limit: q.time_limit,
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
        {questions.length === 0 && (
          <div className="rounded-xl border border-[#262D3D] bg-[#161A23] p-6 text-center text-sm text-muted-foreground">
            Este quiz ainda não tem perguntas.
          </div>
        )}
        {questions.map((q, i) => (
          <div
            key={q.id}
            className="space-y-4 rounded-xl border border-[#262D3D] bg-[#161A23] p-5"
          >
            <div className="flex items-center justify-between">
              <span className="rounded bg-primary/20 px-2 py-1 text-xs font-semibold text-primary">
                Pergunta {i + 1}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDelete(i)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
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
                    options: {
                      A: q.options.A || "",
                      B: q.options.B || "",
                      C: q.options.C || "",
                      D: q.options.D || "",
                    },
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
              {(q.question_type === "true_false" ? ["A", "B"] : ["A", "B", "C", "D"]).map((k) => (
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
                        ? "Deixe em branco para ocultar esta alternativa"
                        : undefined
                    }
                    className="bg-[#161A23]"
                  />
                </label>
              ))}
              {q.question_type === "multiple_choice" && (
                <p className="text-xs text-muted-foreground">
                  Alternativas em branco serão ocultadas no celular dos participantes e nos
                  gráficos.
                </p>
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
                <Label className="text-xs">Tempo limite (s)</Label>
                <Input
                  type="number"
                  min={5}
                  max={120}
                  value={q.time_limit}
                  onChange={(e) => updateQ(i, { time_limit: Number(e.target.value) })}
                  className="bg-[#0E1015]"
                />
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
