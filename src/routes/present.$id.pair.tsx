import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useRequireSpeaker } from "@/hooks/use-auth";

export const Route = createFileRoute("/present/$id/pair")({
  head: () => ({ meta: [{ title: "Apresentação — QuizPulse" }] }),
  component: PairRedirect,
});

// A tela dedicada de pareamento foi substituída por um frame flutuante
// dentro da própria apresentação. Esta rota apenas redireciona para
// /present/$id, onde o overlay de cadastro de controles aparece
// automaticamente quando nenhum controle está pareado.
function PairRedirect() {
  useRequireSpeaker();
  const { id } = Route.useParams();
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/present/$id", params: { id }, replace: true });
  }, [id, navigate]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0E1015] text-white">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Abrindo apresentação...
    </div>
  );
}

function PairRemotes() {
  useRequireSpeaker();
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [remotes, setRemotes] = useState<SessionRemote[]>([]);
  const [pairUrl, setPairUrl] = useState("");
  const [eventTitle, setEventTitle] = useState<string | null>(null);
  const [presentationTitle, setPresentationTitle] = useState<string | null>(null);

  useEffect(() => {
    setPairUrl(`${window.location.origin}/remote-setup/${id}`);
  }, [id]);

  // Carrega título do evento/apresentação para contexto.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: s } = await supabase
        .from("sessions")
        .select("presentation_id")
        .eq("id", id)
        .single();
      if (cancelled || !s) return;
      const { data: p } = await (supabase.from("presentations") as any)
        .select("title, event_id")
        .eq("id", (s as any).presentation_id)
        .single();
      if (cancelled || !p) return;
      setPresentationTitle((p as any).title ?? null);
      if ((p as any).event_id) {
        const { data: ev } = await (supabase.from("events") as any)
          .select("title")
          .eq("id", (p as any).event_id)
          .maybeSingle();
        if (!cancelled) setEventTitle((ev as any)?.title ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Realtime: escuta inserts/updates/deletes em session_remotes desta sessão.
  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      const { data } = await supabase
        .from("session_remotes")
        .select("*")
        .eq("session_id", id)
        .order("slot", { ascending: true });
      if (!cancelled) setRemotes((data as any) ?? []);
    }
    fetchAll();
    const ch = supabase
      .channel(`pair-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "session_remotes", filter: `session_id=eq.${id}` },
        () => fetchAll(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [id]);

  const slot1 = remotes.find((r) => r.slot === 1) ?? null;
  const slot2 = remotes.find((r) => r.slot === 2) ?? null;

  function advanceToLobby() {
    navigate({ to: "/lobby/$id", params: { id } });
  }

  if (!pairUrl) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0E1015] text-white">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Preparando sala de pareamento...
      </div>
    );
  }

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-gradient-to-br from-[#0E1015] via-[#131722] to-[#0E1015] text-white">
      {/* Halo de fundo */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[700px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-[#A6193C]/20 via-[#F68B1F]/10 to-transparent blur-3xl" />

      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-10 px-6 py-10">
        <div className="text-center">
          {(eventTitle || presentationTitle) && (
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.3em] text-[#F68B1F]">
              {eventTitle ?? presentationTitle}
            </p>
          )}
          <h1 className="bg-gradient-to-r from-white via-[#FFCB05] to-[#F68B1F] bg-clip-text text-4xl font-black tracking-tight text-transparent md:text-6xl">
            Conectar Controles Remotos
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-[#9CA3AF] md:text-base">
            Escaneie o QR Code com até <span className="font-bold text-white">2 celulares</span>
            {" "}para comandar a apresentação. Você pode começar mesmo sem cadastrar nenhum controle.
          </p>
        </div>

        <div className="grid w-full gap-8 md:grid-cols-[auto_1fr] md:items-center">
          {/* QR Code */}
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-2xl bg-white p-5 shadow-2xl shadow-[#A6193C]/20">
              <QRCodeSVG value={pairUrl} size={240} />
            </div>
            <code className="max-w-[260px] truncate rounded bg-[#131722] px-3 py-1.5 text-[11px] text-[#9CA3AF]">
              {pairUrl}
            </code>
          </div>

          {/* Slots */}
          <div className="space-y-4">
            <SlotCard slot={1} remote={slot1} optional={false} />
            <SlotCard slot={2} remote={slot2} optional />
          </div>
        </div>
      </main>

      <footer className="relative z-10 border-t border-[#262D3D] bg-[#0E1015]/80 px-6 py-5 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 md:flex-row">
          <p className="text-xs text-[#9CA3AF]">
            {remotes.length === 0
              ? "Nenhum controle conectado — você pode iniciar e parear depois."
              : `${remotes.length} ${remotes.length === 1 ? "controle conectado" : "controles conectados"}.`}
          </p>
          <button
            type="button"
            onClick={advanceToLobby}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#A6193C] to-[#F68B1F] px-8 py-4 text-base font-extrabold uppercase tracking-wide text-white shadow-2xl shadow-[#A6193C]/40 transition-all duration-100 hover:scale-[1.02] active:scale-95"
          >
            <ArrowRight className="h-5 w-5" /> Iniciar Apresentação Agora 🚀
          </button>
        </div>
      </footer>
    </div>
  );
}

function SlotCard({
  slot,
  remote,
  optional,
}: {
  slot: 1 | 2;
  remote: SessionRemote | null;
  optional: boolean;
}) {
  const connected = !!remote;
  return (
    <div
      className={`flex items-center gap-4 rounded-2xl border-2 p-5 transition-all duration-300 ${
        connected
          ? "border-[#07A684]/60 bg-[#07A684]/10 shadow-lg shadow-[#07A684]/20"
          : "border-[#FFCB05]/30 bg-[#FFCB05]/5"
      }`}
    >
      <div
        className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-2xl ${
          connected
            ? "bg-[#07A684]/20 text-[#07A684]"
            : "bg-[#FFCB05]/15 text-[#FFCB05] animate-pulse"
        }`}
        aria-hidden="true"
      >
        {connected ? <Tv className="h-6 w-6" /> : <Smartphone className="h-6 w-6" />}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={`text-[11px] font-bold uppercase tracking-widest ${
            connected ? "text-[#07A684]" : "text-[#FFCB05]"
          }`}
        >
          📱 Controle {slot} {optional && !connected ? "(Opcional)" : ""}
        </p>
        {connected ? (
          <p className="mt-1 truncate text-xl font-bold text-white">
            🟢 {remote!.operator_name}
          </p>
        ) : (
          <p className="mt-1 text-base font-semibold text-[#9CA3AF]">
            Aguardando conexão{optional ? "..." : "..."}
          </p>
        )}
      </div>
      {!connected && (
        <span
          className="h-3 w-3 shrink-0 rounded-full bg-[#FFCB05] animate-pulse"
          aria-hidden="true"
        />
      )}
    </div>
  );
}