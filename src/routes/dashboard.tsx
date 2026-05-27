import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus, Play, Pencil, FileText, Loader2, Trash2, CalendarPlus, Calendar, Trophy, Home, LogOut, Smartphone, Zap, Radio } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRequireSpeaker } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { PairingStatusBadge } from "@/components/pairing-status-badge";
import { haptic } from "@/hooks/use-haptic";
import { Button } from "@/components/ui/button";
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

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Meus Quizzes — QuizPulse" }] }),
  component: Dashboard,
});

function Dashboard() {
  const navigate = useNavigate();
  const { user } = useRequireSpeaker();
  const userId = user?.id;
  const isMobile = useIsMobile();

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

  async function startSession(presentationId: string) {
    const { data: session, error } = await supabase
      .from("sessions")
      .insert({ presentation_id: presentationId, status: "lobby", current_slide: 1 })
      .select("id")
      .single();
    if (error) {
      toast.error("Não foi possível iniciar a sessão");
      return;
    }
    navigate({ to: "/lobby/$id", params: { id: session.id } });
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
    const remoteTarget = activeSession
      ? { to: "/remote/$id" as const, params: { id: activeSession.id } }
      : { to: "/remote" as const, params: undefined };
    const heroTitle = activeSession ? "Apresentação Pronta" : "Gerenciamento Ativo";
    const heroSubtitle = activeSession
      ? activePresentationTitle || "Sessão em andamento — assuma o controle agora."
      : "Toque para parear seu celular com a tela do projetor.";
    return (
      <div className="min-h-[100dvh] bg-[#0E1015] text-white">
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
            <div className="flex items-center gap-2">
              <PairingStatusBadge userId={userId} variant="mobile" compact />
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

            <Link
              {...remoteTarget}
              onClick={() => haptic(40)}
              className="mt-4 flex min-h-[64px] w-full items-center justify-center gap-3 rounded-2xl border-0 bg-gradient-to-r from-[#A6193C] to-[#F68B1F] px-4 text-base font-black uppercase tracking-wide text-white shadow-xl shadow-[#A6193C]/40 transition-all duration-100 active:scale-[0.97] active:from-[#8E1432] active:to-[#D87412]"
            >
              <Zap className="h-6 w-6 drop-shadow" strokeWidth={2.5} />
              <span className="leading-tight">Iniciar Controle Remoto</span>
              <Smartphone className="h-5 w-5 opacity-90" />
            </Link>

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
      <header className="border-b border-border bg-card/50">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              QuizPulse <span className="text-primary">·</span> Meus Quizzes
            </h1>
            <p className="text-sm text-muted-foreground">{user?.user_metadata?.full_name || user?.email || "Palestrante"}</p>
          </div>
          <div className="flex items-center gap-2">
            <PairingStatusBadge userId={userId} variant="desktop" />
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

      <main className="mx-auto max-w-6xl px-6 py-8">
        {events && events.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Eventos
            </h2>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {events.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-center justify-between rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/60"
                >
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
              ))}
            </div>
          </section>
        )}

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
