import { Wifi, WifiOff, Loader2 } from "lucide-react";
import type { TunnelTransport } from "@/hooks/use-webrtc-tunnel";

type Props = {
  transport: TunnelTransport;
  /** Posição compacta para encaixar em barras superiores. */
  compact?: boolean;
  className?: string;
};

/**
 * Selo visível em celular e projetor que indica o transporte ativo:
 *  - Verde: Conexão Direta P2P (latência zero, mesma rede)
 *  - Amarelo piscante: Redes diferentes — fallback pela nuvem
 *  - Cinza: handshake em andamento
 */
export function NetworkStatusBadge({ transport, compact = false, className = "" }: Props) {
  if (transport === "p2p") {
    return (
      <div
        className={`inline-flex items-center gap-1.5 rounded-full border border-[#07A684]/50 bg-[#07A684]/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#07A684] shadow-[0_0_12px_-2px_#07A684] ${className}`}
        aria-live="polite"
      >
        <Wifi className="h-3 w-3" />
        🟢 {compact ? "Direta P2P" : "Conexão Direta Ativa — Latência Zero"}
      </div>
    );
  }
  if (transport === "fallback") {
    return (
      <div
        className={`inline-flex items-center gap-1.5 rounded-full border border-[#FFCB05]/60 bg-[#FFCB05]/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#FFCB05] animate-pulse ${className}`}
        aria-live="polite"
        title="Conecte o celular e o computador no mesmo Wi-Fi para latência zero."
      >
        <WifiOff className="h-3 w-3" />
        ⚠️ {compact ? "Redes Diferentes" : "Redes Diferentes — Pode haver lentidão"}
      </div>
    );
  }
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border border-[#3A4255] bg-[#1E2235] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF] ${className}`}
      aria-live="polite"
    >
      <Loader2 className="h-3 w-3 animate-spin" />
      Conectando…
    </div>
  );
}

/**
 * Barra de aviso amarela piscante exibida no topo da tela quando o
 * transporte caiu para a nuvem. Use no projetor e no celular.
 */
export function NetworkFallbackBanner({ transport }: { transport: TunnelTransport }) {
  if (transport !== "fallback") return null;
  return (
    <div className="z-50 w-full bg-[#FFCB05] px-3 py-2 text-center text-[11px] font-extrabold uppercase tracking-wide text-black animate-pulse shadow-lg">
      ⚠️ Redes Diferentes Detectadas! O controle remoto pode apresentar lentidão.
      Para latência zero, conecte o celular e o computador no mesmo Wi-Fi.
    </div>
  );
}