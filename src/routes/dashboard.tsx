import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus, Play, Pencil, FileText, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GLOBAL_USER_ID, GLOBAL_USER_NAME } from "@/lib/constants";
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
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["presentations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("presentations")
        .select("id, title, file_url, created_at")
        .eq("user_id", GLOBAL_USER_ID)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

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
            <p className="text-sm text-muted-foreground">{GLOBAL_USER_NAME}</p>
          </div>
          <Button asChild size="lg">
            <Link to="/quiz/new">
              <Plus className="mr-2 h-5 w-5" /> Novo Quiz
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
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
    </div>
  );
}
