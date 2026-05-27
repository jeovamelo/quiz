import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Conteúdo do cabeçalho (alça de arraste). */
  header: ReactNode;
  /** Chave única para persistir a posição em localStorage. */
  storageKey: string;
  /** Aria-label do diálogo. */
  ariaLabel?: string;
  /** Cor de fundo do cabeçalho (faixa colorida). */
  headerBg?: string;
  /** Cor da borda do card. */
  borderColor?: string;
  /** Largura máxima do card. */
  maxWidthClass?: string;
  children: ReactNode;
};

/**
 * Frame flutuante arrastável com o mouse (drag & drop). A posição
 * é persistida em localStorage pela `storageKey`, permitindo que o
 * palestrante reabra o frame no mesmo canto onde o deixou.
 *
 * O fundo não bloqueia cliques fora do card — o slide permanece
 * interativo enquanto o frame está aberto.
 */
export function DraggableFrame({
  open,
  onClose,
  header,
  storageKey,
  ariaLabel,
  headerBg,
  borderColor = "#262D3D",
  maxWidthClass = "max-w-[540px]",
  children,
}: Props) {
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const hydratedRef = useRef(false);

  // Hidrata posição salva ao abrir.
  useEffect(() => {
    if (!open || hydratedRef.current) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw);
        if (typeof saved?.x === "number" && typeof saved?.y === "number") {
          setPosition(saved);
        }
      }
    } catch {
      /* ignore */
    }
    hydratedRef.current = true;
  }, [open, storageKey]);

  // Persiste posição.
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(position));
    } catch {
      /* ignore */
    }
  }, [position, storageKey]);

  // ESC fecha.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Listeners globais de drag.
  useEffect(() => {
    if (!isDragging) return;
    function onMove(e: MouseEvent) {
      setPosition({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      });
    }
    function onUp() {
      setIsDragging(false);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isDragging]);

  function handleMouseDown(e: React.MouseEvent) {
    // Ignora clique no botão de fechar.
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] pointer-events-none"
      role="dialog"
      aria-modal="false"
      aria-label={ariaLabel}
    >
      <div
        className={`pointer-events-auto absolute w-[min(92vw,540px)] ${maxWidthClass} overflow-hidden rounded-3xl border bg-[#161A23] shadow-2xl shadow-black/60`}
        style={{
          borderColor,
          left: "50%",
          top: "20%",
          transform: `translate(calc(-50% + ${position.x}px), ${position.y}px)`,
          transition: isDragging ? "none" : "box-shadow 150ms ease",
          boxShadow: isDragging
            ? "0 30px 80px -10px rgba(0,0,0,0.75)"
            : "0 25px 50px -12px rgba(0,0,0,0.55)",
        }}
      >
        <div
          onMouseDown={handleMouseDown}
          className={`flex items-center justify-between gap-3 px-5 py-3 select-none ${
            isDragging ? "cursor-grabbing" : "cursor-grab"
          }`}
          style={{ backgroundColor: headerBg ?? "#111420" }}
          title="Arraste para mover o frame"
        >
          <div className="min-w-0 flex-1 text-xs font-black uppercase tracking-[0.2em] text-white">
            {header}
          </div>
          <button
            type="button"
            data-no-drag
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white/90 hover:bg-white/20"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}