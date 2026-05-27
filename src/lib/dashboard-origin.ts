const KEY = "quizpulse:last_dashboard_page";

/**
 * Guarda a rota exata em que o palestrante estava antes de abrir uma
 * apresentação. Usado para que o botão "Encerrar" volte para o mesmo
 * lugar (Dashboard, página do evento, etc.).
 */
export function rememberDashboardOrigin(path?: string) {
  try {
    const url =
      path ??
      (typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : "/dashboard");
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(KEY, url);
    }
  } catch {
    /* ignora */
  }
}

/** Recupera (e limpa) a rota salva. Retorna "/dashboard" como fallback. */
export function consumeDashboardOrigin(): string {
  try {
    if (typeof window === "undefined") return "/dashboard";
    const v = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    return v && v.startsWith("/") ? v : "/dashboard";
  } catch {
    return "/dashboard";
  }
}