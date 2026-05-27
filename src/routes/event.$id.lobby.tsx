import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, Smartphone, Tv } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRequireSpeaker } from "@/hooks/use-auth";

export const Route = createFileRoute("/event/$id/lobby")({
  head: () => ({ meta: [{ title: "Lobby do Evento — QuizPulse" }] }),
  component: EventLobby,
});

function EventLobby() {
  useRequireSpeaker();
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [pulse, setPulse] = useState(0);

  const { data: event } = useQuery({
    queryKey: ["event-lobby", id],
    queryFn: async () => {
      const { data } = await (supabase.from("events") as any)
        .select("id, title")
        .eq("id", id)
        .maybeSingle();
      return data as { id: string; title: string } | null;
    },
  });

  const { data: presentations } = useQuery({
    queryKey: ["event-lobby-presentations", id],
    queryFn: async () => {
      const { data } = await (supabase.from("presentations") as any)
        .select("id, title, sort_order, execution_status")
        .eq("event_id", id)
        .order("sort_order", { ascending: true });
      return (data ?? []) as Array<{
        id: string;
        title: string;
        sort_order: number | null;
        execution_status: string | null;
      }>;
    },
  });

  // Inscreve no canal Realtime do evento
  useEffect(() => {
    const ch = supabase
      .channel(`event-lobby-${id}`)
      .on("broadcast", { event: "launch" }, ({ payload }) => {
        if (payload?.session_id) {
          navigate({ to: "/present/$id", params: { id: payload.session_id } });
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [id, navigate]);

  // pulso visual
  useEffect(() => {
    const t = setInterval(() => setPulse((p) => p + 1), 1200);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-[#0E1015] via-[#131722] to-[#0E1015] text-white">
      {/* Halo pulsante */}
      <div
        key={pulse}
        className="pointer-events-none absolute h-[600px] w-[600px] rounded-full bg-gradient-to-br from-[#A6193C]/20 via-[#F68B1F]/10 to-transparent blur-3xl"
        style={{ animation: "pulse 1.2s ease-out" }}
      />

      <div className="relative z-10 max-w-2xl px-8 text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#FFCB05]/30 bg-[#FFCB05]/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-[#FFCB05]">
          <Tv className="h-3.5 w-3.5" /> Modo Receptor — Projetor
        </div>
        <h1 className="bg-gradient-to-r from-white via-[#FFCB05] to-[#F68B1F] bg-clip-text text-5xl font-black tracking-tight text-transparent md:text-6xl">
          {event?.title ?? "Carregando evento..."}
        </h1>
        <p className="mt-6 flex items-center justify-center gap-2 text-lg text-[#9CA3AF]">
          <Smartphone className="h-5 w-5 text-[#F68B1F]" />
          Aguardando o palestrante iniciar uma apresentação pelo celular...
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-[#9CA3AF]" />
          <span className="text-xs uppercase tracking-widest text-[#9CA3AF]">
            Sincronizado em tempo real
          </span>
        </div>

        {presentations && presentations.length > 0 && (
          <div className="mt-10 rounded-2xl border border-[#262D3D] bg-[#131722]/60 p-5 text-left backdrop-blur">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-[#FFCB05]">
              Apresentações deste evento
            </p>
            <ol className="space-y-2">
              {presentations.map((p, idx) => (
                <li
                  key={p.id}
                  className="flex items-center gap-3 rounded-lg border border-[#262D3D]/60 bg-[#0E1015]/60 px-3 py-2 text-sm"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1E2235] text-[10px] font-bold text-[#FFCB05]">
                    {idx + 1}
                  </span>
                  <span className="flex-1 truncate text-white/90">{p.title}</span>
                  <span className="text-[10px] uppercase tracking-wider text-[#9CA3AF]">
                    {p.execution_status === "active"
                      ? "ativa"
                      : p.execution_status === "completed_full" ||
                          p.execution_status === "completed_partial"
                        ? "concluída"
                        : "pendente"}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}