import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Trophy,
  Users,
  Crosshair,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { haptic } from "@/hooks/use-haptic";
import { useRemoteBridge } from "@/hooks/use-remote-bridge";
import { useWebRTCTunnel } from "@/hooks/use-webrtc-tunnel";
import { NetworkStatusBadge, NetworkFallbackBanner } from "@/components/network-status-badge";
import {
  heartbeatRemote,
  loadStoredRemote,
  type StoredRemote,
} from "@/lib/session-remotes";
import { RemoteDrawer } from "@/components/remote-drawer";
import { toast } from "sonner";

export const Route = createFileRoute("/remote/$id")({
  head: () => ({ meta: [{ title: "Controle Remoto — QuizPulse" }] }),
  component: RemoteControl,
});

type Question = {
  id: string;
  question_text: string;
  slide_number: number;
  display_mode: string;
  is_prize_question?: boolean;
  prize_multiplier?: number;
};

function RemoteControl() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [stored, setStored] = useState<StoredRemote | null>(null);
  const [session, setSession] = useState<any>(null);
  const [presentation, setPresentation] = useState<{
    title: string;
    default_time_limit: number;
    event_id: string | null;
    event_title?: string | null;
  } | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [participantsCount, setParticipantsCount] = useState(0);
  const [answersCount, setAnswersCount] = useState(0);
  const [now, setNow] = useState<number>(() => Date.now());
  const [busy, setBusy] = useState(false);

  // Ponte de tempo real (Broadcast) entre celular e projetor.
  const bridge = useRemoteBridge({ sessionId: id, role: "remote" });

  // Túnel WebRTC P2P (latência zero quando na mesma rede local).
  const tunnel = useWebRTCTunnel({
    sessionId: id,
    slot: (stored?.slot as 1 | 2) ?? 1,
    role: "guest",
    enabled: !!stored?.slot,
  });

  /**
   * Envia um comando preferencialmente pelo túnel P2P (instantâneo);
   * se indisponível, cai automaticamente no broadcast da nuvem.
   */
  function sendCommand(action: string, extra?: Record<string, any>) {
    const payload = { action, ts: Date.now(), from: stored?.slot ?? 0, ...(extra ?? {}) };
    const viaP2P = tunnel.transport === "p2p" ? tunnel.send(payload) : false;
    if (viaP2P) return Promise.resolve(true);
    return bridge.send(action as any, extra);
  }

  // === Identidade do controle (slot 1 ou 2) — exige cadastro prévio em /join ===
  useEffect(() => {
    const s = loadStoredRemote(id);
    if (!s) {
      navigate({ to: "/remote/$id/join", params: { id }, replace: true });
      return;
    }
    setStored(s);
  }, [id, navigate]);

  // Heartbeat para manter o slot vivo (20s).
  useEffect(() => {
    if (!stored?.remoteId) return;
    const tick = () => heartbeatRemote(stored.remoteId).catch(() => {});
    tick();
    const t = window.setInterval(tick, 20000);
    return () => window.clearInterval(t);
  }, [stored?.remoteId]);

  // === PERSISTÊNCIA: salva a última sessão ativa para auto-reconectar ===
  useEffect(() => {
    try {
      localStorage.setItem("quizpulse:last-session", id);
    } catch {
      /* ignora */
    }
  }, [id]);

  // === WAKE LOCK: evita que a tela do celular apague durante a palestra ===
  useEffect(() => {
    let wakeLock: any = null;
    let cancelled = false;
    async function request() {
      try {
        const wl = (navigator as any).wakeLock;
        if (!wl?.request) return;
        wakeLock = await wl.request("screen");
        if (cancelled) {
          try {
            await wakeLock.release();
          } catch {
            /* ignora */
          }
        }
      } catch (e) {
        console.warn("[wake-lock] Não foi possível ativar:", e);
      }
    }
    request();
    function onVisibility() {
      if (document.visibilityState === "visible" && !wakeLock) request();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (wakeLock) {
        try {
          wakeLock.release();
        } catch {
          /* ignora */
        }
      }
    };
  }, []);

  // === APONTADOR LASER VIRTUAL (giroscópio + acelerômetro) ===
  const [laserOn, setLaserOn] = useState(false);
  // Calibração Relativa Dinâmica (Zero Central)
  const baseBetaRef = useRef<number | null>(null);
  const baseGammaRef = useRef<number | null>(null);
  const SENSITIVIDADE = 2.5;

  const recalibrarMira = useCallback(() => {
    baseBetaRef.current = null;
    baseGammaRef.current = null;
    console.log("[laser] Mira recentralizada — capturando nova referência.");
  }, []);

  useEffect(() => {
    if (!laserOn) {
      // Avisa o projetor para apagar o ponto, se a ponte estiver conectada.
      if (bridge.status === "connected") {
        bridge.send("LASER_OFF").catch(() => {
          /* ignora */
        });
      }
      baseBetaRef.current = null;
      baseGammaRef.current = null;
      return;
    }
    let lastSent = 0;
    function handleOrientation(event: DeviceOrientationEvent) {
      const now = Date.now();
      if (now - lastSent < 40) return; // ~25 FPS
      const { beta, gamma } = event;
      if (beta === null || gamma === null) return;
      // Primeira leitura (ou após recalibrar): define o centro (50%, 50%).
      if (baseBetaRef.current === null || baseGammaRef.current === null) {
        baseBetaRef.current = beta;
        baseGammaRef.current = gamma;
        return;
      }
      let deltaX = gamma - baseGammaRef.current;
      let deltaY = beta - baseBetaRef.current;
      // Normaliza giros extremos
      if (deltaX > 180) deltaX -= 360;
      if (deltaX < -180) deltaX += 360;
      if (deltaY > 180) deltaY -= 360;
      if (deltaY < -180) deltaY += 360;
      const xPercent = Math.max(0, Math.min(100, 50 + deltaX * SENSITIVIDADE));
      // Inclinar para frente (beta aumenta) → laser sobe
      const yPercent = Math.max(0, Math.min(100, 50 - deltaY * SENSITIVIDADE));
      bridge.send("LASER", { x: xPercent, y: yPercent }).catch(() => {
        /* ignora */
      });
      lastSent = now;
    }
    window.addEventListener("deviceorientation", handleOrientation);
    return () => {
      window.removeEventListener("deviceorientation", handleOrientation);
    };
  }, [laserOn, bridge]);

  async function toggleLaser() {
    haptic(35);
    if (laserOn) {
      setLaserOn(false);
      return;
    }
    // Permissão iOS 13+ para sensores
    try {
      const DOE: any = (window as any).DeviceOrientationEvent;
      if (DOE && typeof DOE.requestPermission === "function") {
        const res = await DOE.requestPermission();
        if (res !== "granted") {
          toast.error("Permissão de sensores negada no celular.");
          return;
        }
      }
    } catch (e) {
      console.warn("[laser] Sensor não disponível:", e);
      toast.error("Sensores de movimento indisponíveis neste celular.");
      return;
    }
    setLaserOn(true);
    toast.success("Apontador laser ativado!");
  }

  // Carrega sessão, apresentação, perguntas e contagem de participantes
  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      const { data: s } = await supabase.from("sessions").select("*").eq("id", id).single();
      if (cancelled) return;
      setSession(s);
      if (s) {
        const { data: p } = await (supabase.from("presentations") as any)
          .select("title, default_time_limit, event_id")
          .eq("id", s.presentation_id)
          .single();
        if (!cancelled && p) {
          let eventTitle: string | null = null;
          if (p.event_id) {
            const { data: ev } = await (supabase.from("events") as any)
              .select("title")
              .eq("id", p.event_id)
              .maybeSingle();
            eventTitle = ev?.title ?? null;
          }
          setPresentation({
            title: p.title,
            default_time_limit: p.default_time_limit ?? 30,
            event_id: p.event_id ?? null,
            event_title: eventTitle,
          });
        }
        const { data: qs } = await supabase
          .from("questions")
          .select("id, question_text, slide_number, display_mode, is_prize_question, prize_multiplier")
          .eq("presentation_id", s.presentation_id)
          .order("position");
        if (!cancelled) setQuestions((qs as any) || []);
      }
      const { count } = await supabase
        .from("participants")
        .select("id", { count: "exact", head: true })
        .eq("session_id", id);
      if (!cancelled) setParticipantsCount(count ?? 0);
    }
    loadAll();
    const ch = supabase
      .channel(`remote-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sessions", filter: `id=eq.${id}` },
        (payload) => setSession(payload.new),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "participants", filter: `session_id=eq.${id}` },
        async () => {
          const { count } = await supabase
            .from("participants")
            .select("id", { count: "exact", head: true })
            .eq("session_id", id);
          setParticipantsCount(count ?? 0);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "questions", filter: `presentation_id=eq.${session?.presentation_id ?? "00000000-0000-0000-0000-000000000000"}` },
        async () => {
          // refetch perguntas para refletir toggle de prêmio
          const presId = (await supabase.from("sessions").select("presentation_id").eq("id", id).single()).data?.presentation_id;
          if (!presId) return;
          const { data: qs } = await supabase
            .from("questions")
            .select("id, question_text, slide_number, display_mode, is_prize_question, prize_multiplier")
            .eq("presentation_id", presId)
            .order("position");
          setQuestions((qs as any) || []);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "answers", filter: `session_id=eq.${id}` },
        async () => {
          const activeQid = (await supabase.from("sessions").select("active_question_id").eq("id", id).single()).data?.active_question_id;
          if (!activeQid) {
            setAnswersCount(0);
            return;
          }
          const { count } = await supabase
            .from("answers")
            .select("id", { count: "exact", head: true })
            .eq("session_id", id)
            .eq("question_id", activeQid);
          setAnswersCount(count ?? 0);
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [id]);

  // Refaz a contagem de respostas quando a pergunta ativa muda
  useEffect(() => {
    const qid = session?.active_question_id;
    if (!qid) {
      setAnswersCount(0);
      return;
    }
    let cancelled = false;
    (async () => {
      const { count } = await supabase
        .from("answers")
        .select("id", { count: "exact", head: true })
        .eq("session_id", id)
        .eq("question_id", qid);
      if (!cancelled) setAnswersCount(count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.active_question_id, id]);

  // Cronômetro
  useEffect(() => {
    if (!session?.question_started_at || session?.question_revealed) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [session?.question_started_at, session?.question_revealed]);

  const currentSlide: number = session?.current_slide || 1;
  const totalSlides = useMemo(() => {
    const maxQ = questions.reduce((m, q) => Math.max(m, q.slide_number || 0), 0);
    return Math.max(maxQ, currentSlide);
  }, [questions, currentSlide]);
  const slideQuestion = useMemo(
    () => questions.find((q) => q.slide_number === currentSlide) || null,
    [questions, currentSlide],
  );
  const activeQuestion = useMemo(
    () => questions.find((q) => q.id === session?.active_question_id) || null,
    [questions, session?.active_question_id],
  );
  const isEnded = session?.status === "ended";

  const timeLimit = presentation?.default_time_limit ?? 30;
  const elapsed = session?.question_started_at
    ? Math.floor((now - new Date(session.question_started_at).getTime()) / 1000)
    : 0;
  const remaining = activeQuestion && !session?.question_revealed
    ? Math.max(0, timeLimit - elapsed)
    : null;

  async function withBusy<T>(fn: () => Promise<T>) {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  }

  async function nextSlide() {
    haptic(45);
    await withBusy(async () => {
      // 1ª tentativa — túnel WebRTC P2P (latência zero).
      // 2ª tentativa — broadcast realtime via nuvem.
      // 3ª tentativa — escrita direta no banco (fallback final).
      const sent =
        (await sendCommand("NEXT")) ||
        (bridge.status === "connected" && bridge.partnerOnline
          ? await bridge.send("NEXT")
          : false);
      if (sent) return;

      // FALLBACK (sem sinal do projetor): aplica a mesma lógica via DB.
      const { data: fresh } = await supabase
        .from("sessions")
        .select("current_slide, fired_question_ids")
        .eq("id", id)
        .single();
      const liveSlide: number = fresh?.current_slide ?? currentSlide;
      const fired: string[] = ((fresh as any)?.fired_question_ids as string[]) ?? [];
      // Pódio automático: se já estamos no último slide conhecido, encerra
      // a sessão (gatilho de revelação dramática no projetor).
      if (liveSlide >= totalSlides) {
        await supabase
          .from("sessions")
          .update({
            status: "ended",
            active_question_id: null,
            question_started_at: null,
            question_revealed: false,
          })
          .eq("id", id);
        if (session?.presentation_id) {
          await (supabase.from("presentations") as any)
            .update({ execution_status: "completed_full" })
            .eq("id", session.presentation_id);
        }
        return;
      }
      const next = liveSlide + 1;
      const q = questions.find((qq) => qq.slide_number === next) || null;
      const alreadyFired = q ? fired.includes(q.id) : false;
      const patch: any = {
        current_slide: next,
        question_revealed: false,
        active_question_id: null,
        question_started_at: null,
      };
      if (q && !alreadyFired && q.display_mode === "simultaneous") {
        patch.active_question_id = q.id;
        patch.question_started_at = new Date().toISOString();
        patch.fired_question_ids = [...fired, q.id];
      }
      await supabase.from("sessions").update(patch).eq("id", id);
    });
  }

  async function prevSlide() {
    haptic(25);
    await withBusy(async () => {
      const sent =
        (await sendCommand("PREV")) ||
        (bridge.status === "connected" && bridge.partnerOnline
          ? await bridge.send("PREV")
          : false);
      if (sent) return;
      const { data: fresh } = await supabase
        .from("sessions")
        .select("current_slide")
        .eq("id", id)
        .single();
      const liveSlide: number = fresh?.current_slide ?? currentSlide;
      const prev = Math.max(1, liveSlide - 1);
      await supabase
        .from("sessions")
        .update({
          current_slide: prev,
          question_revealed: false,
          active_question_id: null,
          question_started_at: null,
        })
        .eq("id", id);
    });
  }

  async function toggleFullscreen() {
    haptic(30);
    const next = !session?.is_fullscreen;
    sendCommand("TOGGLE_FULLSCREEN", { value: next });
    bridge.send("TOGGLE_FULLSCREEN", { value: next }).catch(() => {});
    const { error } = await (supabase.from("sessions") as any)
      .update({ is_fullscreen: next })
      .eq("id", id);
    if (error) {
      toast.error("Falha ao alternar tela cheia.");
    } else {
      toast.success(next ? "Tela cheia ativada no projetor." : "Saindo da tela cheia.");
    }
  }

  async function toggleSessionFlag(field: "show_join_qr" | "show_ranking" | "show_sidebar") {
    const next = !session?.[field];
    const { error } = await (supabase.from("sessions") as any)
      .update({ [field]: next })
      .eq("id", id);
    if (error) toast.error("Falha ao atualizar a projeção.");
  }

  async function showGiantQr() {
    haptic(40);
    // Túnel P2P primeiro, broadcast em paralelo como garantia.
    sendCommand("SHOW_GIANT_QR");
    bridge.send("SHOW_GIANT_QR" as any).catch(() => {});
    toast.success("QR Gigante exibido no projetor!");
  }

  async function exitToHub() {
    await withBusy(async () => {
      try {
        localStorage.removeItem("quizpulse:last-session");
      } catch {
        /* ignora */
      }
      // 1. Marca sessão como encerrada
      await supabase
        .from("sessions")
        .update({
          status: "ended",
          active_question_id: null,
          question_started_at: null,
          question_revealed: false,
        })
        .eq("id", id);
      if (session?.presentation_id) {
        await (supabase.from("presentations") as any)
          .update({ execution_status: "completed_partial" })
          .eq("id", session.presentation_id);
      }

      // 2. Avisa o projetor para voltar ao lobby
      if (presentation?.event_id) {
        try {
          const ch = supabase.channel(`event-lobby-${presentation.event_id}`);
          await new Promise<void>((resolve) => {
            ch.subscribe((status) => {
              if (status === "SUBSCRIBED") resolve();
            });
            window.setTimeout(() => resolve(), 600);
          });
          await ch.send({
            type: "broadcast",
            event: "return_to_lobby",
            payload: { event_id: presentation.event_id },
          });
          window.setTimeout(() => supabase.removeChannel(ch), 300);
        } catch {
          /* ignora */
        }
      }

      toast.success("Apresentação fechada. Escolha a próxima!");
      navigate({ to: "/remote" });
    });
  }

  if (!session || !presentation) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0E1015] text-white">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando controle remoto...
      </div>
    );
  }

  if (isEnded) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-gradient-to-br from-[#0E1015] via-[#1a0f1f] to-[#0E1015] p-6 text-center text-white">
        <Trophy className="h-16 w-16 animate-bounce text-[#FFCB05] drop-shadow-[0_0_24px_rgba(255,203,5,0.6)]" />
        <h1 className="text-2xl font-black uppercase tracking-wide">
          Pódio ativo na tela principal!
        </h1>
        <p className="text-sm text-[#9CA3AF]">
          Os campeões estão sendo revelados no projetor. Quando terminar, escolha a próxima apresentação.
        </p>
        <Link
          to="/remote"
          className="rounded-xl bg-gradient-to-r from-[#A6193C] to-[#F68B1F] px-6 py-3 text-sm font-bold text-white shadow-lg"
        >
          Voltar ao painel
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#0E1015] text-white">
      {bridge.status !== "connected" && (
        <div className="shrink-0 bg-[#F68B1F] px-3 py-1 text-center text-[11px] font-bold uppercase tracking-wide text-black animate-pulse">
          Reconectando ao projetor...
        </div>
      )}
      {/* Cabeçalho: identidade do slot + status de pareamento */}
      <header className="sticky top-0 z-10 shrink-0 border-b border-[#262D3D] bg-[#131722]/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-[#F68B1F]">
              Você é o Controle {stored?.slot ?? "?"}
            </p>
            <h1 className="truncate text-[13px] font-bold leading-tight text-white">
              {stored?.name ?? "—"} · {presentation.title}
            </h1>
          </div>
          <div
            className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold ${
              bridge.status === "connected" && bridge.partnerOnline
                ? "border-[#07A684]/40 bg-[#07A684]/10 text-[#07A684]"
                : bridge.status === "connected"
                ? "border-[#FFCB05]/40 bg-[#FFCB05]/10 text-[#FFCB05]"
                : "border-[#A6193C]/40 bg-[#A6193C]/10 text-[#F68B1F]"
            }`}
            aria-live="polite"
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                bridge.partnerOnline
                  ? "bg-[#07A684] animate-pulse"
                  : bridge.status === "connected"
                  ? "bg-[#FFCB05]"
                  : "bg-[#A6193C]"
              }`}
            />
            {bridge.partnerOnline
              ? "Conectado"
              : bridge.status === "connected"
              ? "Aguardando"
              : "Sem sinal"}
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-[#9CA3AF]">
          <span className="rounded bg-[#0E1015] px-2 py-0.5 font-mono text-white">
            Slide {currentSlide} de {totalSlides}
          </span>
          <span className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-[#07A684]" />
            <span className="font-semibold text-white">{participantsCount}</span> usuários
          </span>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col p-3">
        {/* Espaço flexível */}
        <div className="min-h-2 flex-1" />

        {/* RODAPÉ DE CONTROLE — Avançar (herói) + Voltar */}
        <div className="shrink-0 space-y-2.5 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
          {/* DRAWER de outras funcionalidades (F11, QR, ranking, sidebar, encerrar) */}
          <RemoteDrawer
            showJoinQr={!!session?.show_join_qr}
            showRanking={!!session?.show_ranking}
            showSidebar={!!session?.show_sidebar}
            isFullscreen={!!session?.is_fullscreen}
            onToggleFullscreen={toggleFullscreen}
            onToggleJoinQr={() => toggleSessionFlag("show_join_qr")}
            onToggleRanking={() => toggleSessionFlag("show_ranking")}
            onToggleSidebar={() => toggleSessionFlag("show_sidebar")}
            onShowGiantQr={showGiantQr}
            onEndSession={exitToHub}
          />

          {/* APONTADOR LASER — toggle */}
          <button
            type="button"
            onClick={toggleLaser}
            aria-pressed={laserOn}
            aria-label="Apontador Laser"
            className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl border text-sm font-bold transition-all duration-100 active:scale-95 ${
              laserOn
                ? "border-red-400 bg-gradient-to-r from-red-600 to-red-500 text-white shadow-[0_0_20px_-2px_rgba(239,68,68,0.7)] animate-pulse"
                : "border-[#3A4255] bg-[#1E2235] text-[#9CA3AF] hover:text-white"
            }`}
          >
            <Crosshair className={`h-5 w-5 ${laserOn ? "text-white" : "text-red-400"}`} />
            {laserOn ? "🔴 Laser Ativo — Mova o celular" : "Apontador Laser 🔴"}
          </button>

          {/* CENTRALIZAR MIRA — só aparece com o laser ativo */}
          {laserOn && (
            <button
              type="button"
              onClick={() => {
                haptic(20);
                recalibrarMira();
                toast.success("Mira centralizada! 🎯");
              }}
              aria-label="Centralizar Mira"
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-red-400/40 bg-red-500/10 text-xs font-bold text-red-300 transition-all duration-100 active:scale-95"
            >
              <Crosshair className="h-4 w-4" />
              Centralizar Mira 🎯
            </button>
          )}

          {/* BOTÃO HERÓI AVANÇAR — no último slide aciona o pódio automático */}
          <button
            type="button"
            onClick={nextSlide}
            disabled={busy}
            aria-label="Avançar"
            className="relative flex h-[48vh] min-h-[240px] w-full items-center justify-center gap-3 overflow-hidden rounded-3xl border-0 bg-gradient-to-br from-[#A6193C] via-[#D14628] to-[#F68B1F] text-white shadow-2xl shadow-[#A6193C]/50 transition-all duration-100 active:scale-95 active:from-[#8E1432] active:to-[#D87412] disabled:opacity-60"
          >
            <span className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" aria-hidden="true" />
            <div className="relative z-10 flex flex-col items-center justify-center gap-2">
              <span className="text-[44px] font-black uppercase leading-none tracking-tight drop-shadow-lg sm:text-[56px]">
                AVANÇAR
              </span>
              <ChevronRight className="h-14 w-14 drop-shadow-lg" strokeWidth={3} />
            </div>
          </button>

          {/* LINHA C: VOLTAR — base extrema */}
          <button
            type="button"
            onClick={prevSlide}
            disabled={busy || currentSlide <= 1}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#3A4255] bg-[#1E2235] text-sm font-bold text-white shadow-md transition-all duration-100 active:scale-95 active:bg-[#262D3D] disabled:opacity-40"
            aria-label="Voltar"
          >
            <ChevronLeft className="h-5 w-5" /> Voltar
          </button>
        </div>
      </main>
    </div>
  );
}