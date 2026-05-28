import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Calendar, Loader2, LogOut, Smartphone, Tv } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRequireSpeaker } from "@/hooks/use-auth";
import { usePairingPresence } from "@/hooks/use-pairing-presence";
import { PairingStatusBadge } from "@/components/pairing-status-badge";
import { haptic } from "@/hooks/use-haptic";
import { toast } from "sonner";
import { rememberDashboardOrigin } from "@/lib/dashboard-origin";

export const Route = createFileRoute("/remote/")({
  head: () => ({ meta: [{ title: "Controle Remoto — QuizBini" }] }),
  component: RemoteHub,
});

type Pres = {
  id: string;
  title: string;
  event_id: string | null;
  sort_order: number | null;
  execution_status: string | null;
};

function RemoteHub() {
  const { user, loading } = useRequireSpeaker();
  const navigate = useNavigate();
  const userId = user?.id;
  // Anuncia o celular como pareado ao computador deste palestrante.
  usePairingPresence(userId, "mobile");

  const { data: events } = useQuery({
    queryKey: ["remote-events", userId],
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

  const { data: presentations } = useQuery({
    queryKey: ["remote-presentations", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("presentations") as any)
        .select("id, title, event_id, sort_order, execution_status")
        .eq("user_id", userId!)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Pres[];
    },
  });

  const grouped = useMemo(() => {
    const map = new Map<string | null, Pres[]>();
    for (const p of presentations ?? []) {
      const key = p.event_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [presentations]);

  async function launchOnProjector(pres: Pres) {
    if (!pres.event_id) {
      toast.error("Vincule esta apresentação a um evento para usar o projetor.");
      return;
    }
    haptic(60);
    rememberDashboardOrigin("/dashboard");
    const t = toast.loading("Disparando no projetor...");
    try {
      // 1. Cria a sessão
      const { data: session, error } = await supabase
        .from("sessions")
        .insert({ presentation_id: pres.id, status: "presenting", current_slide: 1 })
        .select("id")
        .single();
      if (error || !session) throw error || new Error("Falha ao criar sessão");

      // 2. Marca apresentação como ativa
      await (supabase.from("presentations") as any)
        .update({
          execution_status: "active",
          presented_at: new Date().toISOString(),
        })
        .eq("id", pres.id);

      // 3. Broadcast no canal do evento p/ o projetor mudar de tela
      const ch = supabase.channel(`event-lobby-${pres.event_id}`);
      await new Promise<void>((resolve) => {
        ch.subscribe((status) => {
          if (status === "SUBSCRIBED") resolve();
        });
        window.setTimeout(() => resolve(), 700);
      });
      await ch.send({
        type: "broadcast",
        event: "launch",
        payload: { session_id: session.id, presentation_id: pres.id },
      });
      window.setTimeout(() => supabase.removeChannel(ch), 400);

      toast.success("Apresentação iniciada no projetor!", { id: t });
      navigate({ to: "/remote/$id/join", params: { id: session.id } });
    } catch (e: any) {
      toast.error(e?.message || "Falha ao iniciar no projetor", { id: t });
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#0E1015] text-white">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando...
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#0E1015] text-white">
      <header className="sticky top-0 z-10 border-b border-[#262D3D] bg-[#131722]/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#F68B1F]">
              <Smartphone className="h-3 w-3" /> Modo Controle Remoto
            </p>
            <h1 className="mt-0.5 truncate text-base font-bold">
              {user?.user_metadata?.full_name || user?.email || "Palestrante"}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <PairingStatusBadge userId={userId} variant="mobile" />
            <button
            type="button"
            onClick={async () => {
              await supabase.auth.signOut();
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

      <main className="space-y-6 p-4 pb-12">
        <section className="rounded-2xl border border-[#262D3D] bg-[#131722] p-4">
          <h2 className="text-base font-bold text-white">Eventos Ativos do Dia</h2>
          <p className="mt-1 text-xs text-[#9CA3AF]">
            Toque em <span className="font-semibold text-[#F68B1F]">Iniciar Transmissão</span> para lançar a apresentação na tela do projetor e comandá-la pelo celular.
          </p>
        </section>

        <div className="rounded-xl border border-[#262D3D] bg-[#161A23] p-3 text-[11px] text-[#9CA3AF]">
          💡 Para enviar novos arquivos PDF e criar quizzes com IA, use o seu computador. O celular é otimizado para comandar a apresentação ao vivo.
        </div>

        {(events ?? []).length === 0 && (
          <div className="rounded-2xl border border-dashed border-[#262D3D] bg-[#131722] p-8 text-center">
            <Calendar className="mx-auto h-10 w-10 text-[#9CA3AF]" />
            <p className="mt-3 text-sm text-[#9CA3AF]">
              Você ainda não criou eventos. Crie um evento no computador para começar.
            </p>
          </div>
        )}

        {(events ?? []).map((ev) => {
          const list = grouped.get(ev.id) ?? [];
          return (
            <section key={ev.id} className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[#FFCB05]">
                  <Calendar className="h-4 w-4" /> {ev.title}
                </h2>
              </div>

              {list.length === 0 ? (
                <p className="rounded-xl border border-[#262D3D] bg-[#161A23] p-4 text-xs text-[#9CA3AF]">
                  Nenhuma apresentação vinculada a este evento.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {list.map((p) => (
                    <div
                      key={p.id}
                      className="rounded-2xl border border-[#262D3D] bg-[#161A23] p-3"
                    >
                      <p className="line-clamp-2 text-sm font-semibold text-white">{p.title}</p>
                      <p className="mt-1 text-[10px] uppercase tracking-wider text-[#9CA3AF]">
                        Status: {p.execution_status ?? "pendente"}
                      </p>
                      <button
                        type="button"
                        onClick={() => launchOnProjector(p)}
                        className="mt-3 flex min-h-[64px] w-full items-center justify-center gap-2 rounded-xl border-0 bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-sm font-extrabold uppercase tracking-wide text-white shadow-xl shadow-[#A6193C]/40 transition-all duration-100 active:scale-95 active:bg-[#C21D43]"
                      >
                        <Tv className="h-5 w-5" /> Iniciar Transmissão
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {/* Apresentações sem evento */}
        {(grouped.get(null)?.length ?? 0) > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Sem evento
            </h2>
            <p className="rounded-xl border border-[#262D3D] bg-[#161A23] p-4 text-xs text-[#9CA3AF]">
              {grouped.get(null)!.length} apresentação(ões) ainda não vinculada(s) a um evento.
              Vincule-as pelo computador para usar o controle remoto.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}