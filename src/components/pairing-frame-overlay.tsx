import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Smartphone, Tv, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SessionRemote } from "@/lib/session-remotes";

type Props = {
  open: boolean;
  sessionId: string;
  onClose: () => void;
};

/**
 * Frame flutuante de cadastro de controles remotos. Aparece sobre a
 * apresentação (canto superior direito) e é acionado:
 *   1) automaticamente, quando nenhum controle está pareado;
 *   2) sob demanda, pelo botão "Cadastrar Controle" em qualquer remoto.
 */
export function PairingFrameOverlay({ open, sessionId, onClose }: Props) {
  const [remotes, setRemotes] = useState<SessionRemote[]>([]);
  const [pairUrl, setPairUrl] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setPairUrl(`${window.location.origin}/remote-setup/${sessionId}`);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function fetchAll() {
      const { data } = await supabase
        .from("session_remotes")
        .select("*")
        .eq("session_id", sessionId)
        .order("slot", { ascending: true });
      if (!cancelled) setRemotes((data as any) ?? []);
    }
    fetchAll();
    const ch = supabase
      .channel(`pair-frame-${sessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "session_remotes", filter: `session_id=eq.${sessionId}` },
        () => fetchAll(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [open, sessionId]);

  if (!open || !pairUrl) return null;

  const slot1 = remotes.find((r) => r.slot === 1) ?? null;
  const slot2 = remotes.find((r) => r.slot === 2) ?? null;

  return (
    <div
      className="pointer-events-auto fixed right-4 top-4 z-[70] w-[min(92vw,360px)] rounded-2xl border border-[#262D3D] bg-[#0E1015]/95 p-4 text-white shadow-2xl shadow-black/60 backdrop-blur"
      role="dialog"
      aria-label="Cadastrar controle remoto"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#F68B1F]">
            Cadastrar Controle
          </p>
          <h3 className="mt-0.5 text-base font-extrabold leading-tight">
            Escaneie com o celular
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar cadastro de controle"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex gap-3">
        <div className="shrink-0 rounded-xl bg-white p-2">
          <QRCodeSVG value={pairUrl} size={120} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <SlotMini slot={1} remote={slot1} />
          <SlotMini slot={2} remote={slot2} optional />
        </div>
      </div>

      <code className="mt-3 block truncate rounded bg-[#131722] px-2 py-1 text-[10px] text-[#9CA3AF]">
        {pairUrl}
      </code>
    </div>
  );
}

function SlotMini({
  slot,
  remote,
  optional,
}: {
  slot: 1 | 2;
  remote: SessionRemote | null;
  optional?: boolean;
}) {
  const connected = !!remote;
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${
        connected
          ? "border-[#07A684]/50 bg-[#07A684]/10"
          : "border-[#FFCB05]/30 bg-[#FFCB05]/5"
      }`}
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
          connected ? "bg-[#07A684]/20 text-[#07A684]" : "bg-[#FFCB05]/15 text-[#FFCB05]"
        }`}
        aria-hidden="true"
      >
        {connected ? <Tv className="h-3.5 w-3.5" /> : <Smartphone className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={`text-[9px] font-bold uppercase tracking-widest ${
            connected ? "text-[#07A684]" : "text-[#FFCB05]"
          }`}
        >
          Controle {slot}
          {optional && !connected ? " (opcional)" : ""}
        </p>
        <p className="truncate text-xs font-bold text-white">
          {connected ? `🟢 ${remote!.operator_name}` : "Aguardando..."}
        </p>
      </div>
    </div>
  );
}
