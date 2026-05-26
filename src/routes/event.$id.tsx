import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, FileText, Loader2, Play, Plus, Trash2, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/event/$id")({
  head: () => ({ meta: [{ title: "Evento — QuizPulse" }] }),
  component: EventManage,
});

type Pres = {
  id: string;
  title: string;
  file_url: string;
  sort_order: number;
  created_at: string;
};

function EventManage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();

  const { data: event } = useQuery({
    queryKey: ["event", id],
    queryFn: async () => {
      const { data, error } = await (supabase.from("events") as any)
        .select("id, title, created_at")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: presentations, refetch } = useQuery({
    queryKey: ["event-presentations", id],
    queryFn: async () => {
      const { data, error } = await (supabase.from("presentations") as any)
        .select("id, title, file_url, sort_order, created_at")
        .eq("event_id", id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Pres[];
    },
  });

  async function move(index: number, dir: -1 | 1) {
    if (!presentations) return;
    const j = index + dir;
    if (j < 0 || j >= presentations.length) return;
    const a = presentations[index];
    const b = presentations[j];
    // swap sort_order
    await (supabase.from("presentations") as any)
      .update({ sort_order: b.sort_order })
      .eq("id", a.id);
    await (supabase.from("presentations") as any)
      .update({ sort_order: a.sort_order })
      .eq("id", b.id);
    refetch();
  }

  async function detach(presentationId: string) {
    await (supabase.from("presentations") as any)
      .update({ event_id: null })
      .eq("id", presentationId);
    toast.success("Apresentação desvinculada");
    refetch();
  }

  async function startSession(presentationId: string) {
    const { data: session, error } = await supabase
      .from("sessions")
      .insert({ presentation_id: presentationId, status: "lobby", current_slide: 1 })
      .select("id")
      .single();
    if (error || !session) {
      toast.error("Não foi possível iniciar a sessão");
      return;
    }
    navigate({ to: "/lobby/$id", params: { id: session.id } });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Evento</p>
            <h1 className="truncate text-2xl font-bold">{event?.title ?? "Carregando..."}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link to="/event/$id/podium" params={{ id }}>
                <Trophy className="mr-2 h-4 w-4" /> Grande Pódio
              </Link>
            </Button>
            <Button asChild>
              <Link to="/quiz/new" search={{ eventId: id }}>
                <Plus className="mr-2 h-4 w-4" /> Nova Apresentação
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <p className="mb-4 text-sm text-muted-foreground">
          Reordene as apresentações usando as setas. Elas serão executadas na ordem listada.
        </p>
        {!presentations ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
          </div>
        ) : presentations.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/30 p-12 text-center">
            <FileText className="mx-auto h-12 w-12 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">Nenhuma apresentação ainda</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Adicione uma apresentação em PDF para começar este evento.
            </p>
            <Button asChild className="mt-6">
              <Link to="/quiz/new" search={{ eventId: id }}>
                <Plus className="mr-2 h-4 w-4" /> Adicionar Apresentação
              </Link>
            </Button>
          </div>
        ) : (
          <ol className="space-y-3">
            {presentations.map((p, idx) => (
              <li
                key={p.id}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
              >
                <div className="flex w-10 shrink-0 flex-col items-center gap-1">
                  <button
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    className="rounded p-1 hover:bg-muted disabled:opacity-30"
                    aria-label="Subir"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <span className="text-xs font-bold">{idx + 1}</span>
                  <button
                    onClick={() => move(idx, 1)}
                    disabled={idx === presentations.length - 1}
                    className="rounded p-1 hover:bg-muted disabled:opacity-30"
                    aria-label="Descer"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </div>
                <div className="hidden h-20 w-32 shrink-0 overflow-hidden rounded bg-black md:block">
                  <iframe
                    title={p.title}
                    src={`${p.file_url}#page=1&toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                    className="pointer-events-none h-full w-full"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-semibold">{p.title}</h3>
                  <p className="text-xs text-muted-foreground">
                    Criado em {new Date(p.created_at).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => startSession(p.id)}>
                    <Play className="mr-1 h-4 w-4" /> Iniciar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => detach(p.id)} title="Desvincular do evento">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </main>
    </div>
  );
}