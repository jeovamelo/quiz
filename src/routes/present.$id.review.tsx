import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, BarChart3, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/present/$id/review")({
  head: () => ({ meta: [{ title: "Análise por Slide — QuizPulse" }] }),
  component: ReviewPresentation,
});

type Question = {
  id: string;
  question_text: string;
  question_type: string;
  options: Record<string, string>;
  correct_option: string;
  slide_number: number;
  time_limit: number;
};

type Answer = {
  question_id: string;
  participant_id: string;
  selected_option: string;
  is_correct: boolean;
  response_ms: number;
};

type Participant = { id: string; name: string };

const BASE = 500;
const BONUS = 500;

function pointsFor(a: Answer, q: Question) {
  if (!a.is_correct) return 0;
  const totalMs = (q.time_limit || 10) * 1000;
  const remaining = Math.max(0, totalMs - a.response_ms);
  return BASE + Math.round((remaining / totalMs) * BONUS);
}

function ReviewPresentation() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [presentation, setPresentation] = useState<{ file_url: string; title: string; event_id: string | null } | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [currentSlide, setCurrentSlide] = useState(1);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [mode, setMode] = useState<"slide" | "cumulative">("slide");

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase
        .from("sessions")
        .select("presentation_id")
        .eq("id", id)
        .single();
      if (!s) return;
      const { data: p } = await supabase
        .from("presentations")
        .select("file_url, title, event_id")
        .eq("id", s.presentation_id)
        .single();
      if (p) setPresentation(p as any);
      const { data: qs } = await supabase
        .from("questions")
        .select("*")
        .eq("presentation_id", s.presentation_id)
        .order("position");
      setQuestions((qs as any) || []);
      const { data: ans } = await supabase
        .from("answers")
        .select("question_id, participant_id, selected_option, is_correct, response_ms")
        .eq("session_id", id);
      setAnswers((ans as any) || []);
      const { data: parts } = await supabase
        .from("participants")
        .select("id, name")
        .eq("session_id", id);
      setParticipants((parts as any) || []);
    })();
  }, [id]);

  // Total de páginas via pdfjs
  useEffect(() => {
    if (!presentation?.file_url) return;
    let cancelled = false;
    (async () => {
      try {
        const pdfjs: any = await import("pdfjs-dist");
        const worker = await import("pdfjs-dist/build/pdf.worker.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = (worker as any).default;
        const doc = await pdfjs.getDocument(presentation.file_url).promise;
        if (!cancelled) setTotalPages(doc.numPages);
      } catch (e) {
        console.error("Falha ao contar páginas", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [presentation?.file_url]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") setCurrentSlide((s) => (totalPages ? Math.min(totalPages, s + 1) : s + 1));
      else if (e.key === "ArrowLeft") setCurrentSlide((s) => Math.max(1, s - 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [totalPages]);

  const slideQuestion = useMemo(
    () => questions.find((q) => q.slide_number === currentSlide) || null,
    [questions, currentSlide],
  );

  const optionKeys = slideQuestion
    ? slideQuestion.question_type === "true_false"
      ? ["A", "B"]
      : ["A", "B", "C", "D"]
    : [];

  const distribution = useMemo(() => {
    if (!slideQuestion) return [] as Array<{ key: string; label: string; count: number; correct: boolean }>;
    const counts = new Map<string, number>();
    optionKeys.forEach((k) => counts.set(k, 0));
    for (const a of answers) {
      if (a.question_id === slideQuestion.id) {
        counts.set(a.selected_option, (counts.get(a.selected_option) ?? 0) + 1);
      }
    }
    return optionKeys.map((k) => ({
      key: k,
      label:
        slideQuestion.question_type === "true_false"
          ? k === "A"
            ? "Verdadeiro"
            : "Falso"
          : `${k}) ${slideQuestion.options?.[k] ?? ""}`,
      count: counts.get(k) ?? 0,
      correct: slideQuestion.correct_option === k,
    }));
  }, [slideQuestion, answers, optionKeys]);

  const totalAnswers = distribution.reduce((s, d) => s + d.count, 0);

  const slideRanking = useMemo(() => {
    if (!slideQuestion) return [];
    const partName = new Map(participants.map((p) => [p.id, p.name] as const));
    const rows = answers
      .filter((a) => a.question_id === slideQuestion.id)
      .map((a) => ({
        participant_id: a.participant_id,
        name: partName.get(a.participant_id) ?? "Participante",
        is_correct: a.is_correct,
        response_ms: a.response_ms,
        points: pointsFor(a, slideQuestion),
      }));
    return rows.sort((x, y) => {
      if (y.points !== x.points) return y.points - x.points;
      return x.response_ms - y.response_ms;
    });
  }, [slideQuestion, answers, participants]);

  const cumulativeRanking = useMemo(() => {
    const upTo = questions.filter((q) => q.slide_number <= currentSlide);
    const qById = new Map(upTo.map((q) => [q.id, q] as const));
    const partName = new Map(participants.map((p) => [p.id, p.name] as const));
    const agg = new Map<string, { name: string; score: number; correct: number; total_ms: number; count: number }>();
    for (const a of answers) {
      const q = qById.get(a.question_id);
      if (!q) continue;
      const cur = agg.get(a.participant_id) ?? {
        name: partName.get(a.participant_id) ?? "Participante",
        score: 0,
        correct: 0,
        total_ms: 0,
        count: 0,
      };
      cur.score += pointsFor(a, q);
      cur.correct += a.is_correct ? 1 : 0;
      cur.total_ms += a.response_ms;
      cur.count += 1;
      agg.set(a.participant_id, cur);
    }
    return Array.from(agg.entries())
      .map(([pid, v]) => ({ participant_id: pid, ...v }))
      .sort((x, y) => {
        if (y.score !== x.score) return y.score - x.score;
        if (y.correct !== x.correct) return y.correct - x.correct;
        const avgX = x.count ? x.total_ms / x.count : Number.MAX_SAFE_INTEGER;
        const avgY = y.count ? y.total_ms / y.count : Number.MAX_SAFE_INTEGER;
        return avgX - avgY;
      });
  }, [questions, answers, participants, currentSlide]);

  if (!presentation) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando análise...
      </div>
    );
  }

  const maxCount = Math.max(1, ...distribution.map((d) => d.count));

  return (
    <div className="flex h-screen flex-col bg-[#0E1015] text-foreground">
      <header className="flex items-center justify-between border-b border-[#262D3D] bg-[#131722] px-4 py-2">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="ghost" onClick={() => navigate({ to: "/dashboard" })}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Voltar
          </Button>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Análise por Slide</p>
            <h1 className="text-sm font-semibold">{presentation.title}</h1>
          </div>
        </div>
        {presentation.event_id && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate({ to: "/event/$id/podium", params: { id: presentation.event_id! } })}
          >
            Grande Pódio do Evento
          </Button>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div
          className="relative flex-[2] cursor-pointer bg-black"
          onClick={() =>
            setCurrentSlide((s) => (totalPages ? Math.min(totalPages, s + 1) : s + 1))
          }
        >
          <iframe
            key={currentSlide}
            title={presentation.title}
            src={`${presentation.file_url}#page=${currentSlide}&toolbar=0&navpanes=0&scrollbar=0&statusbar=0&messages=0&view=Fit&zoom=page-fit`}
            className="pointer-events-none h-full w-full border-none bg-black"
          />
          <div className="absolute inset-0 z-10" aria-hidden="true" />
          <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-black/60 px-2 py-1 text-xs text-white/80">
            Slide {currentSlide}
            {totalPages ? ` / ${totalPages}` : ""}
          </div>
        </div>

        <aside className="flex w-[420px] flex-col gap-3 overflow-y-auto border-l border-[#262D3D] bg-[#131722] p-4">
          <div className="flex items-center justify-between gap-2">
            <Button size="sm" variant="outline" onClick={() => setCurrentSlide(Math.max(1, currentSlide - 1))}>
              ◀ Anterior
            </Button>
            <span className="text-sm font-semibold">
              Slide {currentSlide}
              {totalPages ? ` / ${totalPages}` : ""}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setCurrentSlide((s) => (totalPages ? Math.min(totalPages, s + 1) : s + 1))
              }
            >
              Próximo ▶
            </Button>
          </div>

          {!slideQuestion ? (
            <div className="rounded-lg border border-dashed border-[#262D3D] bg-background/40 p-6 text-center text-sm text-muted-foreground">
              Nenhum quiz associado a esta página.
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-[#262D3D] bg-background/40 p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Pergunta deste slide</p>
                <p className="mt-1 text-sm font-medium">{slideQuestion.question_text}</p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {totalAnswers} {totalAnswers === 1 ? "resposta" : "respostas"} registradas
                </p>
              </div>

              <div className="rounded-lg border border-[#262D3D] bg-background/40 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                  <BarChart3 className="h-3.5 w-3.5" /> Distribuição de respostas
                </div>
                <ul className="space-y-2">
                  {distribution.map((d) => {
                    const pct = totalAnswers ? Math.round((d.count / totalAnswers) * 100) : 0;
                    const width = Math.round((d.count / maxCount) * 100);
                    return (
                      <li key={d.key} className="text-xs">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className={d.correct ? "font-semibold text-emerald-400" : ""}>
                            {d.label} {d.correct ? "✓" : ""}
                          </span>
                          <span className="text-muted-foreground">
                            {d.count} ({pct}%)
                          </span>
                        </div>
                        <div className="h-2 w-full rounded bg-[#262D3D]">
                          <div
                            className={`h-2 rounded ${d.correct ? "bg-emerald-500" : "bg-gradient-to-r from-[#A6193C] to-[#F26B1F]"}`}
                            style={{ width: `${width}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="rounded-lg border border-[#262D3D] bg-background/40 p-3">
                <div className="mb-2 flex gap-1 rounded-md bg-[#0E1015] p-1">
                  <button
                    onClick={() => setMode("slide")}
                    className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition ${
                      mode === "slide"
                        ? "bg-gradient-to-r from-[#A6193C] to-[#F26B1F] text-white"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Deste Slide
                  </button>
                  <button
                    onClick={() => setMode("cumulative")}
                    className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition ${
                      mode === "cumulative"
                        ? "bg-gradient-to-r from-[#A6193C] to-[#F26B1F] text-white"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Acumulado até aqui
                  </button>
                </div>

                {mode === "slide" ? (
                  slideRanking.length === 0 ? (
                    <p className="py-3 text-center text-xs text-muted-foreground">
                      Sem respostas para esta pergunta.
                    </p>
                  ) : (
                    <ol className="space-y-1">
                      {slideRanking.slice(0, 10).map((r, idx) => (
                        <li
                          key={r.participant_id}
                          className="flex items-center justify-between rounded bg-[#0E1015] px-2 py-1.5 text-xs"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="w-4 text-right text-muted-foreground">{idx + 1}.</span>
                            <span className="truncate">{r.name}</span>
                            {!r.is_correct && <span className="text-[10px] text-red-400">errou</span>}
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="text-muted-foreground">{(r.response_ms / 1000).toFixed(2)}s</span>
                            <span className="font-semibold text-primary">{r.points}</span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  )
                ) : cumulativeRanking.length === 0 ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">Sem dados acumulados.</p>
                ) : (
                  <ol className="space-y-1">
                    {cumulativeRanking.slice(0, 10).map((r, idx) => (
                      <li
                        key={r.participant_id}
                        className="flex items-center justify-between rounded bg-[#0E1015] px-2 py-1.5 text-xs"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="w-4 text-right text-muted-foreground">{idx + 1}.</span>
                          <span className="truncate">{r.name}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="text-muted-foreground">{r.correct} acertos</span>
                          <span className="font-semibold text-primary">{r.score}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}