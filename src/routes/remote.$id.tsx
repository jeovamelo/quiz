import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  Loader2,
  LogOut,
  RefreshCw,
  Smartphone,
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
import { Button } from "@/components/ui/button";
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
  const [showRankingRemote, setShowRankingRemote] = useState(false);
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

  async function toggleRanking() {
    const next = !showRankingRemote;
    setShowRankingRemote(next);
    try {
      const ch = supabase.channel(`present-remote-${id}`);
      await new Promise<void>((resolve) => {
        ch.subscribe((status) => {
          if (status === "SUBSCRIBED") resolve();
        });
        window.setTimeout(() => resolve(), 600);
      });
      await ch.send({
        type: "broadcast",
        event: "toggle_ranking",
        payload: { show: next },
      });
      window.setTimeout(() => supabase.removeChannel(ch), 400);
      toast.success(next ? "Classificação exibida no projetor." : "Classificação ocultada.");
    } catch {
      toast.error("Falha ao sincronizar painel de classificação.");
    }
  }

  async function restartSession() {
    await withBusy(async () => {
      // Apaga respostas desta sessão e zera participantes
      await supabase.from("answers").delete().eq("session_id", id);
      await (supabase.from("participants") as any)
        .update({ score: 0, correct_count: 0, answer_count: 0, total_response_ms: 0 })
        .eq("session_id", id);
      await supabase
        .from("sessions")
        .update({
          current_slide: 1,
          active_question_id: null,
          question_started_at: null,
          question_revealed: false,
          status: "presenting",
        })
        .eq("id", id);
      toast.success("Apresentação reiniciada.");
    });
  }

  async function endSession() {
    await withBusy(async () => {
      const { error } = await supabase
        .from("sessions")
        .update({
          status: "ended",
          active_question_id: null,
          question_started_at: null,
          question_revealed: false,
        })
        .eq("id", id);
      if (error) {
        toast.error("Falha ao encerrar apresentação.");
        return;
      }
      if (session?.presentation_id) {
        await (supabase.from("presentations") as any)
          .update({ execution_status: "completed_partial" })
          .eq("id", session.presentation_id);
      }
      toast.success("Apresentação encerrada.");
      if (presentation?.event_id) {
        navigate({ to: "/event/$id/podium", params: { id: presentation.event_id }, search: { finale: 1 } });
      } else {
        navigate({ to: "/dashboard" });
      }
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
        <p className="text-sm text-[#9CA3AF]">Não há mais nada a controlar nesta sessão.</p>
        <Button asChild className="bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-white">
          <Link to="/dashboard">Voltar ao Painel</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#0E1015] text-white">
      {/* Cabeçalho de status */}
      <header className="sticky top-0 z-10 border-b border-[#262D3D] bg-[#131722]/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#F68B1F]">
              <Smartphone className="h-3 w-3" /> Controle Remoto Ativo
            </p>
            <h1 className="mt-0.5 truncate text-base font-bold">{presentation.title}</h1>
          </div>
          <Button asChild size="icon" variant="ghost" className="text-[#9CA3AF] hover:bg-[#1E2235] hover:text-white">
            <Link to="/dashboard">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-[#9CA3AF]">
          <span className="rounded bg-[#0E1015] px-2 py-0.5 font-mono">
            Slide {currentSlide}
          </span>
          <span className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5 text-[#07A684]" />
            <span className="font-semibold text-white">{participantsCount}</span> Usuários Online
          </span>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-3 p-4">
        {/* Painel de Controle de Slides */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={prevSlide}
            disabled={busy || currentSlide <= 1}
            className="flex min-h-[88px] items-center justify-center gap-2 rounded-2xl border border-[#262D3D] bg-[#161A23] text-base font-bold text-white shadow-lg transition active:scale-[0.98] disabled:opacity-40"
          >
            <ArrowLeft className="h-6 w-6" /> Voltar
          </button>
          <button
            type="button"
            onClick={nextSlide}
            disabled={busy}
            className="flex min-h-[88px] items-center justify-center gap-2 rounded-2xl border-0 bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-base font-extrabold text-white shadow-2xl shadow-[#A6193C]/40 transition active:scale-[0.98] disabled:opacity-50"
          >
            Avançar <ArrowRight className="h-6 w-6" />
          </button>
        </div>

        {/* Painel de Quiz (somente quando o slide atual tem pergunta) */}
        {slideQuestion && (
          <section
            className="space-y-3 rounded-2xl border p-4 shadow-lg"
            style={{ borderColor: "#BA2172", background: "rgba(186, 33, 114, 0.10)" }}
          >
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#E879B5]">
                <Zap className="h-3.5 w-3.5" /> Pergunta vinculada
              </p>
              {slideQuestion.is_prize_question && (
                <span className="rounded-full bg-[#FFCB05] px-2 py-0.5 text-[10px] font-extrabold uppercase text-black">
                  Prêmio {slideQuestion.prize_multiplier ?? 5}x
                </span>
              )}
            </div>
            <p className="text-sm font-medium text-white">{slideQuestion.question_text}</p>

            {!activeQuestion ? (
              <button
                type="button"
                onClick={launchQuestion}
                disabled={busy}
                className="flex min-h-[72px] w-full items-center justify-center gap-2 rounded-2xl bg-[#BA2172] text-base font-extrabold text-white shadow-lg shadow-[#BA2172]/40 transition active:scale-[0.98] disabled:opacity-50"
              >
                <Zap className="h-5 w-5" /> Lançar Pergunta Agora
              </button>
            ) : (
              <button
                type="button"
                onClick={revealAnswer}
                disabled={busy || session?.question_revealed}
                className="flex min-h-[72px] w-full items-center justify-center gap-2 rounded-2xl bg-[#FFCB05] text-base font-extrabold text-black shadow-lg transition active:scale-[0.98] disabled:opacity-50"
              >
                <Eye className="h-5 w-5" />
                {session?.question_revealed ? "Resposta já revelada" : "Parar e Revelar Resposta"}
              </button>
            )}
          </section>
        )}

        {/* Alternar painel de Classificação no projetor */}
        <button
          type="button"
          onClick={toggleRanking}
          className="flex min-h-[64px] items-center justify-center gap-2 rounded-2xl border border-[#FFCB05]/40 bg-[#FFCB05]/10 text-sm font-bold text-[#FFCB05] transition active:scale-[0.98]"
        >
          <Trophy className="h-5 w-5" />
          {showRankingRemote ? "Ocultar Classificação no Projetor" : "Mostrar Classificação no Projetor"}
        </button>

        <div className="mt-2 grid grid-cols-2 gap-3">
          {/* Reiniciar apresentação */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                className="flex min-h-[64px] items-center justify-center gap-2 rounded-2xl border border-[#262D3D] bg-[#161A23] text-sm font-bold text-[#9CA3AF] transition active:scale-[0.98]"
              >
                <RefreshCw className="h-4 w-4" /> Reiniciar
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent className="border-[#262D3D] bg-[#0E1015] text-white">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-white">Deseja mesmo reiniciar?</AlertDialogTitle>
                <AlertDialogDescription className="text-[#9CA3AF]">
                  Todos os pontos atuais e respostas deste quiz serão apagados. Os participantes voltarão ao Slide 1.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-[#262D3D] bg-transparent text-[#9CA3AF] hover:bg-[#1E2235] hover:text-white">
                  Cancelar
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={restartSession}
                  className="bg-[#A6193C] text-white hover:bg-[#A6193C]/90"
                >
                  Sim, reiniciar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Encerrar apresentação */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                className="flex min-h-[64px] items-center justify-center gap-2 rounded-2xl border border-[#A6193C]/60 bg-[#A6193C]/15 text-sm font-bold text-white transition active:scale-[0.98]"
              >
                <LogOut className="h-4 w-4" /> Encerrar
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent className="border-[#262D3D] bg-[#0E1015] text-white">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-white">Encerrar apresentação?</AlertDialogTitle>
                <AlertDialogDescription className="text-[#9CA3AF]">
                  {presentation.event_id
                    ? "Ainda existem apresentações não exibidas neste evento. Deseja mesmo encerrar e ir para a grande final?"
                    : "Esta ação encerra a sessão e desconecta os celulares dos participantes."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-[#262D3D] bg-transparent text-[#9CA3AF] hover:bg-[#1E2235] hover:text-white">
                  Cancelar
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={endSession}
                  className="bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-white hover:opacity-95"
                >
                  Sim, encerrar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </main>
    </div>
  );
}