import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus, Play, Pencil, FileText, Loader2, Trash2, CalendarPlus, Calendar, Trophy, Home, LogOut, Smartphone, Zap, Radio, Presentation, Gamepad2, ChevronLeft, ChevronRight, QrCode, BarChart3, PanelRight, PowerOff, Eye, EyeOff, Award } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRequireSpeaker } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePresenceMonitor } from "@/hooks/use-presence-monitor";
import { haptic } from "@/hooks/use-haptic";
import { rememberDashboardOrigin } from "@/lib/dashboard-origin";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { toast } from "sonner";
import { OnboardingModal } from "@/components/onboarding-modal";
import { StartModeModal, type StartMode } from "@/components/start-mode-modal";
import { useServerFn } from "@tanstack/react-start";
import { adjustSessionTimeBudget } from "@/lib/ai-script.functions";

/**
 * Abre a apresentação ao vivo em uma janela popup independente — sem barra
 * de navegação, sem abas — para que o palestrante posicione no segundo
 * monitor (projetor) e mantenha o Dashboard aberto na tela principal.
 */
function openPresentationPopup(sessionId: string) {
  if (typeof window === "undefined") return;
  // Abre diretamente a janela do projetor — a máquina de estados
  // interna controla o lobby (QR do Controle Remoto → QR dos
  // Participantes → Slides) sem rotas intermediárias.
  const url = `/present/${sessionId}`;
  const scr: any = window.screen || {};
  const width = scr.width || 1280;
  const height = scr.height || 800;
  // Heurística multimonitor: se o navegador expõe availLeft positivo
  // (ou se a área disponível for maior que a tela principal), tentamos
  // posicionar a popup no monitor lateral.
  const availLeft = typeof scr.availLeft === "number" ? scr.availLeft : 0;
  const left = availLeft > 0 ? availLeft : width;
  const top = 0;
  const features = [
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    "popup=yes",
    "menubar=no",
    "toolbar=no",
    "location=no",
    "status=no",
    "resizable=yes",
  ].join(",");
  const win = window.open(url, `ApresentacaoLive-${sessionId}`, features);
  if (!win) {
    toast.error("Permita pop-ups deste site para abrir a apresentação em nova janela.");
    return;
  }
  win.focus();
}

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Meus Quizzes — QuizBini" }] }),
  component: Dashboard,
});

