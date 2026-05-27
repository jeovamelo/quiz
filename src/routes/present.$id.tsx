import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, Copy, Loader2, LogOut, Trophy } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import confetti from "canvas-confetti";
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
  is_prize_question?: boolean;
  prize_multiplier?: number;
};

function Present() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<any>(null);
  const [presentation, setPresentation] = useState<{ file_url: string; title: string; event_id: string | null; default_time_limit: number } | null>(null);
  const [nextPresentationId, setNextPresentationId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [answers, setAnswers] = useState<Array<{ question_id: string; selected_option: string; participant_id: string }>>([]);
  const [now, setNow] = useState(Date.now());
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [joinUrl, setJoinUrl] = useState("");
  const [showRanking, setShowRanking] = useState(false);
  const confettiFiredRef = useRef(false);

  useEffect(() => {
    setJoinUrl(`${window.location.origin}/join?session=${id}`);
  }, [id]);

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
          .select("file_url, title, event_id, sort_order, default_time_limit")
          .eq("id", s.presentation_id)
          .single();
        if (p) {
          setPresentation({
            file_url: p.file_url,
            title: p.title,
            event_id: (p as any).event_id ?? null,
            default_time_limit: (p as any).default_time_limit ?? 30,
          });
          // Buscar próxima apresentação do mesmo evento (sort_order > atual)
          if ((p as any).event_id) {
            const { data: nextList } = await (supabase.from("presentations") as any)
              .select("id, sort_order")
              .eq("event_id", (p as any).event_id)
              .gt("sort_order", (p as any).sort_order ?? 0)
              .order("sort_order", { ascending: true })
              .limit(1);
            setNextPresentationId(nextList && nextList.length > 0 ? nextList[0].id : null);
          }
        }
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

  // Carrega total de páginas do PDF via pdfjs
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
        console.error("Falha ao contar páginas do PDF", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [presentation?.file_url]);

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
    const effectiveLimit = activeQuestion.time_limit && activeQuestion.time_limit > 0
      ? activeQuestion.time_limit
      : presentation?.default_time_limit ?? 30;
    return Math.max(0, Math.ceil(effectiveLimit - elapsed));
  }, [activeQuestion, session, now]);

  // auto reveal when time hits 0
  useEffect(() => {
    if (activeQuestion && session?.question_started_at && !session.question_revealed) {
      const elapsed = (now - new Date(session.question_started_at).getTime()) / 1000;
      const effectiveLimit = activeQuestion.time_limit && activeQuestion.time_limit > 0
        ? activeQuestion.time_limit
        : presentation?.default_time_limit ?? 30;
      if (elapsed >= effectiveLimit) {
        revealResults();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, activeQuestion?.id, session?.question_revealed]);

  async function setSlide(n: number) {
    const next = Math.max(1, n);
    // Encerramento automático ao avançar além da última página
    if (totalPages && n > totalPages) {
      await endSession(true);
      return;
    }
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

  async function endSession(full = false) {
    const { error } = await supabase
      .from("sessions")
      .update({ status: "ended", active_question_id: null, question_started_at: null, question_revealed: false })
      .eq("id", id);
    if (error) {
      toast.error("Falha ao encerrar");
      return;
    }
    // Atualiza status de execução da apresentação
    if (session?.presentation_id) {
      await (supabase.from("presentations") as any)
        .update({ execution_status: full ? "completed_full" : "completed_partial" })
        .eq("id", session.presentation_id);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(joinUrl);
      toast.success("Link copiado!");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = joinUrl;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        toast.success("Link copiado!");
      } catch {
        toast.error("Não foi possível copiar");
      }
      document.body.removeChild(ta);
    }
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
  const isEnded = session?.status === "ended";

  // Confete quando encerra
  useEffect(() => {
    if (!isEnded || confettiFiredRef.current) return;
    confettiFiredRef.current = true;
    const end = Date.now() + 4000;
    const colors = ["#ffd700", "#c0c0c0", "#cd7f32", "#ff7a18", "#ffffff"];
    (function frame() {
      confetti({ particleCount: 4, angle: 60, spread: 70, origin: { x: 0 }, colors });
      confetti({ particleCount: 4, angle: 120, spread: 70, origin: { x: 1 }, colors });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }, [isEnded]);

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
      : ["A", "B", "C", "D"].filter(
          (k) => ((activeQuestion.options?.[k] ?? "") as string).trim() !== "",
        )
    : [];

  // === TELA DE PÓDIO ===
  if (isEnded) {
    const top3 = ranking.slice(0, 3);
    const rest = ranking.slice(3, 10);
    // [place index 0..2 = posição real, participant]
    const slots: Array<{ place: 1 | 2 | 3; p: ParticipantRow }> = [];
    if (top3[1]) slots.push({ place: 2, p: top3[1] });
    if (top3[0]) slots.push({ place: 1, p: top3[0] });
    if (top3[2]) slots.push({ place: 3, p: top3[2] });
    const styleByPlace = {
      1: { h: "h-72", color: "from-[oklch(0.85_0.18_85)] to-[oklch(0.6_0.2_40)]", medal: "🥇", label: "1º" },
      2: { h: "h-48", color: "from-[oklch(0.85_0.02_240)] to-[oklch(0.6_0.02_240)]", medal: "🥈", label: "2º" },
      3: { h: "h-36", color: "from-[oklch(0.65_0.12_50)] to-[oklch(0.45_0.12_40)]", medal: "🥉", label: "3º" },
    } as const;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-10 bg-gradient-to-br from-background via-card to-background p-10">
        <div className="text-center">
          <p className="text-sm uppercase tracking-widest text-muted-foreground">{presentation.title}</p>
          <h1 className="mt-2 text-6xl font-extrabold text-foreground">Pódio Final</h1>
        </div>

        {top3.length === 0 ? (
          <p className="text-xl text-muted-foreground">Nenhum participante.</p>
        ) : (
          <div className="flex items-end gap-8">
            {slots.map(({ place, p }) => {
              const s = styleByPlace[place];
              return (
                <div key={p.id} className="flex w-56 flex-col items-center gap-3">
                  <div className="text-6xl">{s.medal}</div>
                  <div className="text-2xl font-bold">{p.name}</div>
                  <div className="text-lg text-muted-foreground">{p.score} pts</div>
                  <div
                    className={`flex w-full items-start justify-center rounded-t-xl bg-gradient-to-b pt-4 text-4xl font-black text-white shadow-2xl ${s.h} ${s.color}`}
                  >
                    {s.label}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {rest.length > 0 && (
          <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">Classificação geral</h3>
            <ol className="space-y-1">
              {rest.map((p, idx) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded border border-border bg-background/40 px-3 py-2 text-sm"
                >
                  <span>
                    <span className="mr-2 inline-block w-6 text-right text-muted-foreground">{idx + 4}.</span>
                    {p.name}
                  </span>
                  <span className="font-semibold text-primary">{p.score} pts</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <Button variant="outline" onClick={() => navigate({ to: "/dashboard" })}>
          Voltar ao Painel
        </Button>
        {presentation.event_id && (
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button
              onClick={() => navigate({ to: "/event/$id/podium", params: { id: presentation.event_id! } })}
            >
              Ver Grande Pódio do Evento
            </Button>
            {nextPresentationId && (
              <Button
                variant="secondary"
                onClick={async () => {
                  const { data: newSession, error } = await supabase
                    .from("sessions")
                    .insert({
                      presentation_id: nextPresentationId,
                      status: "lobby",
                      current_slide: 1,
                    })
                    .select("id")
                    .single();
                  if (error || !newSession) {
                    toast.error("Não foi possível iniciar a próxima apresentação");
                    return;
                  }
                  navigate({ to: "/lobby/$id", params: { id: newSession.id } });
                }}
              >
                Próxima Apresentação →
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

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
            src={`${presentation.file_url}#page=${currentSlide}&toolbar=0&navpanes=0&scrollbar=0&statusbar=0&messages=0&view=Fit&zoom=page-fit`}
            className="pointer-events-none h-full w-full border-none bg-black"
            style={{ objectFit: "contain" }}
          />
          {/* Camada protetora: bloqueia scroll/arrasto dentro do iframe do PDF */}
          <div className="absolute inset-0 z-10" aria-hidden="true" />
          <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-black/60 px-2 py-1 text-xs text-white/80">
            Slide {currentSlide}
          </div>
          {/* Botão voltar para Evento */}
          {presentation.event_id && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                navigate({ to: "/event/$id", params: { id: presentation.event_id! } });
              }}
              title="Voltar para o Evento"
              aria-label="Voltar para o Evento"
              className="absolute left-4 top-4 z-20 flex h-12 w-12 items-center justify-center rounded-full border border-[#262D3D] bg-[#161A23]/90 text-[#9CA3AF] shadow-lg backdrop-blur transition hover:scale-105 hover:text-[#F68B1F] hover:bg-[#161A23]"
            >
              <ArrowLeft className="h-6 w-6" />
            </button>
          )}
          {/* Botão flutuante de Classificação */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowRanking((v) => !v);
            }}
            title={showRanking ? "Ocultar Classificação" : "Mostrar Classificação"}
            aria-label={showRanking ? "Ocultar Classificação" : "Mostrar Classificação"}
            className="absolute right-4 top-4 z-20 flex h-12 w-12 items-center justify-center rounded-full border border-[#262D3D] bg-[#161A23]/90 text-[#FFCB05] shadow-lg backdrop-blur transition hover:scale-105 hover:bg-[#161A23]"
          >
            <Trophy className="h-6 w-6" />
          </button>
        </div>

        {/* Painel retrátil — Classificação em tempo real */}
        <div
          className={`overflow-hidden border-l border-[#262D3D] bg-[#161A23] transition-all duration-300 ease-in-out ${
            showRanking ? "w-80" : "w-0"
          }`}
          aria-hidden={!showRanking}
        >
          <div className="flex h-full w-80 flex-col">
            <div className="border-b border-[#262D3D] px-4 py-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-white">
                Classificação em tempo real
              </h3>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {ranking.length} {ranking.length === 1 ? "participante" : "participantes"}
              </p>
            </div>
            <ol className="flex-1 space-y-2 overflow-y-auto p-3">
              {ranking.map((p, idx) => {
                const pos = idx + 1;
                const firstName = (p.name || "").trim().split(/\s+/)[0] || "—";
                const badgeCls =
                  pos === 1
                    ? "bg-[#F68B1F] text-white"
                    : pos === 2
                    ? "bg-[#9CA3AF] text-white"
                    : pos === 3
                    ? "bg-[#FFE6CB] text-[#A6193C]"
                    : "bg-[#0E1015] text-muted-foreground border border-[#262D3D]";
                return (
                  <li
                    key={p.id}
                    style={{ order: pos }}
                    className="flex items-center gap-3 rounded-lg border border-[#262D3D] bg-[#0E1015]/60 px-3 py-2 transition-all duration-500 ease-in-out animate-fade-in"
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${badgeCls}`}
                    >
                      {pos}º
                    </span>
                    <span className="flex-1 truncate text-sm font-medium text-white">
                      {firstName}
                    </span>
                    <span className="text-sm font-bold text-[#FFCB05]">
                      {p.score}
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">pts</span>
                    </span>
                  </li>
                );
              })}
              {ranking.length === 0 && (
                <li className="rounded border border-dashed border-[#262D3D] px-3 py-6 text-center text-xs text-muted-foreground">
                  Aguardando participantes...
                </li>
              )}
            </ol>
          </div>
        </div>

        {/* Coluna direita — painel admin */}
        <aside className="flex w-[400px] flex-col gap-3 overflow-y-auto border-l border-border bg-card p-4">
          {/* Convite sempre visível */}
          <div className="rounded-lg border border-border bg-background/40 p-3 text-center">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Entre na sala a qualquer momento
            </p>
            <div className="mx-auto inline-block rounded-md bg-white p-2">
              {joinUrl && <QRCodeSVG value={joinUrl} size={130} />}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-background/60 px-2 py-1 text-[10px] text-muted-foreground">
                {joinUrl}
              </code>
              <Button size="sm" variant="outline" onClick={copyLink}>
                <Copy className="mr-1 h-3 w-3" /> Copiar
              </Button>
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{presentation.title}</p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <Button size="sm" variant="outline" onClick={() => setSlide(currentSlide - 1)}>
                ◀ Anterior
              </Button>
              <span className="text-sm font-semibold">
                Slide {currentSlide}
                {totalPages ? ` / ${totalPages}` : ""}
              </span>
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
            <div
              className={`space-y-3 rounded-lg border p-3 ${
                activeQuestion.is_prize_question
                  ? "border-[#FFCB05] bg-[#FFCB05]/10 shadow-[0_0_24px_-4px_#FFCB05]"
                  : "border-primary/40 bg-primary/5"
              }`}
            >
              {activeQuestion.is_prize_question && (
                <div className="rounded-md border border-[#FFCB05] bg-gradient-to-r from-[#FFCB05] to-[#F68B1F] px-3 py-2 text-center text-xs font-extrabold uppercase tracking-wider text-black animate-pulse">
                  ⚡ ATENÇÃO: PERGUNTA PRÊMIO VALENDO {activeQuestion.prize_multiplier ?? 5}X MAIS PONTOS!
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className={`text-xs font-semibold uppercase ${activeQuestion.is_prize_question ? "text-[#FFCB05]" : "text-primary"}`}>
                  {activeQuestion.is_prize_question ? "⚡ Pergunta Prêmio" : "Pergunta ativa"}
                </span>
                {!session?.question_revealed ? (
                  <span
                    className={`rounded px-2 py-1 text-xs font-bold ${
                      activeQuestion.is_prize_question
                        ? "bg-[#FFCB05] text-black animate-pulse"
                        : "bg-primary text-primary-foreground"
                    }`}
                  >
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
                  <span className="text-xs font-semibold text-primary">{p.score} pts</span>
                </li>
              ))}
              {ranking.length === 0 && (
                <li className="text-xs text-muted-foreground">Nenhum participante ainda</li>
              )}
            </ol>
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="mt-auto border-[#A6193C]/60 text-[#9CA3AF] hover:bg-[#A6193C]/10 hover:text-white"
              >
                <LogOut className="mr-2 h-4 w-4" /> Sair da Apresentação
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="border-[#262D3D] bg-[#0E1015] text-white">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-white">Deseja realmente sair?</AlertDialogTitle>
                <AlertDialogDescription className="text-[#9CA3AF]">
                  Isso encerrará a conexão realtime com os celulares de todos os participantes ativos nesta palestra.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-[#262D3D] bg-transparent text-[#9CA3AF] hover:bg-[#1E2235] hover:text-white">
                  Cancelar
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={async () => {
                    await endSession();
                    navigate({ to: "/dashboard" });
                  }}
                  className="bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-white hover:opacity-95"
                >
                  Sim, encerrar e sair
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </aside>
      </div>
    </div>
  );
}
