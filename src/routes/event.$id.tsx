import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  AlertTriangle,
  BarChart3,
  Check,
  FileText,
  GripVertical,
  Link2,
  Loader2,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Trophy,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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
} from "@/components/ui/alert-dialog";
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

  // ===== Drag & drop reordenação =====
  const [orderedIds, setOrderedIds] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  // Sincroniza a lista local com o servidor (apenas quando não está arrastando)
  useEffect(() => {
    if (!presentations) return;
    if (draggingId) return;
    if (saveState === "saving") return;
    setOrderedIds(presentations.map((p) => p.id));
  }, [presentations, draggingId, saveState]);

  // Lista efetiva exibida (ordem local sobrepõe a do servidor)
  const displayList: Pres[] = (() => {
    if (!presentations) return [];
    if (!orderedIds) return presentations;
    const byId = new Map(presentations.map((p) => [p.id, p]));
    const out: Pres[] = [];
    for (const id of orderedIds) {
      const p = byId.get(id);
      if (p) out.push(p);
    }
    // garante que apresentações novas (ainda não no orderedIds) apareçam
    for (const p of presentations) if (!orderedIds.includes(p.id)) out.push(p);
    return out;
  })();

  async function persistOrder(ids: string[]) {
    setSaveState("saving");
    try {
      await Promise.all(
        ids.map((pid, idx) =>
          (supabase.from("presentations") as any)
            .update({ sort_order: idx })
            .eq("id", pid),
        ),
      );
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1800);
      refetch();
    } catch {
      setSaveState("idle");
      toast.error("Não foi possível salvar a nova ordem");
    }
  }

  function handleDrop(targetId: string) {
    if (!draggingId || draggingId === targetId || !orderedIds) {
      setDraggingId(null);
      setDragOverId(null);
      return;
    }
    const from = orderedIds.indexOf(draggingId);
    const to = orderedIds.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...orderedIds];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOrderedIds(next);
    setDraggingId(null);
    setDragOverId(null);
    void persistOrder(next);
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
            <button
              type="button"
              onClick={() => navigate({ to: "/dashboard" })}
              className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-[#9CA3AF] transition-colors hover:text-[#F68B1F]"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Voltar ao Painel
            </button>
            <h1 className="truncate text-2xl font-bold">{event?.title ?? "Carregando..."}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link to="/event/$id/podium" params={{ id }}>
                <Trophy className="mr-2 h-4 w-4" /> Classificação
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
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Arraste os cards pela alça à esquerda para reordenar a sequência. Elas serão executadas na ordem listada.
          </p>
          {saveState !== "idle" && (
            <div
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                saveState === "saving"
                  ? "border-[#262D3D] bg-[#161A23] text-[#9CA3AF]"
                  : "border-[#07A684]/40 bg-[#07A684]/10 text-[#07A684]"
              }`}
            >
              {saveState === "saving" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Salvando nova sequência...
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5" /> Sequência salva
                </>
              )}
            </div>
          )}
        </div>
        {!presentations ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
          </div>
        ) : displayList.length === 0 ? (
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
            {displayList.map((p, idx) => {
              const isDragging = draggingId === p.id;
              const isOver = dragOverId === p.id && draggingId && draggingId !== p.id;
              return (
              <li
                key={p.id}
                draggable
                onDragStart={(e) => {
                  setDraggingId(p.id);
                  e.dataTransfer.effectAllowed = "move";
                  try {
                    e.dataTransfer.setData("text/plain", p.id);
                  } catch {
                    /* alguns navegadores exigem setData */
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dragOverId !== p.id) setDragOverId(p.id);
                }}
                onDragLeave={() => {
                  if (dragOverId === p.id) setDragOverId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(p.id);
                }}
                onDragEnd={() => {
                  setDraggingId(null);
                  setDragOverId(null);
                }}
                className={`flex items-center gap-3 rounded-xl border bg-card p-3 transition-all duration-200 ${
                  isDragging
                    ? "border-[#F68B1F] opacity-75 shadow-2xl shadow-[#F68B1F]/20"
                    : isOver
                    ? "border-[#F68B1F] ring-2 ring-[#F68B1F]/40"
                    : "border-border"
                }`}
              >
                <div
                  className="flex w-10 shrink-0 cursor-grab flex-col items-center gap-1 text-[#9CA3AF] active:cursor-grabbing"
                  aria-label="Arrastar para reordenar"
                  title="Arrastar para reordenar"
                >
                  <GripVertical className="h-5 w-5" />
                  <span className="text-xs font-bold text-foreground">{idx + 1}</span>
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
                  {p.presented_at ? (
                    <p className="text-xs text-[#9CA3AF]">
                      Exibida em:{" "}
                      {new Date(p.presented_at).toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                      })}{" "}
                      às{" "}
                      {new Date(p.presented_at).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      h
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Criado em {new Date(p.created_at).toLocaleDateString("pt-BR")}
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {(() => {
                      const status = p.execution_status ?? "pending";
                      const map: Record<string, { label: string; className: string }> = {
                        pending: {
                          label: "Pendente",
                          className: "bg-[#262D3D] text-[#9CA3AF]",
                        },
                        active: {
                          label: "Em Andamento",
                          className: "bg-blue-500/15 text-blue-400 border border-blue-500/30",
                        },
                        completed_full: {
                          label: "Apresentação Completa",
                          className: "bg-[#07A684]/15 text-[#07A684] border border-[#07A684]/30",
                        },
                        completed_partial: {
                          label: "Apresentação Parcial",
                          className: "bg-[#F68B1F]/15 text-[#F68B1F] border border-[#F68B1F]/30",
                        },
                      };
                      const s = map[status] ?? map.pending;
                      return (
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.className}`}>
                          {s.label}
                        </span>
                      );
                    })()}
                    {p.chronological_index ? (
                      <span className="rounded-full border border-[#FFCB05]/40 bg-[#FFCB05]/15 px-2 py-0.5 text-[11px] font-semibold text-[#FFCB05]">
                        {p.chronological_index}ª Apresentada do Evento
                      </span>
                    ) : null}
                  </div>
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
              );
            })}
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