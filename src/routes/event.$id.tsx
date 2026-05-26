import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, BarChart3, FileText, Link2, Loader2, Pencil, Play, Plus, Sparkles, Trash2, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  execution_status?: string | null;
  presented_at?: string | null;
  chronological_index?: number | null;
};

type AvailablePres = {
  id: string;
  title: string;
  created_at: string;
  question_count: number;
};

function EventManage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);
  const [mode, setMode] = useState<"choose" | "link">("choose");
  const [linking, setLinking] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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
        .select("id, title, file_url, sort_order, created_at, execution_status, presented_at, chronological_index")
        .eq("event_id", id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Pres[];
    },
  });

  // Mapa: presentation_id → último sessionId encerrado (para o botão "Ver Resultados")
  const { data: endedSessions } = useQuery({
    queryKey: ["event-ended-sessions", id, presentations?.length ?? 0],
    enabled: !!presentations && presentations.length > 0,
    queryFn: async () => {
      const ids = (presentations ?? []).map((p) => p.id);
      if (ids.length === 0) return {} as Record<string, string>;
      const { data, error } = await supabase
        .from("sessions")
        .select("id, presentation_id, created_at, status")
        .in("presentation_id", ids)
        .eq("status", "ended")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const s of (data ?? []) as any[]) {
        if (!map[s.presentation_id]) map[s.presentation_id] = s.id;
      }
      return map;
    },
  });

  const { data: available, refetch: refetchAvailable, isFetching: loadingAvailable } = useQuery({
    queryKey: ["available-presentations", id, addOpen, mode],
    enabled: addOpen && mode === "link",
    queryFn: async () => {
      const { data, error } = await (supabase.from("presentations") as any)
        .select("id, title, created_at")
        .is("event_id", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const list = (data ?? []) as Array<{ id: string; title: string; created_at: string }>;
      // Buscar contagem de perguntas para cada
      const withCounts: AvailablePres[] = await Promise.all(
        list.map(async (p) => {
          const { count } = await supabase
            .from("questions")
            .select("id", { count: "exact", head: true })
            .eq("presentation_id", p.id);
          return { ...p, question_count: count ?? 0 };
        }),
      );
      return withCounts;
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

  function openAddModal() {
    setMode("choose");
    setSelectedIds(new Set());
    setAddOpen(true);
  }

  function toggleSelected(presId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(presId)) next.delete(presId);
      else next.add(presId);
      return next;
    });
  }

  async function confirmLink() {
    if (selectedIds.size === 0) {
      toast.error("Selecione ao menos uma apresentação");
      return;
    }
    setLinking(true);
    try {
      // Calcula próximo sort_order
      const { data: maxRow } = await (supabase.from("presentations") as any)
        .select("sort_order")
        .eq("event_id", id)
        .order("sort_order", { ascending: false })
        .limit(1);
      let next = maxRow && maxRow.length > 0 ? (maxRow[0].sort_order ?? 0) + 1 : 0;
      const ids = Array.from(selectedIds);
      for (const presId of ids) {
        const { error } = await (supabase.from("presentations") as any)
          .update({ event_id: id, sort_order: next })
          .eq("id", presId);
        if (error) throw error;
        next += 1;
      }
      toast.success(
        ids.length === 1
          ? "Apresentação vinculada ao evento"
          : `${ids.length} apresentações vinculadas ao evento`,
      );
      setAddOpen(false);
      setSelectedIds(new Set());
      refetch();
      refetchAvailable();
    } catch (e: any) {
      toast.error(e.message || "Falha ao vincular");
    } finally {
      setLinking(false);
    }
  }

  async function startSession(presentationId: string) {
    // Calcula chronological_index: quantas apresentações deste evento já têm presented_at
    const { count: presentedCount } = await (supabase.from("presentations") as any)
      .select("id", { count: "exact", head: true })
      .eq("event_id", id)
      .not("presented_at", "is", null);
    const nextIndex = (presentedCount ?? 0) + 1;

    const { data: session, error } = await supabase
      .from("sessions")
      .insert({ presentation_id: presentationId, status: "lobby", current_slide: 1 })
      .select("id")
      .single();
    if (error || !session) {
      toast.error("Não foi possível iniciar a sessão");
      return;
    }

    // Marca apresentação como em andamento, com horário e ordem cronológica
    await (supabase.from("presentations") as any)
      .update({
        execution_status: "active",
        presented_at: new Date().toISOString(),
        chronological_index: nextIndex,
      })
      .eq("id", presentationId);

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
            <Button
              onClick={openAddModal}
              className="bg-gradient-to-r from-[#A6193C] to-[#F26B1F] text-white hover:opacity-90"
            >
              <Plus className="mr-2 h-4 w-4" /> Adicionar Apresentação ao Evento
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
              Vincule uma apresentação existente ou crie uma nova para começar este evento.
            </p>
            <Button
              onClick={openAddModal}
              className="mt-6 bg-gradient-to-r from-[#A6193C] to-[#F26B1F] text-white hover:opacity-90"
            >
              <Plus className="mr-2 h-4 w-4" /> Adicionar Apresentação ao Evento
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
                <div className="flex flex-wrap items-center gap-2">
                  {endedSessions && endedSessions[p.id] ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        navigate({
                          to: "/present/$id/review",
                          params: { id: endedSessions[p.id] },
                        })
                      }
                    >
                      <BarChart3 className="mr-1 h-4 w-4" /> Ver Resultados
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => startSession(p.id)}>
                      <Play className="mr-1 h-4 w-4" /> Iniciar
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      navigate({
                        to: "/quiz/$id/edit",
                        params: { id: p.id },
                        search: { redirect_to_event: id },
                      })
                    }
                    className="border-[#262D3D] text-[#9CA3AF] hover:border-[#F68B1F] hover:text-[#F68B1F]"
                    title="Editar apresentação"
                  >
                    <Pencil className="mr-1 h-4 w-4" /> Editar
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

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-2xl border-[#262D3D] bg-[#0E1015] text-foreground">
          {mode === "choose" ? (
            <>
              <DialogHeader>
                <DialogTitle>Adicionar Apresentação ao Evento</DialogTitle>
                <DialogDescription>
                  Escolha como deseja adicionar uma apresentação ao cronograma deste evento.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setMode("link")}
                  className="group flex flex-col items-start gap-3 rounded-xl border border-[#262D3D] bg-[#131722] p-6 text-left transition hover:border-primary"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <Link2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Vincular Apresentação Existente</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Escolha entre as apresentações que você já criou e que ainda não estão em
                      nenhum evento.
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddOpen(false);
                    navigate({ to: "/quiz/new", search: { eventId: id } });
                  }}
                  className="group flex flex-col items-start gap-3 rounded-xl border border-[#262D3D] bg-[#131722] p-6 text-left transition hover:border-primary"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-[#A6193C] to-[#F26B1F] text-white">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Criar Nova Apresentação</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Envie um PDF e gere as perguntas com IA. A apresentação já será vinculada
                      automaticamente a este evento.
                    </p>
                  </div>
                </button>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Vincular Apresentação Existente</DialogTitle>
                <DialogDescription>
                  Selecione uma ou mais apresentações avulsas para incluir neste evento.
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-[#262D3D] bg-[#131722]">
                {loadingAvailable ? (
                  <div className="flex items-center justify-center gap-2 p-8 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Carregando apresentações...
                  </div>
                ) : !available || available.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    Nenhuma apresentação avulsa disponível. Crie uma nova ou desvincule de outro
                    evento.
                  </div>
                ) : (
                  <ul className="divide-y divide-[#262D3D]">
                    {available.map((p) => {
                      const checked = selectedIds.has(p.id);
                      return (
                        <li key={p.id}>
                          <label className="flex cursor-pointer items-center gap-3 p-4 transition hover:bg-white/5">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSelected(p.id)}
                              className="h-4 w-4 accent-primary"
                            />
                            <div className="min-w-0 flex-1">
                              <h4 className="truncate font-semibold">{p.title}</h4>
                              <p className="text-xs text-muted-foreground">
                                {p.question_count} {p.question_count === 1 ? "pergunta" : "perguntas"} ·
                                Criado em {new Date(p.created_at).toLocaleDateString("pt-BR")}
                              </p>
                            </div>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <DialogFooter className="gap-2 sm:gap-2">
                <Button variant="ghost" onClick={() => setMode("choose")} disabled={linking}>
                  Voltar
                </Button>
                <Button
                  onClick={confirmLink}
                  disabled={linking || selectedIds.size === 0}
                  className="bg-gradient-to-r from-[#A6193C] to-[#F26B1F] text-white hover:opacity-90"
                >
                  {linking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Confirmar Vínculo {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}