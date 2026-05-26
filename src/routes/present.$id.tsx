import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { sortRanking, type ParticipantRow } from "@/lib/ranking";
import { toast } from "sonner";

export const Route = createFileRoute("/present/$id")({
  head: () => ({ meta: [{ title: "Apresentação ao vivo — QuizPulse" }] }),
  component: Present,
});

type Question = {
  id: string;
  question_text: string;
  question_type: string;
  options: Record<string, string>;
  correct_option: string;
  slide_number: number;
  display_mode: string;
  time_limit: number;
};

function Present() {
  const { id } = Route.useParams();
  const [session, setSession] = useState<any>(null);
  const [presentation, setPresentation] = useState<{ file_url: string; title: string } | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [answers, setAnswers] = useState<Array<{ question_id: string; selected_option: string; participant_id: string }>>([]);
  const [now, setNow] = useState(Date.now());

  // tick
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // load + realtime
  useEffect(() => {
    async function load() {
      const { data: s } = await supabase.from("sessions").select("*").eq("id", id).single();
      setSession(s);
      if (s) {
        const { data: p } = await supabase
          .from("presentations")
          .select("file_url, title")
          .eq("id", s.presentation_id)
          .single();
        setPresentation(p);
        const { data: qs } = await supabase
          .from("questions")
          .select("*")
          .eq("presentation_id", s.presentation_id)
          .order("position");
        setQuestions((qs as any) || []);
      }
      const { data: parts } = await supabase.from("participants").select("*").eq("session_id", id);
      setParticipants((parts as any) || []);
      const { data: ans } = await supabase
        .from("answers")
        .select("question_id, selected_option, participant_id")
        .eq("session_id", id);
      setAnswers((ans as any) || []);
    }
    load();
    const ch = supabase
      .channel(`present-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions", filter: `id=eq.${id}` }, (payload) => {
        setSession(payload.new);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "participants", filter: `session_id=eq.${id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "answers", filter: `session_id=eq.${id}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [id]);

  const currentSlide: number = session?.current_slide || 1;
  const slideQuestion = useMemo(
    () => questions.find((q) => q.slide_number === currentSlide) || null,
    [questions, currentSlide],
  );
  const activeQuestion = useMemo(
    () => questions.find((q) => q.id === session?.active_question_id) || null,
    [questions, session?.active_question_id],
  );

  const remaining = useMemo(() => {
    if (!activeQuestion || !session?.question_started_at || session.question_revealed) return 0;
    const elapsed = (now - new Date(session.question_started_at).getTime()) / 1000;
    return Math.max(0, Math.ceil(activeQuestion.time_limit - elapsed));
  }, [activeQuestion, session, now]);

  // auto reveal when time hits 0
  useEffect(() => {
    if (activeQuestion && session?.question_started_at && !session.question_revealed) {
      const elapsed = (now - new Date(session.question_started_at).getTime()) / 1000;
      if (elapsed >= activeQuestion.time_limit) {
        revealResults();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, activeQuestion?.id, session?.question_revealed]);

  async function setSlide(n: number) {
    const total = questions.reduce((max, q) => Math.max(max, q.slide_number), 1);
    const next = Math.max(1, n);
    const q = questions.find((qq) => qq.slide_number === next) || null;
    const patch: any = {
      current_slide: next,
      question_revealed: false,
      active_question_id: null,
      question_started_at: null,
    };
    if (q && q.display_mode === "simultaneous") {
      patch.active_question_id = q.id;
      patch.question_started_at = new Date().toISOString();
    }
    await supabase.from("sessions").update(patch).eq("id", id);
  }

  async function triggerQuestion() {
    if (!slideQuestion) return;
    await supabase
      .from("sessions")
      .update({
        active_question_id: slideQuestion.id,
        question_started_at: new Date().toISOString(),
        question_revealed: false,
      })
      .eq("id", id);
  }

  async function revealResults() {
    if (!activeQuestion) return;
    // grade pending answers (already saved as is_correct on insert)
    await supabase.from("sessions").update({ question_revealed: true }).eq("id", id);
  }

  // keyboard nav
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") setSlide(currentSlide + 1);
      else if (e.key === "ArrowLeft") setSlide(currentSlide - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSlide, questions]);

  const questionAnswers = answers.filter((a) => a.question_id === activeQuestion?.id);
  const ranking = sortRanking(participants);

  if (!presentation) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando apresentação...
      </div>
    );
  }

  const optionKeys = activeQuestion
    ? activeQuestion.question_type === "true_false"
      ? ["A", "B"]
      : ["A", "B", "C", "D"]
    : [];

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex flex-1 overflow-hidden">
        {/* Coluna esquerda — PDF */}
        <div
          className="relative flex-[2] cursor-pointer bg-black"
          onClick={() => setSlide(currentSlide + 1)}
          title="Clique para avançar / use as setas do teclado"
        >
          <iframe
            key={currentSlide}
            title={presentation.title}
            src={`${presentation.file_url}#page=${currentSlide}&toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
            className="pointer-events-none h-full w-full"
          />
          <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-black/60 px-2 py-1 text-xs text-white/80">
            Slide {currentSlide}
          </div>
        </div>

        {/* Coluna direita — painel admin */}
        <aside className="flex w-[400px] flex-col gap-3 overflow-y-auto border-l border-border bg-card p-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{presentation.title}</p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <Button size="sm" variant="outline" onClick={() => setSlide(currentSlide - 1)}>
                ◀ Anterior
              </Button>
              <span className="text-sm font-semibold">Slide {currentSlide}</span>
              <Button size="sm" variant="outline" onClick={() => setSlide(currentSlide + 1)}>
                Próximo ▶
              </Button>
            </div>
          </div>

          {!slideQuestion && (
            <div className="rounded-lg border border-dashed border-border bg-background/40 p-4 text-center text-sm text-muted-foreground">
              Conteúdo livre para explicação
            </div>
          )}

          {slideQuestion && !activeQuestion && (
            <div className="space-y-2 rounded-lg border border-border bg-background/40 p-3">
              <p className="text-xs text-muted-foreground">
                Pergunta vinculada ({slideQuestion.display_mode === "after_slide" ? "Pós-Slide" : "Simultâneo"})
              </p>
              <p className="text-sm font-medium">{slideQuestion.question_text}</p>
              {slideQuestion.display_mode === "after_slide" && (
                <Button size="sm" className="w-full" onClick={triggerQuestion}>
                  Liberar pergunta agora
                </Button>
              )}
            </div>
          )}

          {activeQuestion && (
            <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-primary">Pergunta ativa</span>
                {!session?.question_revealed ? (
                  <span className="rounded bg-primary px-2 py-1 text-xs font-bold text-primary-foreground">
                    {remaining}s
                  </span>
                ) : (
                  <span className="rounded bg-[oklch(0.66_0.14_165)] px-2 py-1 text-xs font-bold text-background">
                    Revelado
                  </span>
                )}
              </div>
              <p className="text-sm">{activeQuestion.question_text}</p>
              <p className="text-xs text-muted-foreground">
                {questionAnswers.length}/{participants.length} responderam
              </p>

              {session?.question_revealed && (
                <div className="space-y-1">
                  {optionKeys.map((k) => {
                    const count = questionAnswers.filter((a) => a.selected_option === k).length;
                    const pct = participants.length ? (count / participants.length) * 100 : 0;
                    const isCorrect = k === activeQuestion.correct_option;
                    return (
                      <div key={k} className="text-xs">
                        <div className="flex justify-between">
                          <span className={isCorrect ? "font-semibold text-[oklch(0.66_0.14_165)]" : ""}>
                            {k}. {activeQuestion.options[k]}
                          </span>
                          <span>{count}</span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded bg-muted">
                          <div
                            className={isCorrect ? "h-full bg-[oklch(0.66_0.14_165)]" : "h-full bg-primary"}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {!session?.question_revealed && (
                <Button size="sm" variant="outline" className="w-full" onClick={revealResults}>
                  Revelar agora
                </Button>
              )}
            </div>
          )}

          <div className="mt-2">
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Ranking ao vivo</h3>
            <ol className="space-y-1">
              {ranking.slice(0, 10).map((p, idx) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded border border-border bg-background/40 px-2 py-1 text-sm"
                >
                  <span>
                    <span className="mr-2 inline-block w-5 text-right text-muted-foreground">{idx + 1}.</span>
                    {p.name}
                  </span>
                  <span className="text-xs font-semibold text-primary">{p.correct_count} ✓</span>
                </li>
              ))}
              {ranking.length === 0 && (
                <li className="text-xs text-muted-foreground">Nenhum participante ainda</li>
              )}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
