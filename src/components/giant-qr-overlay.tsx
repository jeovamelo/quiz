import { useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  joinUrl: string;
  onClose: () => void;
};

/**
 * Frame flutuante centralizado de QR Code para que atrasados entrem
 * na sala. Acionado pelo controle remoto (celular do palestrante).
 */
export function GiantQrOverlay({ open, joinUrl, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="QR Code para entrar na sala"
    >
      <div className="relative w-[min(92vw,520px)] rounded-3xl border border-[#262D3D] bg-[#161A23] p-8 text-center shadow-2xl shadow-black/60">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
          aria-label="Fechar QR Code"
        >
          <X className="h-4 w-4" />
        </button>
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#F68B1F]">
          Entre a qualquer momento!
        </p>
        <h2 className="mt-1 text-3xl font-black leading-tight text-white">
          Faça a leitura do código acima
        </h2>
        <div className="mx-auto mt-6 inline-block rounded-2xl bg-white p-5 shadow-xl">
          {joinUrl && <QRCodeSVG value={joinUrl} size={320} level="M" />}
        </div>
        <code className="mx-auto mt-5 block max-w-full truncate rounded-lg bg-[#0E1015] px-3 py-2 text-xs font-mono text-[#9CA3AF]">
          {joinUrl}
        </code>
      </div>
    </div>
  );
}