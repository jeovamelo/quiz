import { useEffect, useState } from "react";
import { Smartphone, SmartphoneCharging } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePresenceMonitor } from "@/hooks/use-presence-monitor";

type Props = {
  userId: string | undefined;
  variant: "desktop" | "mobile";
  /** Esconde o botão "Forçar Conexão" mesmo quando desconectado. */
  compact?: boolean;
};

/**
 * Selo persistente de pareamento entre o computador e o celular do
 * palestrante. Exibe estado conectado/desconectado em tempo real e oferece
 * botão de "Forçar Conexão" + QR Code (no desktop) para reparear.
 */
export function PairingStatusBadge({ userId, variant, compact }: Props) {
  const { isConnected } = usePresenceMonitor(userId, variant);
  const [pairOpen, setPairOpen] = useState(false);
  const [pairUrl, setPairUrl] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setPairUrl(`${window.location.origin}/remote`);
    }
  }, []);

  useEffect(() => {
    if (isConnected && pairOpen) {
      const t = window.setTimeout(() => setPairOpen(false), 1200);
      return () => window.clearTimeout(t);
    }
  }, [isConnected, pairOpen]);

  if (variant === "mobile") {
    return (
      <div className="flex items-center gap-2">
        <span
          title={isConnected ? "Sincronizado com a tela do computador" : "Sem conexão com a tela"}
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold transition ${
            isConnected
              ? "border-[#07A684]/50 bg-[#07A684]/15 text-[#07A684]"
              : "border-[#A6193C]/60 bg-[#A6193C]/15 text-[#A6193C] animate-pulse"
          }`}
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              isConnected ? "bg-[#07A684] animate-pulse" : "bg-[#A6193C]"
            }`}
          />
          {isConnected ? "🟢 Sincronizado" : "⚠️ Sem conexão"}
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPairOpen(true)}
          title={isConnected ? "Celular conectado" : "Conectar ao celular"}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
            isConnected
              ? "border-[#07A684]/50 bg-[#07A684]/10 text-[#07A684]"
              : "border-[#A6193C]/50 bg-[#A6193C]/10 text-[#A6193C]"
          }`}
        >
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              isConnected ? "bg-[#07A684] animate-pulse" : "bg-[#A6193C]"
            }`}
          />
          {isConnected ? "🟢 Celular Conectado" : "🔴 Celular Desconectado"}
          <Smartphone className="ml-1 h-3.5 w-3.5" />
        </button>
      </div>

      <Dialog open={pairOpen} onOpenChange={setPairOpen}>
        <DialogContent className="border-[#262D3D] bg-[#0E1015] text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <SmartphoneCharging className="h-5 w-5 text-[#F68B1F]" /> Conectar Celular
            </DialogTitle>
            <DialogDescription className="text-[#9CA3AF]">
              Aponte a câmera do seu celular para o QR Code abaixo e faça login
              com a mesma conta. O controle remoto irá parear automaticamente.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="rounded-xl bg-white p-3">
              {pairUrl && <QRCodeSVG value={pairUrl} size={200} />}
            </div>
            <div className="w-full">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
                Ou abra este link no celular:
              </p>
              <code className="block w-full truncate rounded bg-[#1E2235] px-3 py-2 text-xs text-[#F68B1F]">
                {pairUrl}
              </code>
            </div>
            <div className="flex items-center gap-2 text-xs">
              {isConnected ? (
                <span className="text-[#07A684]">🟢 Celular pareado e pronto!</span>
              ) : (
                <>
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#FFCB05]" />
                  <span className="text-[#9CA3AF]">Aguardando o celular conectar…</span>
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}