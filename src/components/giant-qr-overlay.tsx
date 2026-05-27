import { useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { X, Smartphone, Users } from "lucide-react";

type Variant = "remote" | "participant";

type Props = {
  open: boolean;
  joinUrl: string;
  onClose: () => void;
  /**
   * "remote"      → QR Code do Controle Remoto (palestrante). Roxo/Laranja BNB.
   * "participant" → QR Code da Plateia (jogo). Verde BNB.
   * Default: "participant" (compatível com chamadas antigas).
   */
  variant?: Variant;
};

/**
 * Frame flutuante centralizado de QR Code. Diferenciado por cor, ícone
 * central e textos conforme o público-alvo:
 *  - "participant": para a plateia entrar no jogo (Verde BNB).
 *  - "remote":      para parear o controle do apresentador (Roxo BNB).
 */
export function GiantQrOverlay({ open, joinUrl, onClose, variant = "participant" }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isRemote = variant === "remote";
  const accent = isRemote ? "#BA2172" : "#07A684"; // Roxo BNB | Verde BNB
  const headerLabel = isRemote
    ? "📱 PAREAR NOVO CONTROLE REMOTO"
    : "👥 PARTICIPE DA PALESTRA A QUALQUER MOMENTO";
  const eyebrow = isRemote ? "Exclusivo do apresentador" : "Entre a qualquer momento!";
  const title = isRemote
    ? "📱 Ativar Controle do Palco"
    : "👥 Entrar na Apresentação";
  const description = isRemote
    ? "Apenas para o apresentador ou assistentes. Escaneie para passar os slides direto do seu celular."
    : "Aponte a câmera do seu celular para o código acima para participar em tempo real!";
  const footer = isRemote
    ? "Não requer login. Digite seu nome no celular para começar."
    : "Sem senhas ou cadastros! Digite seu nome e data de nascimento no celular para acumular pontos.";
  const CenterIcon = isRemote ? Smartphone : Users;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={isRemote ? "QR Code para parear o controle remoto" : "QR Code para entrar na sala"}
    >
      <div
        className="relative w-[min(92vw,540px)] overflow-hidden rounded-3xl border bg-[#161A23] text-center shadow-2xl shadow-black/60"
        style={{ borderColor: `${accent}66` }}
      >
        {/* Faixa superior colorida — diferenciação imediata do público. */}
        <div
          className="flex items-center justify-center px-6 py-3 text-xs font-black uppercase tracking-[0.2em] text-white"
          style={{ backgroundColor: accent }}
        >
          {headerLabel}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
          aria-label="Fechar QR Code"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="px-8 pb-8 pt-6">
          <p
            className="text-[10px] font-bold uppercase tracking-[0.3em]"
            style={{ color: accent }}
          >
            {eyebrow}
          </p>
          <h2 className="mt-1 text-3xl font-black leading-tight text-white">
            {title}
          </h2>
          <p className="mt-2 text-sm text-[#C8CCD6]">{description}</p>

          {/* Moldura do QR com borda colorida + badge de canto + ícone central. */}
          <div className="relative mx-auto mt-6 inline-block">
            <div
              className="absolute -top-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white shadow-lg"
              style={{ backgroundColor: accent }}
            >
              {isRemote ? "📱 EXCLUSIVO DO APRESENTADOR" : "👥 ENTRAR NO JOGO"}
            </div>
            <div
              className="rounded-2xl bg-white p-5 shadow-xl ring-4"
              style={{ boxShadow: `0 0 0 4px ${accent}` }}
            >
              {joinUrl && (
                <div className="relative">
                  <QRCodeSVG value={joinUrl} size={300} level="H" />
                  {/* Logo overlay centralizado — indica a função do código. */}
                  <div
                    className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-4 border-white text-white shadow-xl"
                    style={{ backgroundColor: accent }}
                  >
                    <CenterIcon className="h-6 w-6" />
                  </div>
                </div>
              )}
            </div>
          </div>

          <p className="mt-5 text-xs font-semibold text-[#9CA3AF]">{footer}</p>
          <code className="mx-auto mt-3 block max-w-full truncate rounded-lg bg-[#0E1015] px-3 py-2 text-[11px] font-mono text-[#9CA3AF]">
            {joinUrl}
          </code>
        </div>
      </div>
    </div>
  );
}