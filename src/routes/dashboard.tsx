import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus, Play, Pencil, FileText, Loader2, Trash2, CalendarPlus, Calendar, Trophy, Home, LogOut, Smartphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRequireSpeaker } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { PairingStatusBadge } from "@/components/pairing-status-badge";
import { useEffect } from "react";
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
  const { partnerOnline: phonePaired } = usePairingPresence(userId, "desktop");
  const [pairOpen, setPairOpen] = useState(false);
  const [pairUrl, setPairUrl] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setPairUrl(`${window.location.origin}/remote`);
    }
  }, []);

  // Fecha o modal automaticamente quando o celular parear.
  useEffect(() => {
    if (phonePaired && pairOpen) {
      const t = window.setTimeout(() => setPairOpen(false), 1200);
      return () => window.clearTimeout(t);
    }
  }, [phonePaired, pairOpen]);

  // Em celular, palestrante logado vai direto ao controle remoto
  useEffect(() => {
    if (isMobile && userId) {
      navigate({ to: "/remote", replace: true });
    }
  }, [isMobile, userId, navigate]);

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
            {/* Selo de pareamento do celular */}
            <button
              type="button"
              onClick={() => setPairOpen(true)}
              title={phonePaired ? "Celular pareado" : "Conectar ao celular"}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                phonePaired
                  ? "border-[#07A684]/50 bg-[#07A684]/10 text-[#07A684]"
                  : "border-[#3A4255] bg-[#1E2235] text-[#9CA3AF] hover:border-[#F68B1F]/60 hover:text-[#F68B1F]"
              }`}
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  phonePaired ? "bg-[#07A684] animate-pulse" : "bg-[#6B7280]"
                }`}
              />
              {phonePaired ? "🟢 Celular Pareado e Pronto!" : "📱 Celular Desconectado"}
            </button>
            {!phonePaired && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPairOpen(true)}
                className="border-[#F68B1F]/50 text-[#F68B1F] hover:bg-[#F68B1F]/10 hover:text-[#F68B1F]"
              >
                <SmartphoneCharging className="mr-1.5 h-4 w-4" /> Conectar ao Celular
              </Button>
            )}
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

      <Dialog open={pairOpen} onOpenChange={setPairOpen}>
        <DialogContent className="border-[#262D3D] bg-[#0E1015] text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <SmartphoneCharging className="h-5 w-5 text-[#F68B1F]" /> Parear Controle Remoto
            </DialogTitle>
            <DialogDescription className="text-[#9CA3AF]">
              Aponte a câmera do seu celular para o QR Code abaixo. Faça login (se necessário) e o controle remoto abrirá automaticamente.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-2">
            {phonePaired ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center animate-fade-in">
                <CheckCircle2 className="h-16 w-16 text-[#07A684] drop-shadow-[0_0_18px_rgba(7,166,132,0.6)]" />
                <p className="text-lg font-bold text-[#07A684]">Celular pareado!</p>
                <p className="text-sm text-[#9CA3AF]">Você já pode usar seu celular como controle remoto.</p>
              </div>
            ) : (
              <>
                <div className="rounded-xl bg-white p-3">
                  {pairUrl && <QRCodeSVG value={pairUrl} size={200} />}
                </div>
                <div className="w-full">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
                    Ou abra este link no celular:
                  </p>
                  <code className="block w-full truncate rounded bg-[#1E2235] px-3 py-2 text-xs text-[#F68B1F]">
                    {pairUrl}
                  </code>
                </div>
                <div className="flex items-center gap-2 text-xs text-[#9CA3AF]">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#FFCB05]" />
                  Aguardando o celular se conectar...
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