function Dashboard() {
  const navigate = useNavigate();
  const { user } = useRequireSpeaker();
  const userId = user?.id;
  const isMobile = useIsMobile();
  const [startModalId, setStartModalId] = useState<string | null>(null);

  /* Mantém heartbeat de pareamento ativo em segundo plano,
     mesmo sem exibir o selo visual no cabeçalho. */
  usePresenceMonitor(userId, "desktop");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["presentations", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("presentations")
        .select("id, title, file_url, created_at, event_id")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: events } = useQuery({
    queryKey: ["events", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("events") as any)
        .select("id, title, created_at")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; title: string; created_at: string }>;
    },
  });

  // Sessões ativas das apresentações deste palestrante (para o Controle Remoto)
  const { data: activeSessions } = useQuery({
    queryKey: ["active-sessions", userId, (data ?? []).map((p) => p.id).join(",")],
    enabled: !!userId && !!data && data.length > 0,
    refetchInterval: 5000,
    queryFn: async () => {
      const ids = (data ?? []).map((p) => p.id);
      if (ids.length === 0) return [] as Array<{ id: string; presentation_id: string; status: string }>;
      const { data: rows, error } = await supabase
        .from("sessions")
        .select("id, presentation_id, status, updated_at")
        .in("presentation_id", ids)
        .neq("status", "ended")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (rows ?? []) as Array<{ id: string; presentation_id: string; status: string }>;
    },
  });
  const activeSession = activeSessions && activeSessions.length > 0 ? activeSessions[0] : null;
  const activePresentationTitle = activeSession
    ? (data ?? []).find((p) => p.id === activeSession.presentation_id)?.title
    : null;

  function startSession(presentationId: string) {
    setStartModalId(presentationId);
  }

  const adjustBudgetFn = useServerFn(adjustSessionTimeBudget);

  async function launchSession(
    presentationId: string,
    mode: StartMode,
    opts?: { totalMinutes?: number },
  ) {
    rememberDashboardOrigin();
    if (mode === "ai") {
      // Sincroniza o modo configurado da apresentação para que o
      // componente do projetor (que lê presenter_mode) ative a IA.
      const presUpdate: Record<string, unknown> = { presenter_mode: "ai" };
      if (opts?.totalMinutes && opts.totalMinutes > 0) {
        presUpdate.total_duration_minutes = opts.totalMinutes;
      }
      await (supabase.from("presentations") as any)
        .update(presUpdate)
        .eq("id", presentationId);
    } else {
      await (supabase.from("presentations") as any)
        .update({ presenter_mode: "human" })
        .eq("id", presentationId);
    }
    // Lê o tempo total alvo (ajustado ou padrão) para gravar na sessão
    const { data: presRow } = await (supabase.from("presentations") as any)
      .select("total_duration_minutes")
      .eq("id", presentationId)
      .maybeSingle();
    const totalMin =
      opts?.totalMinutes && opts.totalMinutes > 0
        ? opts.totalMinutes
        : Number((presRow as any)?.total_duration_minutes ?? 0);
    const budgetSec = totalMin > 0 ? Math.round(totalMin * 60) : null;
    const { data: session, error } = await supabase
      .from("sessions")
      .insert({
        presentation_id: presentationId,
        status: "lobby",
        current_slide: 1,
        mode,
        started_at: new Date().toISOString(),
        time_budget_seconds: budgetSec,
        time_used_seconds: 0,
        // Estado de abertura: somente QR do Controle Remoto.
        // Lobby de participantes e classificação ficam ocultos até a
        // máquina de estados do projetor liberar cada etapa.
        show_pair_qr: true,
        show_join_qr: false,
        show_ranking: false,
      } as any)
      .select("id")
      .single();
    if (error) {
      toast.error("Não foi possível iniciar a sessão");
      return;
    }
    // Em modo IA, se o tempo foi ajustado para menor que o original,
    // já dispara a reescrita do roteiro para caber no novo tempo.
    if (mode === "ai" && opts?.totalMinutes && opts.totalMinutes > 0) {
      try {
        await adjustBudgetFn({
          data: {
            sessionId: session.id,
            totalMinutes: opts.totalMinutes,
            rewrite: opts.totalMinutes !== Number(presRow?.total_duration_minutes ?? 0),
          },
        });
      } catch (e: any) {
        toast.error(e?.message || "Falha ao ajustar tempo do roteiro");
      }
    }
    setStartModalId(null);
    openPresentationPopup(session.id);
  }

  async function deletePresentation(presentationId: string) {
    const { data: sessionsList } = await supabase
      .from("sessions")
      .select("id")
      .eq("presentation_id", presentationId);
    const sessionIds = (sessionsList ?? []).map((s) => s.id);
    if (sessionIds.length > 0) {
      await supabase.from("answers").delete().in("session_id", sessionIds);
      await supabase.from("participants").delete().in("session_id", sessionIds);
      await supabase.from("sessions").delete().in("id", sessionIds);
    }
    await supabase.from("questions").delete().eq("presentation_id", presentationId);
    const { error } = await supabase.from("presentations").delete().eq("id", presentationId);
    if (error) {
      toast.error("Não foi possível excluir o quiz");
      return;
    }
    toast.success("Quiz excluído");
    refetch();
  }

  // === LAYOUT MÓVEL: foco absoluto no Controle Remoto ===
  if (isMobile) {
    const heroTitle = activeSession ? "Apresentação Pronta" : "Gerenciamento Ativo";
    const heroSubtitle = activeSession
      ? activePresentationTitle || "Sessão em andamento — assuma o controle agora."
      : "Toque para parear seu celular com a tela do projetor.";
    return (
      <div className="min-h-[100dvh] bg-[#0E1015] text-white">
        <StartModeModal
          presentationId={startModalId}
          open={!!startModalId}
          onOpenChange={(v) => !v && setStartModalId(null)}
          onConfirm={(mode, opts) =>
            startModalId && launchSession(startModalId, mode, opts)
          }
        />
        <header className="sticky top-0 z-10 border-b border-[#262D3D] bg-[#131722]/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#F68B1F]">
                <Smartphone className="h-3 w-3" /> Painel do Palestrante
              </p>
              <h1 className="mt-0.5 truncate text-base font-bold">
                {user?.user_metadata?.full_name || user?.email || "Palestrante"}
              </h1>
            </div>
            <button
              type="button"
              onClick={async () => {
                await supabase.auth.signOut();
                toast.success("Você saiu da sua conta.");
                navigate({ to: "/", replace: true });
              }}
              className="rounded-lg p-2 text-[#9CA3AF] hover:bg-[#1E2235] hover:text-[#F68B1F]"
              aria-label="Sair"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </header>

        <main className="space-y-5 p-4 pb-12">
          {/* HERO — Iniciar Controle Remoto */}
          <section className="rounded-3xl border border-[#A6193C]/40 bg-gradient-to-br from-[#1A0E14] via-[#131722] to-[#1A140E] p-5 shadow-2xl shadow-[#A6193C]/20">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-[#07A684]" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#FFCB05]">
                {heroTitle}
              </p>
            </div>
            <h2 className="mt-2 text-2xl font-black leading-tight text-white">
              Comande sua apresentação ao vivo
            </h2>
            <p className="mt-1.5 line-clamp-2 text-xs text-[#9CA3AF]">
              {heroSubtitle}
            </p>

            {activeSession ? (
              <Link
                to="/remote/$id"
                params={{ id: activeSession.id }}
                onClick={() => haptic(40)}
                className="mt-4 flex min-h-[64px] w-full items-center justify-center gap-3 rounded-2xl border-0 bg-gradient-to-r from-[#A6193C] to-[#F68B1F] px-4 text-base font-black uppercase tracking-wide text-white shadow-xl shadow-[#A6193C]/40 transition-all duration-100 active:scale-[0.97] active:from-[#8E1432] active:to-[#D87412]"
              >
                <Zap className="h-6 w-6 drop-shadow" strokeWidth={2.5} />
                <span className="leading-tight">Iniciar Controle Remoto</span>
                <Smartphone className="h-5 w-5 opacity-90" />
              </Link>
            ) : (
              <Link
                to="/remote"
                onClick={() => haptic(40)}
                className="mt-4 flex min-h-[64px] w-full items-center justify-center gap-3 rounded-2xl border-0 bg-gradient-to-r from-[#A6193C] to-[#F68B1F] px-4 text-base font-black uppercase tracking-wide text-white shadow-xl shadow-[#A6193C]/40 transition-all duration-100 active:scale-[0.97] active:from-[#8E1432] active:to-[#D87412]"
              >
                <Zap className="h-6 w-6 drop-shadow" strokeWidth={2.5} />
                <span className="leading-tight">Iniciar Controle Remoto</span>
                <Smartphone className="h-5 w-5 opacity-90" />
              </Link>
            )}

            {activeSession && (
              <p className="mt-3 text-center text-[10px] font-semibold uppercase tracking-wider text-[#07A684]">
                🟢 Sessão ativa detectada — entrada direta
              </p>
            )}
          </section>

          {/* EVENTOS — compacto */}
          {events && events.length > 0 && (
            <section>
              <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#9CA3AF]">
                Eventos
              </h3>
              <div className="space-y-2">
                {events.map((ev) => (
                  <Link
                    key={ev.id}
                    to="/event/$id"
                    params={{ id: ev.id }}
                    className="flex items-center justify-between rounded-xl border border-[#262D3D] bg-[#161A23] p-3 active:scale-[0.98]"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Calendar className="h-4 w-4 shrink-0 text-[#F68B1F]" />
                      <span className="truncate text-sm font-semibold">{ev.title}</span>
                    </div>
                    <Trophy className="h-4 w-4 text-[#FFCB05]" />
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* APRESENTAÇÕES — compacto */}
          <section>
            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#9CA3AF]">
              Apresentações
            </h3>
            {isLoading ? (
              <div className="flex items-center gap-2 text-xs text-[#9CA3AF]">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
              </div>
            ) : !data || data.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#262D3D] bg-[#131722] p-6 text-center">
                <FileText className="mx-auto h-8 w-8 text-[#9CA3AF]" />
                <p className="mt-2 text-xs text-[#9CA3AF]">
                  Nenhum quiz criado ainda. Use o computador para enviar arquivos PDF.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {data.map((p) => {
                  const isActive = activeSession?.presentation_id === p.id;
                  return (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-xl border border-[#262D3D] bg-[#161A23] p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{p.title}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#9CA3AF]">
                          <Radio className="h-3 w-3" />
                          {isActive ? (
                            <span className="text-[#07A684]">🟢 ao vivo</span>
                          ) : (
                            <span>pronta para iniciar</span>
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          haptic(30);
                          startSession(p.id);
                        }}
                        className="ml-2 flex h-10 shrink-0 items-center gap-1 rounded-lg bg-gradient-to-r from-[#A6193C] to-[#F68B1F] px-3 text-xs font-bold text-white active:scale-95"
                      >
                        <Play className="h-4 w-4" /> Iniciar
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* RODAPÉ — dica de uso */}
          <p className="rounded-xl border border-[#262D3D] bg-[#131722] p-3 text-center text-[11px] leading-relaxed text-[#9CA3AF]">
            💡 <span className="font-semibold text-[#FFCB05]">Dica:</span> Para criar novos
            Quizzes com Inteligência Artificial ou editar perguntas detalhadamente,
            recomendamos utilizar a tela do seu computador.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {user && <OnboardingModal user={user} />}
      <StartModeModal
        presentationId={startModalId}
        open={!!startModalId}
        onOpenChange={(v) => !v && setStartModalId(null)}
        onConfirm={(mode, opts) =>
          startModalId && launchSession(startModalId, mode, opts)
        }
      />
      <header className="border-b border-border bg-card/50">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              QuizBini <span className="text-primary">·</span> Meus Quizzes
            </h1>
            <p className="text-sm text-muted-foreground">{user?.user_metadata?.full_name || user?.email || "Palestrante"}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              asChild
              variant="ghost"
              size="icon"
              title="Ir para a página inicial"
              className="text-[#9CA3AF] hover:bg-[#1E2235] hover:text-[#F68B1F]"
            >
              <Link to="/">
                <Home className="h-5 w-5" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/event/new">
                <CalendarPlus className="mr-2 h-5 w-5" /> Novo Evento
              </Link>
            </Button>
            <Button asChild size="lg">
              <Link to="/quiz/new">
                <Plus className="mr-2 h-5 w-5" /> Novo Quiz
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" title="Currículo de participações" className="whitespace-nowrap">
              <Link to="/meu-historico">
                <Award className="mr-2 h-5 w-5 shrink-0" /> <span>Currículo</span>
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Sair"
              onClick={async () => {
                await supabase.auth.signOut();
                toast.success("Você saiu da sua conta.");
                navigate({ to: "/", replace: true });
              }}
              className="text-[#9CA3AF] hover:bg-[#1E2235] hover:text-[#F68B1F]"
            >
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        <Tabs defaultValue="apresentacoes" className="w-full">
          <TabsList className="mb-6 grid w-full grid-cols-2 gap-1 bg-[#161A23] p-1 md:grid-cols-4">
            <TabsTrigger
              value="apresentacoes"
              className="data-[state=active]:bg-[#F68B1F] data-[state=active]:text-white"
            >
              <Presentation className="mr-2 h-4 w-4" /> Apresentações
            </TabsTrigger>
            <TabsTrigger
              value="eventos"
              className="data-[state=active]:bg-[#F68B1F] data-[state=active]:text-white"
            >
              <Calendar className="mr-2 h-4 w-4" /> Eventos
            </TabsTrigger>
            <TabsTrigger
              value="central"
              className="data-[state=active]:bg-[#F68B1F] data-[state=active]:text-white"
            >
              <Gamepad2 className="mr-2 h-4 w-4" /> Central de Controle
            </TabsTrigger>
            <TabsTrigger
              value="classificacao"
              className="data-[state=active]:bg-[#F68B1F] data-[state=active]:text-white"
            >
              <Trophy className="mr-2 h-4 w-4" /> Classificação
            </TabsTrigger>
          </TabsList>

          {/* ABA 1 — APRESENTAÇÕES */}
          <TabsContent value="apresentacoes" className="mt-0">
            {isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
              </div>
            ) : !data || data.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card/30 p-12 text-center">
                <FileText className="mx-auto h-12 w-12 text-muted-foreground" />
                <h2 className="mt-4 text-lg font-semibold">Nenhum quiz criado ainda</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Crie seu primeiro quiz para começar.
                </p>
                <Button asChild className="mt-6">
                  <Link to="/quiz/new">
                    <Plus className="mr-2 h-4 w-4" /> Criar primeiro quiz
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {data.map((p) => (
                  <div
                    key={p.id}
                    className="overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/60"
                  >
                    <div className="aspect-video bg-black">
                      <iframe
                        title={p.title}
                        src={`${p.file_url}#page=1&toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                        className="pointer-events-none h-full w-full"
                      />
                    </div>
                    <div className="p-4">
                      <h3 className="line-clamp-1 font-semibold">{p.title}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Criado em {new Date(p.created_at).toLocaleDateString("pt-BR")}
                      </p>
                      <div className="mt-4 flex gap-2">
                        <Button
                          size="sm"
                          className="flex-1"
                          onClick={() => startSession(p.id)}
                        >
                          <Play className="mr-1 h-4 w-4" /> Iniciar
                        </Button>
                        <Button asChild size="sm" variant="outline">
                          <Link to="/quiz/$id/edit" params={{ id: p.id }}>
                            <Pencil className="h-4 w-4" />
                          </Link>
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="outline" className="text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir quiz?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Esta ação não pode ser desfeita. O quiz "{p.title}", suas perguntas
                                e sessões associadas serão removidos permanentemente.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deletePresentation(p.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Excluir
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ABA 2 — EVENTOS */}
          <TabsContent value="eventos" className="mt-0">
            {!events || events.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card/30 p-12 text-center">
                <Calendar className="mx-auto h-12 w-12 text-muted-foreground" />
                <h2 className="mt-4 text-lg font-semibold">Nenhum evento ainda</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Agrupe múltiplas apresentações em um evento.
                </p>
                <Button asChild className="mt-6">
                  <Link to="/event/new">
                    <CalendarPlus className="mr-2 h-4 w-4" /> Criar primeiro evento
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {events.map((ev) => (
                  <div
                    key={ev.id}
                    className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/60"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <Calendar className="h-5 w-5 shrink-0 text-primary" />
                        <div className="min-w-0">
                          <h3 className="truncate font-semibold">{ev.title}</h3>
                          <p className="text-xs text-muted-foreground">
                            {new Date(ev.created_at).toLocaleDateString("pt-BR")}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button asChild size="sm" variant="ghost" title="Grande Pódio">
                          <Link to="/event/$id/podium" params={{ id: ev.id }}>
                            <Trophy className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button asChild size="sm" variant="outline">
                          <Link to="/event/$id" params={{ id: ev.id }}>
                            Gerenciar
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ABA 3 — CENTRAL DE CONTROLE (PRO) */}
          <TabsContent value="central" className="mt-0">
            <CentralDeControle
              activeSession={activeSession}
              activePresentationTitle={activePresentationTitle ?? null}
            />
          </TabsContent>

          {/* ABA 4 — CLASSIFICAÇÃO GLOBAL */}
          <TabsContent value="classificacao" className="mt-0">
            <ClassificacaoGlobal presentationIds={(data ?? []).map((p) => p.id)} />
          </TabsContent>
        </Tabs>
      </main>

      {activeSession && (
        <Link
          to="/remote/$id"
          params={{ id: activeSession.id }}
          title="Abrir Controle Remoto da apresentação ativa"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-full border-0 bg-gradient-to-r from-[#A6193C] to-[#F68B1F] px-5 py-3 text-sm font-bold text-white shadow-2xl shadow-[#A6193C]/40 transition hover:scale-[1.03] active:scale-[0.98]"
        >
          <Smartphone className="h-5 w-5" />
          <span className="flex flex-col items-start leading-tight">
            <span>📱 Controle Remoto Ativo</span>
            {activePresentationTitle && (
              <span className="text-[10px] font-normal opacity-90">
                {activePresentationTitle}
              </span>
            )}
          </span>
        </Link>
      )}
    </div>
  );
}

// =============================================================
// CENTRAL DE CONTROLE — versão Pro (desktop) para co-apresentador
// =============================================================
type ActiveSession = { id: string; presentation_id: string; status: string } | null;

function CentralDeControle({
  activeSession,
  activePresentationTitle,
}: {
  activeSession: ActiveSession;
  activePresentationTitle: string | null;
}) {
  const [session, setSession] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!activeSession?.id) {
      setSession(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("sessions")
        .select("*")
        .eq("id", activeSession.id)
        .single();
      if (!cancelled) setSession(data);
    })();
    const ch = supabase
      .channel(`central-${activeSession.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sessions", filter: `id=eq.${activeSession.id}` },
        (payload) => setSession(payload.new),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [activeSession?.id]);

  if (!activeSession) {
    return (
      <div className="rounded-2xl border border-dashed border-[#262D3D] bg-[#161A23] p-12 text-center">
        <Gamepad2 className="mx-auto h-12 w-12 text-[#9CA3AF]" />
        <h2 className="mt-4 text-lg font-semibold">Nenhuma apresentação ao vivo</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Inicie uma apresentação na aba <span className="font-semibold text-[#F68B1F]">Apresentações</span> para
          assumir o controle de palco a partir desta tela.
        </p>
      </div>
    );
  }

  async function patch(p: Record<string, any>) {
    if (!activeSession) return;
    setBusy(true);
    try {
      const { error } = await (supabase.from("sessions") as any).update(p).eq("id", activeSession.id);
      if (error) toast.error("Falha ao atualizar a sessão.");
    } finally {
      setBusy(false);
    }
  }

  async function nextSlide() {
    if (!session) return;
    await patch({
      current_slide: (session.current_slide ?? 1) + 1,
      question_revealed: false,
      active_question_id: null,
      question_started_at: null,
    });
  }

  async function prevSlide() {
    if (!session) return;
    await patch({
      current_slide: Math.max(1, (session.current_slide ?? 1) - 1),
      question_revealed: false,
      active_question_id: null,
      question_started_at: null,
    });
  }

  async function endSession() {
    await patch({
      status: "ended",
      active_question_id: null,
      question_started_at: null,
      question_revealed: false,
    });
    toast.success("Apresentação encerrada.");
  }

  const showRanking = !!session?.show_ranking;
  const showJoinQr = !!session?.show_join_qr;
  const showPairQr = !!session?.show_pair_qr;
  const showSidebar = !!session?.show_sidebar;

  return (
    <div className="space-y-5">
      {/* Cabeçalho de status */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#262D3D] bg-[#161A23] p-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#07A684]">
            <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-[#07A684]" /> Sessão ao vivo
          </p>
          <h2 className="mt-1 truncate text-lg font-bold text-white">
            {activePresentationTitle || "Apresentação em andamento"}
          </h2>
          <p className="mt-0.5 text-xs text-[#9CA3AF]">
            Slide atual: <span className="font-semibold text-white">{session?.current_slide ?? "—"}</span>
            {" · "}Status: <span className="font-semibold text-[#FFCB05]">{session?.status ?? "—"}</span>
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/remote/$id" params={{ id: activeSession.id }}>
            <Smartphone className="mr-2 h-4 w-4" /> Abrir no celular
          </Link>
        </Button>
      </div>

      {/* Navegação Avançar / Voltar */}
      <div className="grid gap-3 md:grid-cols-2">
        <Button
          size="lg"
          variant="outline"
          disabled={busy || (session?.current_slide ?? 1) <= 1}
          onClick={prevSlide}
          className="h-20 rounded-2xl border-[#262D3D] bg-[#1E2235] text-base font-bold uppercase tracking-wide text-gray-200 hover:bg-[#262D3D]"
        >
          <ChevronLeft className="mr-2 h-6 w-6" /> Voltar
        </Button>
        <Button
          size="lg"
          disabled={busy}
          onClick={nextSlide}
          className="h-20 rounded-2xl border-0 bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-base font-black uppercase tracking-wide text-white shadow-lg shadow-orange-500/20 hover:opacity-95"
        >
          Avançar <ChevronRight className="ml-2 h-6 w-6" />
        </Button>
      </div>

      {/* Toggles de overlays */}
      <div className="rounded-2xl border border-[#262D3D] bg-[#161A23] p-4">
        <h3 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-[#9CA3AF]">
          Overlays na tela do projetor
        </h3>
        <div className="grid gap-3 md:grid-cols-2">
          <ToggleBtn
            active={showRanking}
            onClick={() => patch({ show_ranking: !showRanking })}
            icon={<BarChart3 className="h-5 w-5" />}
            labelOn="Ocultar Classificação"
            labelOff="Mostrar Classificação"
            disabled={busy}
          />
          <ToggleBtn
            active={showJoinQr}
            onClick={() => patch({ show_join_qr: !showJoinQr })}
            icon={<QrCode className="h-5 w-5" />}
            labelOn="Ocultar QR de Participantes"
            labelOff="Mostrar QR de Participantes"
            disabled={busy}
          />
          <ToggleBtn
            active={showPairQr}
            onClick={() => patch({ show_pair_qr: !showPairQr })}
            icon={<Smartphone className="h-5 w-5" />}
            labelOn="Ocultar QR de Controle"
            labelOff="Mostrar QR de Controle"
            disabled={busy}
          />
          <ToggleBtn
            active={showSidebar}
            onClick={() => patch({ show_sidebar: !showSidebar })}
            icon={<PanelRight className="h-5 w-5" />}
            labelOn="Ocultar Barra Lateral"
            labelOff="Mostrar Barra Lateral"
            disabled={busy}
          />
        </div>
      </div>

      {/* Encerrar sessão */}
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={endSession}
          disabled={busy}
          className="border-[#A6193C]/40 text-[#F68B1F] hover:bg-[#A6193C]/10 hover:text-white"
        >
          <PowerOff className="mr-2 h-4 w-4" /> Encerrar apresentação
        </Button>
      </div>
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  icon,
  labelOn,
  labelOff,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  labelOn: string;
  labelOff: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-14 w-full items-center justify-between gap-3 rounded-xl border px-4 text-left text-sm font-bold transition-all duration-100 active:scale-[0.98] disabled:opacity-50 ${
        active
          ? "border-[#A6193C] bg-[#A6193C]/15 text-white shadow-[0_0_18px_-6px_rgba(166,25,60,0.6)]"
          : "border-[#262D3D] bg-[#1E2235] text-gray-200 hover:border-[#3A4255]"
      }`}
    >
      <span className="flex items-center gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            active ? "bg-[#A6193C]/30 text-white" : "bg-[#0E1015] text-[#F68B1F]"
          }`}
        >
          {icon}
        </span>
        <span>{active ? labelOn : labelOff}</span>
      </span>
      <span className="shrink-0">
        {active ? (
          <Eye className="h-4 w-4 text-[#07A684]" />
        ) : (
          <EyeOff className="h-4 w-4 text-[#9CA3AF]" />
        )}
      </span>
    </button>
  );
}

// =============================================================
// CLASSIFICAÇÃO GLOBAL — pontuação acumulada de todos os usuários
// =============================================================
function ClassificacaoGlobal({ presentationIds }: { presentationIds: string[] }) {
  const { data, isLoading } = useQuery({
    queryKey: ["global-ranking", presentationIds.join(",")],
    enabled: presentationIds.length > 0,
    queryFn: async () => {
      const { data: sess } = await supabase
        .from("sessions")
        .select("id")
        .in("presentation_id", presentationIds);
      const sessionIds = (sess ?? []).map((s: any) => s.id);
      if (sessionIds.length === 0) return [];
      const { data: parts } = await supabase
        .from("participants")
        .select("name, birth_date, score, correct_count, answer_count")
        .in("session_id", sessionIds);
      const map = new Map<string, { name: string; score: number; correct: number; answers: number }>();
      for (const p of (parts ?? []) as any[]) {
        const key = `${(p.name || "").trim().toLowerCase()}|${p.birth_date ?? ""}`;
        const prev = map.get(key) ?? { name: p.name, score: 0, correct: 0, answers: 0 };
        prev.score += p.score ?? 0;
        prev.correct += p.correct_count ?? 0;
        prev.answers += p.answer_count ?? 0;
        map.set(key, prev);
      }
      return Array.from(map.values()).sort((a, b) => b.score - a.score);
    },
  });

  if (presentationIds.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#262D3D] bg-[#161A23] p-12 text-center">
        <Trophy className="mx-auto h-12 w-12 text-[#9CA3AF]" />
        <h2 className="mt-4 text-lg font-semibold">Sem dados de classificação</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Crie e execute uma apresentação para coletar pontuações dos usuários.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Calculando ranking...
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#262D3D] bg-[#161A23] p-12 text-center">
        <Trophy className="mx-auto h-12 w-12 text-[#9CA3AF]" />
        <h2 className="mt-4 text-lg font-semibold">Nenhum usuário pontuou ainda</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Assim que os participantes responderem perguntas em qualquer apresentação, eles aparecerão aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[#262D3D] bg-[#161A23]">
      <div className="grid grid-cols-[60px_1fr_100px_100px_100px] gap-2 border-b border-[#262D3D] bg-[#0E1015] px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-[#9CA3AF]">
        <span>Pos.</span>
        <span>Usuário</span>
        <span className="text-right">Pontos</span>
        <span className="text-right">Acertos</span>
        <span className="text-right">Respostas</span>
      </div>
      <ul className="divide-y divide-[#262D3D]">
        {data.map((row, idx) => {
          const pos = idx + 1;
          const medal = pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : null;
          return (
            <li
              key={`${row.name}-${idx}`}
              className="grid grid-cols-[60px_1fr_100px_100px_100px] items-center gap-2 px-4 py-3 text-sm transition-colors hover:bg-[#1E2235]"
            >
              <span className="font-bold text-[#F68B1F]">
                {medal ?? pos + "º"}
              </span>
              <span className="truncate font-semibold text-white">{row.name}</span>
              <span className="text-right font-black text-[#FFCB05]">{row.score}</span>
              <span className="text-right text-[#07A684]">{row.correct}</span>
              <span className="text-right text-[#9CA3AF]">{row.answers}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
