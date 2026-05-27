import { useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  joinUrl: string;
  onClose: () => void;
};

/**
 * Sobreposição em tela cheia do projetor com o QR Code de entrada da
 * plateia em tamanho gigante. Acionado pelo controle remoto.
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
      className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-black/85 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="QR Code gigante de entrada"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-6 top-6 flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition hover:bg-white/20"
        aria-label="Fechar QR gigante"
      >
        <X className="h-6 w-6" />
      </button>
      <div className="text-center">
        <p className="text-sm font-bold uppercase tracking-[0.4em] text-[#F68B1F]">
          Aponte o celular
        </p>
        <h2 className="mt-2 bg-gradient-to-r from-white via-[#FFCB05] to-[#F68B1F] bg-clip-text text-5xl font-black text-transparent md:text-7xl">
          Entrar na sala agora
        </h2>
      </div>
      <div className="mt-10 rounded-3xl bg-white p-8 shadow-2xl shadow-[#A6193C]/40">
        {joinUrl && <QRCodeSVG value={joinUrl} size={520} level="M" />}
      </div>
      <code className="mt-6 max-w-[80vw] truncate rounded-lg bg-white/10 px-4 py-2 text-base font-mono text-white">
        {joinUrl}
      </code>
    </div>
  );
}