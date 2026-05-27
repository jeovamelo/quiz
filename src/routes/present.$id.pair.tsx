import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { QRCodeSVG } from "qrcode.react";
import { Smartphone, Tv, ArrowRight } from "lucide-react";
import { useRequireSpeaker } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import type { SessionRemote } from "@/lib/session-remotes";

export const Route = createFileRoute("/present/$id/pair")({
  head: () => ({ meta: [{ title: "Conectar Controle Remoto — QuizPulse" }] }),
  component: PairScreen,
});

/**
 * ETAPA 1 do fluxo no projetor: cadastrar o único controle remoto.
 * Exibe um QR Code grande e um slot aguardando a conexão do celular.
 * Quando o slot fica verde, o palestrante pode avançar para o lobby.
 */
function PairScreen() {
  useRequireSpeaker();
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [pairUrl, setPairUrl] = useState("");
  const [remote, setRemote] = useState<SessionRemote | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setPairUrl(`${window.location.origin}/remote-setup/${id}`);
    }
  }, [id]);

  // CORREÇÃO DE BUG: garante que nenhum overlay de classificação/ranking
  // permaneça aberto ao abrir a tela de pareamento. Sessões reabertas
  // podiam carregar com `show_ranking = true` e bloquear o QR Code.
  useEffect(() => {
    (supabase.from("sessions") as any)
      .update({ show_ranking: false, show_join_qr: false, show_pair_qr: true })
      .eq("id", id)
      .then(() => {});
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    async function fetchOne() {
      const { data } = await supabase
        .from("session_remotes")
        .select("*")
        .eq("session_id", id)
        .order("created_at", { ascending: true })
        .limit(1);
      if (cancelled) return;
      const row = (data && data.length > 0 ? (data[0] as any) : null) as SessionRemote | null;
      setRemote(row);
    }
    fetchOne();
    const ch = supabase
      .channel(`pair-screen-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "session_remotes", filter: `session_id=eq.${id}` },
        () => fetchOne(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [id]);

  const connected = !!remote;

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#0E1015] px-6 py-10 text-white">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[640px] w-[640px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-[#A6193C]/15 via-[#F68B1F]/10 to-transparent blur-3xl" />

      <div className="relative z-10 w-full max-w-3xl text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.45em] text-[#BA2172]">
          Etapa 1 de 3 · Exclusivo do apresentador
        </p>
        <h1 className="mt-2 text-5xl font-black tracking-tight md:text-6xl">
          📱 Ativar Controle do Palco
        </h1>
        <p className="mt-3 text-base text-[#9CA3AF] md:text-lg">
          Apenas para o apresentador ou assistentes. Escaneie para passar os
          slides e liberar perguntas direto do seu celular.
        </p>

        <div className="mt-10 grid items-center gap-8 md:grid-cols-[auto,1fr]">
          <div className="relative mx-auto inline-block">
            <div className="absolute -top-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#BA2172] px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white shadow-lg">
              📱 EXCLUSIVO DO APRESENTADOR
            </div>
            <div
              className="rounded-3xl bg-white p-5 shadow-2xl shadow-[#BA2172]/40"
              style={{ boxShadow: "0 0 0 4px #BA2172, 0 25px 50px -12px rgba(186,33,114,0.45)" }}
            >
              {pairUrl && (
                <div className="relative">
                  <QRCodeSVG value={pairUrl} size={260} level="H" />
                  <div className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-4 border-white bg-[#BA2172] text-white shadow-xl">
                    <Smartphone className="h-6 w-6" />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col items-stretch gap-4 text-left">
            <div
              className={`flex items-center gap-4 rounded-2xl border px-5 py-4 transition-colors ${
                connected
                  ? "border-[#07A684]/60 bg-[#07A684]/10"
                  : "border-[#FFCB05]/50 bg-[#FFCB05]/5 animate-pulse"
              }`}
            >
              <span
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
                  connected
                    ? "bg-[#07A684]/20 text-[#07A684]"
                    : "bg-[#FFCB05]/15 text-[#FFCB05]"
                }`}
              >
                {connected ? <Tv className="h-6 w-6" /> : <Smartphone className="h-6 w-6" />}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-[10px] font-bold uppercase tracking-widest ${
                    connected ? "text-[#07A684]" : "text-[#FFCB05]"
                  }`}
                >
                  {connected ? "Controle Conectado" : "Aguardando conexão"}
                </p>
                <p className="truncate text-lg font-extrabold text-white">
                  {connected
                    ? `🟢 ${remote!.operator_name}`
                    : "📱 Aguardando conexão do controle..."}
                </p>
              </div>
            </div>

            <code className="block truncate rounded-lg bg-[#131722] px-3 py-2 text-xs font-mono text-[#9CA3AF]">
              {pairUrl}
            </code>
            <p className="text-xs font-semibold text-[#9CA3AF]">
              Não requer login. Digite seu nome no celular para começar.
            </p>

            <button
              type="button"
              disabled={!connected}
              onClick={() => navigate({ to: "/lobby/$id", params: { id } })}
              className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#BA2172] to-[#F68B1F] px-6 py-4 text-base font-extrabold uppercase tracking-wide text-white shadow-2xl shadow-[#BA2172]/40 transition-all duration-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              Avançar para o Lobby <ArrowRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}