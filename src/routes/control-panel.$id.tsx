import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Tv,
  Users,
  LayoutDashboard,
  Clock,
  Sparkles,
  Play,
  Pause,
  MessageSquare,
  Mic,
  MicOff,
  CheckCircle2,
  XCircle,
  BarChart3,
  ExternalLink,
  ShieldAlert,
  Smartphone,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRequireSpeaker } from "@/hooks/use-auth";
import { useRemoteBridge } from "@/hooks/use-remote-bridge";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useServerFn } from "@tanstack/react-start";
import { answerAudienceQuestion, updateAudienceQuestionStatus } from "@/lib/ai-script.functions";
import { RemoteAuthorizationPanel } from "@/components/remote-authorization-panel";

export const Route = createFileRoute("/control-panel/$id")({
  head: () => ({ meta: [{ title: "Cockpit do Palestrante — QuizBini" }] }),
  component: ControlPanel,
});

function ControlPanel() {
  const { user } = useRequireSpeaker();
  const { id } = Route.useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState<any>(null);
  const [presentation, setPresentation] = useState<any>(null);
  const [participantsCount, setParticipantsCount] = useState(0);
  const [questions, setQuestions] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);

  const bridge = useRemoteBridge({ sessionId: id, role: "remote" });
  const updateStatusFn = useServerFn(updateAudienceQuestionStatus);
  const answerFn = useServerFn(answerAudienceQuestion);

  useEffect(() => {
    // Check if projector window was likely blocked (heuristic)
    const wasOpened = localStorage.getItem(`projector_opened_${id}`);
    if (!wasOpened) {
      // We don't know for sure, but we can show a hint
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: s } = await supabase.from("sessions").select("*").eq("id", id).single();
      if (cancelled) return;
      setSession(s);
      if (s) {
        const { data: p } = await supabase.from("presentations").select("*").eq("id", s.presentation_id).single();
        if (!cancelled) setPresentation(p);
      }
      
      const { count } = await supabase
        .from("participants")
        .select("id", { count: "exact", head: true })
        .eq("session_id", id);
      if (!cancelled) setParticipantsCount(count ?? 0);

      const { data: qs } = await (((supabase as any).from("audience_questions"))
        .select("*")
        .eq("session_id", id)
        .order("created_at", { ascending: false }));
      if (!cancelled) setQuestions(qs ?? []);
    }

    load();

    const ch = supabase
      .channel(`control-${id}`)
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
        { event: "*", schema: "public", table: "audience_questions", filter: `session_id=eq.${id}` } as any,
        async () => {
          const { data: qs } = await (((supabase as any).from("audience_questions"))
            .select("*")
            .eq("session_id", id)
            .order("created_at", { ascending: false }));
          setQuestions(qs ?? []);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [id]);

  async function togglePause() {
    if (busy) return;
    setBusy(true);
    try {
      const isPausing = !session.is_paused;
      const now = new Date();
      const patch: any = { is_paused: isPausing };
      if (isPausing) {
        const lastResume = session.last_resume_at ? new Date(session.last_resume_at) : new Date(session.started_at);
        const elapsed = Math.floor((now.getTime() - lastResume.getTime()) / 1000);
        patch.time_used_seconds = (session.time_used_seconds || 0) + elapsed;
      } else {
        patch.last_resume_at = now.toISOString();
      }
      await supabase.from("sessions").update(patch).eq("id", id);
    } finally {
      setBusy(false);
    }
  }

  async function advance() {
    await bridge.send("NEXT");
  }

  async function back() {
    await bridge.send("PREV");
  }

  async function toggleMic() {
    const next = !session.mic_enabled;
    await (supabase.from("sessions") as any).update({ mic_enabled: next }).eq("id", id);
    toast.success(next ? "Microfone da plateia aberto" : "Microfone da plateia fechado");
  }

  async function handleQuestionStatus(qId: string, status: any) {
    try {
      await updateStatusFn({ data: { questionId: qId, status } });
      if (status === "approved" && session.mode === "ai") {
        toast.info("Pergunta aprovada. A IA responderá em breve.");
        // Opcional: chamar answerAudienceQuestion imediatamente se quiser
        await answerFn({ data: { sessionId: id, questionId: qId } });
      }
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  if (!session || !presentation) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0E1015] text-white">
        <Loader2 className="mr-2 h-6 w-6 animate-spin text-primary" />
        Carregando cockpit...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0E1015] text-white font-sans selection:bg-primary/30">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-[#262D3D] bg-[#131722]/80 px-6 py-3 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/dashboard"
              className="group flex h-10 w-10 items-center justify-center rounded-xl border border-[#262D3D] bg-[#1A1F2B] transition-all hover:border-primary/50 hover:bg-primary/10"
            >
              <LayoutDashboard className="h-5 w-5 text-[#9CA3AF] transition-colors group-hover:text-primary" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-500">Sessão em Tempo Real</p>
              </div>
              <h1 className="text-lg font-black tracking-tight">{presentation.title}</h1>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#9CA3AF]">Status da IA</p>
              <div className="flex items-center gap-1.5 justify-end">
                <Sparkles className={`h-3 w-3 ${session.mode === 'ai' ? 'text-primary' : 'text-[#3A4255]'}`} />
                <span className={`text-xs font-bold ${session.mode === 'ai' ? 'text-white' : 'text-[#3A4255]'}`}>
                  {session.mode === 'ai' ? 'ATIVA' : 'DESATIVADA'}
                </span>
              </div>
            </div>
            <div className="h-8 w-px bg-[#262D3D]" />
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-primary" />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#9CA3AF]">Plateia</p>
                <p className="text-sm font-black">{participantsCount} <span className="text-[10px] font-normal text-[#9CA3AF]">CONECTADOS</span></p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          
          {/* Coluna Esquerda: Mirror & Controls */}
          <div className="space-y-6 lg:col-span-7">
            
            {/* Mirror View */}
            <div className="group relative overflow-hidden rounded-3xl border border-[#262D3D] bg-[#131722] shadow-2xl">
              <div className="flex items-center justify-between border-b border-[#262D3D] bg-[#1A1F2B]/50 px-5 py-3">
                <div className="flex items-center gap-2">
                  <Tv className="h-4 w-4 text-primary" />
                  <span className="text-xs font-bold uppercase tracking-widest">Visão Espelhada (Público)</span>
                </div>
                <div className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-black text-primary uppercase">Slide {session.current_slide}</div>
              </div>
              <div className="aspect-video w-full bg-black">
                <iframe
                  src={`${presentation.file_url}#page=${session.current_slide}&toolbar=0&navpanes=0&scrollbar=0&view=Fit`}
                  className="h-full w-full border-none pointer-events-none"
                  scrolling="no"
                />
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
            </div>

            {/* Execution Controls */}
            <div className="rounded-3xl border border-[#262D3D] bg-[#131722] p-6 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  <button
                    onClick={back}
                    className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#262D3D] bg-[#1A1F2B] transition-all hover:bg-[#262D3D] active:scale-95"
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </button>
                  <button
                    onClick={advance}
                    className="flex h-14 w-48 items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-primary to-[#D946EF] font-black uppercase tracking-wider text-white shadow-lg shadow-primary/20 transition-all hover:opacity-90 active:scale-95"
                  >
                    Avançar <ChevronRight className="h-5 w-5" strokeWidth={3} />
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={togglePause}
                    className={`flex h-14 items-center gap-3 rounded-2xl border-2 px-6 font-black uppercase tracking-widest transition-all active:scale-95 ${
                      session.is_paused 
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20' 
                        : 'border-amber-500/50 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                    }`}
                  >
                    {session.is_paused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
                    {session.is_paused ? 'Continuar' : 'Pausar'}
                  </button>
                </div>

                <div className="flex items-center gap-3 rounded-2xl border border-[#262D3D] bg-[#0E1015] px-5 py-3 shadow-inner">
                  <Clock className={`h-5 w-5 ${session.is_paused ? 'text-[#3A4255]' : 'text-primary animate-pulse'}`} />
                  <div className="text-right">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[#9CA3AF]">Tempo Restante</p>
                    <p className={`text-2xl font-black tabular-nums ${session.is_paused ? 'text-[#3A4255]' : 'text-white'}`}>
                      {(() => {
                        const budget = session.time_budget_seconds || 0;
                        const used = session.time_used_seconds || 0;
                        let elapsedSinceResume = 0;
                        if (!session.is_paused && session.last_resume_at) {
                          elapsedSinceResume = Math.floor((Date.now() - new Date(session.last_resume_at).getTime()) / 1000);
                        }
                        const rem = Math.max(0, budget - (used + elapsedSinceResume));
                        const mm = Math.floor(rem / 60).toString().padStart(2, "0");
                        const ss = (rem % 60).toString().padStart(2, "0");
                        return `${mm}:${ss}`;
                      })()}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Remote Control Management */}
            <div className="lg:col-span-7">
              <RemoteAuthorizationPanel sessionId={id} />
            </div>

            {/* Status & Help */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="flex items-center gap-4 rounded-2xl border border-primary/20 bg-primary/5 p-4">
                <div className="rounded-xl bg-primary/10 p-3">
                  <ShieldAlert className="h-6 w-6 text-primary" />
                </div>
                <div className="text-xs">
                  <p className="font-bold text-white">Janela de Projeção Ativa</p>
                  <p className="text-[#9CA3AF]">Arraste a outra janela para o telão e mantenha este painel no monitor principal.</p>
                </div>
              </div>
              <div className="flex items-center gap-4 rounded-2xl border border-[#262D3D] bg-[#161A23] p-4">
                <div className="rounded-xl bg-[#0E1015] p-3">
                  <Smartphone className="h-6 w-6 text-[#9CA3AF]" />
                </div>
                <div className="text-xs">
                  <p className="font-bold text-white">Pareamento Remoto</p>
                  <p className="text-[#9CA3AF]">Você também pode controlar via celular escaneando o QR Code na tela principal.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Coluna Direita: Audience Questions & Status Panel */}
          <div className="space-y-6 lg:col-span-5">
            
            {/* Status Panel */}
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-3xl border border-[#262D3D] bg-[#131722] p-5">
                <div className="mb-3 flex items-center justify-between">
                  <Sparkles className={`h-5 w-5 ${session.mode === 'ai' ? 'text-primary' : 'text-[#3A4255]'}`} />
                  <div className={`h-2 w-2 rounded-full ${session.mode === 'ai' ? 'bg-primary' : 'bg-[#3A4255]'}`} />
                </div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#9CA3AF]">Motor de IA</p>
                <p className="text-lg font-black">{session.mode === 'ai' ? 'Ativo' : 'Manual'}</p>
              </div>
              <button
                onClick={toggleMic}
                className={`rounded-3xl border p-5 text-left transition-all active:scale-95 ${
                  session.mic_enabled 
                    ? 'border-primary/30 bg-primary/5' 
                    : 'border-[#262D3D] bg-[#131722]'
                }`}
              >
                <div className="mb-3 flex items-center justify-between">
                  {session.mic_enabled ? <Mic className="h-5 w-5 text-primary" /> : <MicOff className="h-5 w-5 text-[#9CA3AF]" />}
                  <div className={`h-2 w-2 rounded-full ${session.mic_enabled ? 'bg-primary' : 'bg-red-500'}`} />
                </div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#9CA3AF]">Microfone Plateia</p>
                <p className="text-lg font-black">{session.mic_enabled ? 'Aberto' : 'Fechado'}</p>
              </button>
            </div>

            {/* Questions Screening */}
            <div className="flex flex-1 flex-col overflow-hidden rounded-3xl border border-[#262D3D] bg-[#131722] shadow-xl">
              <div className="flex items-center justify-between border-b border-[#262D3D] bg-[#1A1F2B]/50 px-5 py-4">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-[#9CA3AF]" />
                  <span className="text-xs font-bold uppercase tracking-widest">Triagem de Perguntas</span>
                </div>
                <div className="rounded-full bg-[#0E1015] px-2 py-1 text-[10px] font-bold text-[#9CA3AF] uppercase">
                  {questions.filter(q => q.status === 'pending').length} Pendentes
                </div>
              </div>

              <div className="max-h-[500px] space-y-3 overflow-y-auto p-4 custom-scrollbar">
                {questions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="mb-4 rounded-full bg-[#1A1F2B] p-4">
                      <MessageSquare className="h-8 w-8 text-[#262D3D]" />
                    </div>
                    <p className="text-sm font-bold text-[#3A4255]">Nenhuma pergunta recebida</p>
                    <p className="mt-1 text-xs text-[#262D3D]">As perguntas da plateia aparecerão aqui para triagem.</p>
                  </div>
                ) : (
                  questions.map((q) => (
                    <div
                      key={q.id}
                      className={`group relative rounded-2xl border p-4 transition-all ${
                        q.status === 'approved' 
                          ? 'border-emerald-500/20 bg-emerald-500/5' 
                          : q.status === 'ignored'
                          ? 'border-red-500/10 bg-red-500/5 opacity-50'
                          : q.status === 'answered'
                          ? 'border-primary/20 bg-primary/5'
                          : 'border-[#262D3D] bg-[#1A1F2B] hover:border-[#3A4255]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm leading-relaxed">{q.question_text}</p>
                        <div className="flex flex-col gap-2">
                          {q.status === 'pending' && (
                            <>
                              <button
                                onClick={() => handleQuestionStatus(q.id, 'approved')}
                                className="rounded-lg bg-emerald-500/20 p-2 text-emerald-500 hover:bg-emerald-500 hover:text-white transition-colors"
                                title="Aprovar"
                              >
                                <CheckCircle2 className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleQuestionStatus(q.id, 'ignored')}
                                className="rounded-lg bg-red-500/20 p-2 text-red-500 hover:bg-red-500 hover:text-white transition-colors"
                                title="Ignorar"
                              >
                                <XCircle className="h-4 w-4" />
                              </button>
                            </>
                          )}
                          {q.status === 'approved' && (
                            <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[9px] font-bold text-emerald-500 uppercase">Aprovada</span>
                          )}
                          {q.status === 'answered' && (
                            <span className="rounded-full bg-primary/10 px-2 py-1 text-[9px] font-bold text-primary uppercase">Respondida</span>
                          )}
                        </div>
                      </div>
                      <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-[#3A4255]">
                        {new Date(q.created_at).toLocaleTimeString()}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        </div>
      </main>

      {/* Popup Blocked Notification */}
      {popupBlocked && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-6">
          <div className="max-w-md rounded-3xl border border-red-500/30 bg-[#131722] p-8 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
              <ShieldAlert className="h-8 w-8 text-red-500" />
            </div>
            <h2 className="text-xl font-black text-white">Navegador bloqueou a Projeção</h2>
            <p className="mt-2 text-sm text-[#9CA3AF]">
              Para que a automação funcione em duas telas, você precisa permitir que este site abra pop-ups.
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <Button 
                onClick={() => window.location.reload()}
                className="bg-primary hover:bg-primary/90"
              >
                Recarregar e Tentar Novamente
              </Button>
              <button 
                onClick={() => setPopupBlocked(false)}
                className="text-xs font-bold text-[#3A4255] hover:text-white transition-colors"
              >
                Entendi, fechar aviso
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
