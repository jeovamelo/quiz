import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Play, Users, ArrowLeft, Smartphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/lobby/$id")({
  head: () => ({ meta: [{ title: "Lobby — QuizPulse" }] }),
  component: Lobby,
});

function Lobby() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [participants, setParticipants] = useState<Array<{ id: string; name: string }>>([]);
  const [joinUrl, setJoinUrl] = useState("");
  const [remotesCount, setRemotesCount] = useState(0);

  useEffect(() => {
    setJoinUrl(`${window.location.origin}/join?session=${id}`);
    supabase
      .from("participants")
      .select("id, name")
      .eq("session_id", id)
      .then(({ data }) => data && setParticipants(data));
    const ch = supabase
      .channel(`lobby-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "participants", filter: `session_id=eq.${id}` },
        () => {
          supabase
            .from("participants")
            .select("id, name")
            .eq("session_id", id)
            .then(({ data }) => data && setParticipants(data));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [id]);

  // Monitora controles remotos pareados em tempo real.
  useEffect(() => {
    let cancelled = false;
    async function fetchRemotes() {
      const { data } = await supabase
        .from("session_remotes")
        .select("id")
        .eq("session_id", id);
      if (!cancelled) setRemotesCount((data ?? []).length);
    }
    fetchRemotes();
    const ch = supabase
      .channel(`lobby-remotes-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "session_remotes", filter: `session_id=eq.${id}` },
        () => fetchRemotes(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [id]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(joinUrl);
      toast.success("Link copiado!");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = joinUrl;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        toast.success("Link copiado!");
      } catch {
        toast.error("Não foi possível copiar");
      }
      document.body.removeChild(ta);
    }
  }

  async function start() {
    const { error } = await supabase
      .from("sessions")
      .update({ status: "live", current_slide: 1 })
      .eq("id", id);
    if (error) {
      toast.error("Falha ao iniciar");
      return;
    }
    navigate({ to: "/present/$id", params: { id } });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-2xl font-bold">Lobby de Espera</h1>
            <p className="text-sm text-muted-foreground">Compartilhe o acesso com seus participantes</p>
          </div>
          <div className="flex items-center gap-3">
            <div
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                remotesCount > 0
                  ? "border-[#07A684]/40 bg-[#07A684]/10 text-[#07A684]"
                  : "border-border bg-background/50 text-muted-foreground"
              }`}
              title="Controles remotos pareados nesta sessão"
            >
              <Smartphone className="h-3.5 w-3.5" />
              📱 {remotesCount} {remotesCount === 1 ? "Controle Conectado" : "Controles Conectados"}
            </div>
            <Button variant="ghost" onClick={() => navigate({ to: "/dashboard" })}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <h2 className="mb-4 text-lg font-semibold">Escaneie para entrar</h2>
          <div className="mx-auto inline-block rounded-xl bg-white p-4">
            {joinUrl && <QRCodeSVG value={joinUrl} size={240} />}
          </div>
          <div className="mt-6 flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-background/60 px-3 py-2 text-xs text-muted-foreground">
              {joinUrl}
            </code>
            <Button variant="outline" onClick={copyLink}>
              <Copy className="mr-2 h-4 w-4" /> Copiar
            </Button>
          </div>
          <Button size="lg" className="mt-6 w-full" onClick={start}>
            <Play className="mr-2 h-5 w-5" /> Iniciar Apresentação
          </Button>
        </div>
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <Users className="h-5 w-5" /> Participantes ({participants.length})
          </h2>
          {participants.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aguardando participantes... você pode iniciar a qualquer momento.
            </p>
          ) : (
            <ul className="space-y-2">
              {participants.map((p) => (
                <li key={p.id} className="rounded border border-border bg-background/40 px-3 py-2 text-sm">
                  {p.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
