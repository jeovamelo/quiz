import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Loader2,
  LogOut,
  Smartphone,
  Sparkles,
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
  } | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [participantsCount, setParticipantsCount] = useState(0);
  const [busy, setBusy] = useState(false);

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
          setPresentation({
            title: p.title,
            default_time_limit: p.default_time_limit ?? 30,
            event_id: p.event_id ?? null,
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
      .subscribe();
    return () => {
      cancelled = true;
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
  const isEnded = session?.status === "ended";

  async function withBusy<T>(fn: () => Promise<T>) {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  }

  async function nextSlide() {
    await withBusy(async () => {
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

  async function launchQuestion() {
    if (!slideQuestion) return;
    await withBusy(async () => {
      const { error } = await supabase
        .from("sessions")
        .update({
          active_question_id: slideQuestion.id,
          question_started_at: new Date().toISOString(),
          question_revealed: false,
        })
        .eq("id", id);
      if (error) toast.error("Erro ao lançar a pergunta.");
      else toast.success("Pergunta lançada para os celulares!");
    });
  }

  async function revealAnswer() {
    if (!activeQuestion) return;
    await withBusy(async () => {
      const { error } = await supabase
        .from("sessions")
        .update({ question_revealed: true })
        .eq("id", id);
      if (error) toast.error("Erro ao revelar resposta.");
    });
  }

  async function showResults() {
    // Dispara broadcast para projetor abrir o painel de classificação
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
      toast.success("Resultados exibidos no projetor.");
    } catch {
      toast.error("Falha ao exibir resultados.");
    }
  }

  async function togglePrize(next: boolean) {
    if (!slideQuestion) return;
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
    <div className="flex min-h-[100dvh] flex-col bg-[#0E1015] text-white">
      {/* Cabeçalho de status */}
      <header className="sticky top-0 z-10 border-b border-[#262D3D] bg-[#131722]/95 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#F68B1F]">
              <Smartphone className="h-3 w-3" /> Clicker Ativo
            </p>
            <h1 className="mt-0.5 truncate text-sm font-bold">{presentation.title}</h1>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 rounded-lg border border-[#A6193C]/40 bg-[#A6193C]/10 px-2.5 py-1.5 text-[11px] font-bold text-[#F68B1F] hover:bg-[#A6193C]/20"
              >
                <LogOut className="h-3.5 w-3.5" /> Mudar
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent className="border-[#262D3D] bg-[#0E1015] text-white">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-white">
                  Fechar esta apresentação?
                </AlertDialogTitle>
                <AlertDialogDescription className="text-[#9CA3AF]">
                  Deseja fechar esta apresentação no projetor e escolher outra?
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
                  Sim, fechar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-[#9CA3AF]">
          <span className="rounded bg-[#0E1015] px-2 py-0.5 font-mono">
            Slide {currentSlide}
          </span>
          <span className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-[#07A684]" />
            <span className="font-semibold text-white">{participantsCount}</span> usuários
          </span>
        </div>
      </header>

      <main className="flex flex-1 flex-col p-3">
        {/* Console de Quiz — só aparece quando o slide tem pergunta vinculada */}
        {slideQuestion && (
          <section
            className="mb-3 space-y-2.5 rounded-2xl border p-3 shadow-lg"
            style={{ borderColor: "#BA2172", background: "rgba(186, 33, 114, 0.12)" }}
          >
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#E879B5]">
                <Zap className="h-3.5 w-3.5" /> Pergunta neste slide
              </p>
              {slideQuestion.is_prize_question && (
                <span className="rounded-full bg-[#FFCB05] px-2 py-0.5 text-[10px] font-extrabold uppercase text-black">
                  Prêmio {slideQuestion.prize_multiplier ?? 5}x
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={launchQuestion}
                disabled={busy || !!activeQuestion}
                className="flex min-h-[56px] items-center justify-center gap-1.5 rounded-xl bg-[#BA2172] text-sm font-extrabold text-white shadow-md shadow-[#BA2172]/40 transition active:scale-[0.98] disabled:opacity-40"
              >
                <Zap className="h-4 w-4" /> Lançar Quiz
              </button>
              <button
                type="button"
                onClick={showResults}
                disabled={busy || !activeQuestion}
                className="flex min-h-[56px] items-center justify-center gap-1.5 rounded-xl bg-[#FFCB05] text-sm font-extrabold text-black shadow-md transition active:scale-[0.98] disabled:opacity-40"
              >
                <BarChart3 className="h-4 w-4" /> Mostrar Resultados
              </button>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-[#FFCB05]/30 bg-[#0E1015]/60 px-3 py-2">
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
        <div className="flex-1" />

        {/* === BOTÃO HERÓI AVANÇAR === */}
        <button
          type="button"
          onClick={nextSlide}
          disabled={busy}
          className="relative flex h-[55vh] min-h-[320px] w-full items-center justify-center gap-3 overflow-hidden rounded-3xl border-0 bg-gradient-to-br from-[#A6193C] via-[#D14628] to-[#F68B1F] text-white shadow-2xl shadow-[#A6193C]/50 transition active:scale-[0.985] disabled:opacity-60"
        >
          <span className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" aria-hidden="true" />
          <div className="relative z-10 flex flex-col items-center justify-center gap-2">
            <span className="text-[44px] font-black uppercase leading-none tracking-tight drop-shadow-lg sm:text-[56px]">
              AVANÇAR
            </span>
            <ChevronRight className="h-20 w-20 drop-shadow-lg" strokeWidth={3} />
          </div>
        </button>

        {/* Botão Voltar — pequeno, isolado */}
        <div className="mt-3 flex justify-start">
          <button
            type="button"
            onClick={prevSlide}
            disabled={busy || currentSlide <= 1}
            className="flex items-center gap-1.5 rounded-xl border border-[#262D3D] bg-[#1E2235] px-4 py-2.5 text-xs font-semibold text-[#9CA3AF] transition active:scale-[0.97] disabled:opacity-30"
            aria-label="Voltar slide"
          >
            <ChevronLeft className="h-4 w-4" /> Voltar
          </button>
        </div>
      </main>
    </div>
  );
}