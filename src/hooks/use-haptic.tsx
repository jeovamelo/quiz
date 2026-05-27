/**
 * Haptic feedback (vibração curta) para confirmação tátil de comandos críticos
 * no celular do palestrante. Falha silenciosamente em browsers sem suporte.
 */
export function haptic(ms: number = 40) {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(ms);
    }
  } catch {
    /* ignore */
  }
}

export function useHaptic() {
  return haptic;
}