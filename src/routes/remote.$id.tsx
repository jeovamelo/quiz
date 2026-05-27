import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  Home,
  Loader2,
  Maximize,
  Minimize,
  Power,
  Sparkles,
  Timer,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useRequireSpeaker } from "@/hooks/use-auth";
import { haptic } from "@/hooks/use-haptic";
import { toast } from "sonner";

export const Route = createFileRoute("/remote/$id")({
  head: () => ({ meta: [{ title: "Controle Remoto — QuizPulse" }] }),
  component: RemoteControl,
});

type Question = {
  id: string;
  question_text: string;
  slide_number: number;
  display_mode: string;
  is_prize_question?: boolean;
  prize_multiplier?: number;
};

function RemoteControl() {
  useRequireSpeaker();
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<any>(null);
  const [presentation, setPresentation] = useState<{
    title: string;
    default_time_limit: number;
    event_id: string | null;
    event_title?: string | null;
  } | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [participantsCount, setParticipantsCount] = useState(0);
  const [answersCount, setAnswersCount] = useState(0);
  const [now, setNow] = useState<number>(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [synced, setSynced] = useState(false);

  // Carrega sessão, apresentação, perguntas e contagem de participantes
  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      const { data: s } = await supabase.from("sessions").select("*").eq("id", id).single();
      if (cancelled) return;
      setSession(s);
      if (s) {
        const { data: p } = await (supabase.from("presentations") as any)
          .select("title, default_time_limit, event_id")
          .eq("id", s.presentation_id)
          .single();
        if (!cancelled && p) {
          let eventTitle: string | null = null;
          if (p.event_id) {
            const { data: ev } = await (supabase.from("events") as any)
              .select("title")
              .eq("id", p.event_id)
              .maybeSingle();
            eventTitle = ev?.title ?? null;
          }
          setPresentation({
            title: p.title,
            default_time_limit: p.default_time_limit ?? 30,
            event_id: p.event_id ?? null,
            event_title: eventTitle,
          });
        }
        const { data: qs } = await supabase
          .from("questions")
          .select("id, question_text, slide_number, display_mode, is_prize_question, prize_multiplier")
          .eq("presentation_id", s.presentation_id)
          .order("position");
        if (!cancelled) setQuestions((qs as any) || []);
      }
      const { count } = await supabase
        .from("participants")
        .select("id", { count: "exact", head: true })
        .eq("session_id", id);
      if (!cancelled) setParticipantsCount(count ?? 0);
    }
    loadAll();
    const ch = supabase
      .channel(`remote-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sessions", filter: `id=eq.${id}` },
        (payload) => setSession(payload.new),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "participants", filter: `session_id=eq.${id}` },
        async () => {
          const { count } = await supabase
            .from("participants")
            .select("id", { count: "exact", head: true })
            .eq("session_id", id);
          setParticipantsCount(count ?? 0);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "questions", filter: `presentation_id=eq.${session?.presentation_id ?? "00000000-0000-0000-0000-000000000000"}` },
        async () => {
          // refetch perguntas para refletir toggle de prêmio
          const presId = (await supabase.from("sessions").select("presentation_id").eq("id", id).single()).data?.presentation_id;
          if (!presId) return;
          const { data: qs } = await supabase
            .from("questions")
            .select("id, question_text, slide_number, display_mode, is_prize_question, prize_multiplier")
            .eq("presentation_id", presId)
            .order("position");
          setQuestions((qs as any) || []);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "answers", filter: `session_id=eq.${id}` },
        async () => {
          const activeQid = (await supabase.from("sessions").select("active_question_id").eq("id", id).single()).data?.active_question_id;
          if (!activeQid) {
            setAnswersCount(0);
            return;
          }
          const { count } = await supabase
            .from("answers")
            .select("id", { count: "exact", head: true })
            .eq("session_id", id)
            .eq("question_id", activeQid);
          setAnswersCount(count ?? 0);
        },
      )
      .subscribe((status) => {
        setSynced(status === "SUBSCRIBED");
      });
    return () => {
      cancelled = true;
      setSynced(false);
      supabase.removeChannel(ch);
    };
  }, [id]);

  // Refaz a contagem de respostas quando a pergunta ativa muda
  useEffect(() => {
    const qid = session?.active_question_id;
    if (!qid) {
      setAnswersCount(0);
      return;
    }
    let cancelled = false;
    (async () => {
      const { count } = await supabase
        .from("answers")
        .select("id", { count: "exact", head: true })
        .eq("session_id", id)
        .eq("question_id", qid);
      if (!cancelled) setAnswersCount(count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.active_question_id, id]);

  // Cronômetro
  useEffect(() => {
    if (!session?.question_started_at || session?.question_revealed) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [session?.question_started_at, session?.question_revealed]);

  const currentSlide: number = session?.current_slide || 1;
  const totalSlides = useMemo(() => {
    const maxQ = questions.reduce((m, q) => Math.max(m, q.slide_number || 0), 0);
    return Math.max(maxQ, currentSlide);
  }, [questions, currentSlide]);
  const slideQuestion = useMemo(
    () => questions.find((q) => q.slide_number === currentSlide) || null,
    [questions, currentSlide],
  );
  const activeQuestion = useMemo(
    () => questions.find((q) => q.id === session?.active_question_id) || null,
    [questions, session?.active_question_id],
  );
  const isEnded = session?.status === "ended";

  const timeLimit = presentation?.default_time_limit ?? 30;
  const elapsed = session?.question_started_at
    ? Math.floor((now - new Date(session.question_started_at).getTime()) / 1000)
    : 0;
  const remaining = activeQuestion && !session?.question_revealed
    ? Math.max(0, timeLimit - elapsed)
    : null;

  async function withBusy<T>(fn: () => Promise<T>) {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  }

  async function nextSlide() {
    haptic(45);
    await withBusy(async () => {
      // Se há pergunta ativa e ainda não foi revelada, "AVANÇAR" encerra o timer (revela)
      if (activeQuestion && !session?.question_revealed) {
        const { error } = await supabase
          .from("sessions")
          .update({ question_revealed: true })
          .eq("id", id);
        if (error) toast.error("Erro ao encerrar a pergunta.");
        return;
      }
      // Se o slide atual tem pergunta e ela ainda não foi lançada, lança em vez de avançar
      if (slideQuestion && !activeQuestion) {
        const { error } = await supabase
          .from("sessions")
          .update({
            active_question_id: slideQuestion.id,
            question_started_at: new Date().toISOString(),
            question_revealed: false,
          })
          .eq("id", id);
        if (error) toast.error("Erro ao lançar a pergunta.");
        return;
      }
      const next = currentSlide + 1;
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
      const { error } = await supabase.from("sessions").update(patch).eq("id", id);
      if (error) toast.error("Erro ao sincronizar comando com o projetor.");
    });
  }

  async function prevSlide() {
    haptic(25);
    await withBusy(async () => {
      const prev = Math.max(1, currentSlide - 1);
      const { error } = await supabase
        .from("sessions")
        .update({
          current_slide: prev,
          question_revealed: false,
          active_question_id: null,
          question_started_at: null,
        })
        .eq("id", id);
      if (error) toast.error("Erro ao sincronizar comando com o projetor.");
    });
  }

  async function showPodium() {
    haptic(50);
    try {
      const ch = supabase.channel(`present-remote-${id}`);
      await new Promise<void>((resolve) => {
        ch.subscribe((status) => {
          if (status === "SUBSCRIBED") resolve();
        });
        window.setTimeout(() => resolve(), 500);
      });
      await ch.send({
        type: "broadcast",
        event: "toggle_ranking",
        payload: { show: true },
      });
      window.setTimeout(() => supabase.removeChannel(ch), 300);
      if (activeQuestion && !session?.question_revealed) {
        await supabase.from("sessions").update({ question_revealed: true }).eq("id", id);
      }
      toast.success("Pódio exibido no projetor!");
    } catch {
      toast.error("Falha ao exibir o pódio.");
    }
  }

  async function togglePrize(next: boolean) {
    if (!slideQuestion) return;
    haptic(35);
    const multiplier = next ? (slideQuestion.prize_multiplier ?? 5) : 5;
    const { error } = await (supabase.from("questions") as any)
      .update({ is_prize_question: next, prize_multiplier: multiplier })
      .eq("id", slideQuestion.id);
    if (error) {
      toast.error("Falha ao atualizar pergunta prêmio.");
      return;
    }
    setQuestions((prev) =>
      prev.map((q) =>
        q.id === slideQuestion.id
          ? { ...q, is_prize_question: next, prize_multiplier: multiplier }
          : q,
      ),
    );
    toast.success(next ? "Pergunta Prêmio ATIVADA!" : "Pergunta Prêmio desativada.");
  }

  async function toggleFullscreen() {
    haptic(30);
    const next = !session?.is_fullscreen;
    const { error } = await (supabase.from("sessions") as any)
      .update({ is_fullscreen: next })
      .eq("id", id);
    if (error) {
      toast.error("Falha ao alternar tela cheia.");
    } else {
      toast.success(next ? "Tela cheia ativada no projetor." : "Saindo da tela cheia.");
    }
  }

  async function exitToHub() {
    await withBusy(async () => {
      // 1. Marca sessão como encerrada
      await supabase
        .from("sessions")
        .update({
          status: "ended",
          active_question_id: null,
          question_started_at: null,
          question_revealed: false,
        })
        .eq("id", id);
      if (session?.presentation_id) {
        await (supabase.from("presentations") as any)
          .update({ execution_status: "completed_partial" })
          .eq("id", session.presentation_id);
      }

      // 2. Avisa o projetor para voltar ao lobby
      if (presentation?.event_id) {
        try {
          const ch = supabase.channel(`event-lobby-${presentation.event_id}`);
          await new Promise<void>((resolve) => {
            ch.subscribe((status) => {
              if (status === "SUBSCRIBED") resolve();
            });
            window.setTimeout(() => resolve(), 600);
          });
          await ch.send({
            type: "broadcast",
            event: "return_to_lobby",
            payload: { event_id: presentation.event_id },
          });
          window.setTimeout(() => supabase.removeChannel(ch), 300);
        } catch {
          /* ignora */
        }
      }

      toast.success("Apresentação fechada. Escolha a próxima!");
      navigate({ to: "/remote" });
    });
  }

  if (!session || !presentation) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0E1015] text-white">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando controle remoto...
      </div>
    );
  }

  if (isEnded) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#0E1015] p-6 text-center text-white">
        <Trophy className="h-12 w-12 text-[#FFCB05]" />
        <h1 className="text-2xl font-bold">Apresentação encerrada</h1>
        <p className="text-sm text-[#9CA3AF]">Escolha a próxima apresentação para continuar.</p>
        <Link
          to="/remote"
          className="rounded-xl bg-gradient-to-r from-[#A6193C] to-[#F68B1F] px-6 py-3 text-sm font-bold text-white shadow-lg"
        >
          Voltar à seleção
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#0E1015] text-white">
      {/* Cabeçalho de status */}
      <header className="sticky top-0 z-10 shrink-0 border-b border-[#262D3D] bg-[#131722]/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                onClick={() => haptic(25)}
                aria-label="Voltar ao painel de apresentações"
                className="flex items-center gap-1 rounded-lg border border-[#262D3D] bg-[#1E2235] px-2.5 py-1.5 text-[11px] font-semibold text-[#9CA3AF] transition-all duration-100 active:scale-95 active:bg-[#262D3D]"
              >
                <Home className="h-3.5 w-3.5" /> Painel
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent className="border-[#262D3D] bg-[#0E1015] text-white">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-white">
                  Trocar de apresentação?
                </AlertDialogTitle>
                <AlertDialogDescription className="text-[#9CA3AF]">
                  Isso encerra a sessão atual no projetor e leva você de volta ao painel para escolher outra apresentação.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-[#262D3D] bg-transparent text-[#9CA3AF] hover:bg-[#1E2235] hover:text-white">
                  Cancelar
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={exitToHub}
                  className="bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-white hover:opacity-95"
                >
                  Sim, encerrar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-[#F68B1F]">
              {presentation.event_title || "Apresentação"}
            </p>
            <h1 className="truncate text-[13px] font-bold leading-tight">
              {presentation.title}
            </h1>
          </div>

          <div
            className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold ${
              synced
                ? "border-[#07A684]/40 bg-[#07A684]/10 text-[#07A684]"
                : "border-[#A6193C]/40 bg-[#A6193C]/10 text-[#F68B1F]"
            }`}
            aria-live="polite"
            aria-label={synced ? "Sincronizado" : "Conectando"}
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                synced ? "bg-[#07A684] animate-pulse" : "bg-[#F68B1F]"
              }`}
            />
            {synced ? "Ao vivo" : "..."}
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-[#9CA3AF]">
          <span className="rounded bg-[#0E1015] px-2 py-0.5 font-mono text-white">
            Slide {currentSlide} de {totalSlides}
          </span>
          <span className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-[#07A684]" />
            <span className="font-semibold text-white">{participantsCount}</span> usuários
          </span>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col p-3">
        {/* MEIO — Status do Quiz (somente quando há pergunta no slide) */}
        {slideQuestion && (
          <section
            className="shrink-0 space-y-2 rounded-2xl border p-3 shadow-lg"
            style={{ borderColor: "#BA2172", background: "rgba(186, 33, 114, 0.12)" }}
          >
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#E879B5]">
                <Zap className="h-3.5 w-3.5" />
                {activeQuestion ? "Quiz no ar" : "Pergunta neste slide"}
              </p>
              {slideQuestion.is_prize_question && (
                <span className="rounded-full bg-[#FFCB05] px-2 py-0.5 text-[10px] font-extrabold uppercase text-black">
                  Prêmio {slideQuestion.prize_multiplier ?? 5}x
                </span>
              )}
            </div>

            {activeQuestion && (
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl bg-[#0E1015]/70 px-2 py-1.5">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-[#9CA3AF]">
                    Respostas
                  </p>
                  <p className="text-base font-black text-white">
                    {answersCount}
                    <span className="text-xs font-bold text-[#9CA3AF]">/{participantsCount}</span>
                  </p>
                </div>
                <div className="rounded-xl bg-[#0E1015]/70 px-2 py-1.5">
                  <p className="flex items-center justify-center gap-1 text-[9px] font-semibold uppercase tracking-widest text-[#9CA3AF]">
                    <Timer className="h-3 w-3" /> Tempo
                  </p>
                  <p className="text-base font-black text-white">
                    {session?.question_revealed ? "—" : `${remaining ?? timeLimit}s`}
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between rounded-xl border border-[#FFCB05]/30 bg-[#0E1015]/60 px-3 py-1.5">
              <span className="flex items-center gap-2 text-xs font-bold text-[#FFCB05]">
                <Sparkles className="h-4 w-4" /> Pergunta Prêmio
              </span>
              <Switch
                checked={!!slideQuestion.is_prize_question}
                onCheckedChange={togglePrize}
              />
            </div>
          </section>
        )}

        {/* Espaço flexível */}
        <div className="min-h-2 flex-1" />

        {/* RODAPÉ DE CONTROLE — 4 botões persistentes */}
        <div className="shrink-0 space-y-2.5 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
          {/* LINHA A: Encerrar (esq) + Mostrar Pódio (dir) */}
          <div className="grid grid-cols-2 gap-2.5">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  onClick={() => haptic(25)}
                  className="flex h-11 items-center justify-center gap-1.5 rounded-xl border-2 border-[#A6193C]/60 bg-[#A6193C]/10 text-xs font-bold uppercase tracking-wide text-[#F87171] transition-all duration-100 active:scale-95 active:bg-[#A6193C]/25"
                  aria-label="Encerrar apresentação"
                >
                  <Power className="h-4 w-4" /> Encerrar
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent className="border-[#262D3D] bg-[#0E1015] text-white">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-white">
                    Encerrar esta apresentação?
                  </AlertDialogTitle>
                  <AlertDialogDescription className="text-[#9CA3AF]">
                    Deseja mesmo encerrar esta apresentação ativa? O projetor será liberado para a próxima.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="border-[#262D3D] bg-transparent text-[#9CA3AF] hover:bg-[#1E2235] hover:text-white">
                    Cancelar
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={exitToHub}
                    className="bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-white hover:opacity-95"
                  >
                    Sim, encerrar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <button
              type="button"
              onClick={showPodium}
              disabled={busy}
              className="flex h-11 items-center justify-center gap-1.5 rounded-xl border-2 border-[#FFCB05] bg-[#FFCB05]/10 text-xs font-bold uppercase tracking-wide text-[#FFCB05] transition-all duration-100 active:scale-95 active:bg-[#FFCB05]/25 disabled:opacity-40"
              aria-label="Mostrar pódio"
            >
              <Trophy className="h-4 w-4" /> Mostrar Pódio
            </button>
          </div>

          {/* LINHA B: BOTÃO HERÓI AVANÇAR */}
          <button
            type="button"
            onClick={nextSlide}
            disabled={busy}
            aria-label="Avançar"
            className="relative flex h-[42vh] min-h-[220px] w-full items-center justify-center gap-3 overflow-hidden rounded-3xl border-0 bg-gradient-to-br from-[#A6193C] via-[#D14628] to-[#F68B1F] text-white shadow-2xl shadow-[#A6193C]/50 transition-all duration-100 active:scale-95 active:from-[#8E1432] active:to-[#D87412] disabled:opacity-60"
          >
            <span className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" aria-hidden="true" />
            <div className="relative z-10 flex flex-col items-center justify-center gap-2">
              <span className="text-[44px] font-black uppercase leading-none tracking-tight drop-shadow-lg sm:text-[56px]">
                AVANÇAR
              </span>
              <ChevronRight className="h-14 w-14 drop-shadow-lg" strokeWidth={3} />
            </div>
          </button>

          {/* LINHA C: VOLTAR — base extrema */}
          <button
            type="button"
            onClick={prevSlide}
            disabled={busy || currentSlide <= 1}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#3A4255] bg-[#1E2235] text-sm font-bold text-white shadow-md transition-all duration-100 active:scale-95 active:bg-[#262D3D] disabled:opacity-40"
            aria-label="Voltar"
          >
            <ChevronLeft className="h-5 w-5" /> Voltar
          </button>
        </div>
      </main>
    </div>
  );
}