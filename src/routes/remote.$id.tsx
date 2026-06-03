import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Trophy,
  Users,
  Target,
  LayoutDashboard,
  ShieldAlert,
  ShieldX,
  Sparkles,
  Play,
  Pause,
  Clock,
} from "lucide-react";


import { supabase } from "@/integrations/supabase/client";
import { haptic } from "@/hooks/use-haptic";
import { useRemoteBridge } from "@/hooks/use-remote-bridge";
import { useWebRTCTunnel } from "@/hooks/use-webrtc-tunnel";
import { NetworkStatusBadge, NetworkFallbackBanner } from "@/components/network-status-badge";
import {
  heartbeatRemote,
  loadStoredRemote,
  clearStoredRemote,
  type StoredRemote,
} from "@/lib/session-remotes";
import { RemoteDrawer } from "@/components/remote-drawer";
import { toast } from "sonner";

export const Route = createFileRoute("/remote/$id")({
  head: () => ({ meta: [{ title: "Controle Remoto — QuizBini" }] }),
  component: RemoteControl,
});

type Question = {
  id: string;
  question_text: string;
  slide_number: number;
  display_mode: string;
  time_limit?: number;
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
  const [authStatus, setAuthStatus] = useState<"pending" | "authorized" | "denied" | null>(null);

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
    if (authStatus !== "authorized") {
      toast.error("Aguardando autorização do palestrante.");
      return Promise.resolve(false);
    }
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

  // === Autorização: observa o status deste controle remoto em tempo real ===
  useEffect(() => {
    if (!stored?.remoteId) return;
    let cancelled = false;
    async function load() {
      const { data } = await supabase
        .from("session_remotes")
        .select("status")
        .eq("id", stored!.remoteId)
        .maybeSingle();
      if (cancelled) return;
      const next = ((data as any)?.status ?? null) as
        | "pending"
        | "authorized"
        | "denied"
        | null;
      setAuthStatus((prev) => {
        if (prev !== "authorized" && next === "authorized") {
          haptic(80);
          toast.success("Controle autorizado pelo palestrante!");
        }
        if (prev === "authorized" && next !== "authorized") {
          toast.warning("Sua autorização foi revogada.");
        }
        return next;
      });
    }
    load();
    const ch = supabase
      .channel(`remote-auth-self-${stored.remoteId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "session_remotes",
          filter: `id=eq.${stored.remoteId}`,
        },
        () => load(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
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
  const remaining = (() => {
    if (!activeQuestion || session?.question_revealed) return null;
    if (session?.question_expires_at) {
      const ms = new Date(session.question_expires_at).getTime() - now;
      return Math.max(0, Math.ceil(ms / 1000));
    }
    if (!session?.question_started_at) return null;
    const lim = activeQuestion.time_limit && activeQuestion.time_limit > 0
      ? activeQuestion.time_limit
      : timeLimit;
    const elapsed = Math.floor((now - new Date(session.question_started_at).getTime()) / 1000);
    return Math.max(0, lim - elapsed);
  })();

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
            question_expires_at: null,
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
      // Pergunta ativa persiste em mudanças de slide (timer roda no servidor).
      const patch: any = {
        current_slide: next,
      };
      if (q && !alreadyFired && q.display_mode === "simultaneous") {
        const lim = q.time_limit && q.time_limit > 0
          ? q.time_limit
          : presentation?.default_time_limit ?? 30;
        patch.active_question_id = q.id;
        patch.question_started_at = new Date().toISOString();
        patch.question_expires_at = new Date(Date.now() + lim * 1000).toISOString();
        patch.question_revealed = false;
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
      // Voltar slide preserva pergunta ativa — o timer continua no servidor.
      await supabase
        .from("sessions")
        .update({ current_slide: prev })
        .eq("id", id);
    });
  }

  async function toggleSessionFlag(
    field: "show_join_qr" | "show_ranking" | "show_sidebar" | "show_pair_qr",
  ) {
    const next = !session?.[field];
    const { error } = await (supabase.from("sessions") as any)
      .update({ [field]: next })
      .eq("id", id);
    if (error) toast.error("Falha ao atualizar a projeção.");
  }

  async function toggleGiantQr() {
    haptic(40);
    const next = !session?.show_join_qr;
    const action = next ? "SHOW_GIANT_QR" : "HIDE_GIANT_QR";
    // Túnel P2P primeiro, broadcast em paralelo como garantia.
    sendCommand(action);
    bridge.send(action as any).catch(() => {});
    // Atualização otimista via banco — o projetor escuta `sessions`
    // e a UI do celular reflete o mesmo `session.show_join_qr`.
    await (supabase.from("sessions") as any)
      .update({ show_join_qr: next })
      .eq("id", id);
    toast.success(next ? "QR Gigante exibido no projetor!" : "QR Gigante ocultado.");
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
          question_expires_at: null,
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
      <NetworkFallbackBanner transport={tunnel.transport} />
      {authStatus !== "authorized" && (
        <AuthorizationGate
          status={authStatus}
          name={stored?.name ?? ""}
          onLeave={() => {
            if (stored?.remoteId) clearStoredRemote(id);
            navigate({ to: "/remote/$id/join", params: { id }, replace: true });
          }}
        />
      )}
      {bridge.status !== "connected" && (
        <div className="shrink-0 bg-[#F68B1F] px-3 py-1 text-center text-[11px] font-bold uppercase tracking-wide text-black animate-pulse">
          Reconectando ao projetor...
        </div>
      )}
      {/* Cabeçalho: identidade do slot + status de pareamento */}
      <header className="sticky top-0 z-10 shrink-0 border-b border-[#262D3D] bg-[#131722]/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <Link
            to="/dashboard"
            aria-label="Painel de Controle"
            className="flex shrink-0 items-center gap-1 rounded-md border border-[#3A4255] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF] transition-colors hover:border-[#9CA3AF] hover:text-white"
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            Painel
          </Link>
          <div className="min-w-0 flex-1 px-2 text-center">
            <h1 className="truncate text-[12px] font-bold leading-tight text-white">
              {presentation.title}
            </h1>
            <p className="truncate text-[10px] text-[#9CA3AF]">
              Slide {currentSlide} de {totalSlides}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <NetworkStatusBadge transport={tunnel.transport} compact />
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
              ? "Sincronizado"
              : bridge.status === "connected"
              ? "Aguardando"
              : "Sem conexão"}
            </div>
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-end gap-1.5 text-[11px] text-[#9CA3AF]">
          <Users className="h-3.5 w-3.5 text-[#07A684]" />
          <span className="font-semibold text-white">{participantsCount}</span> usuários online
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col p-3">
        {/* Espaço flexível */}
        <div className="min-h-2 flex-1" />

        {/* RODAPÉ DE CONTROLE — Avançar (herói) + Voltar */}
        <div className="shrink-0 space-y-2.5 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
          {/* DRAWER de outras funcionalidades (F11, QR, ranking, sidebar, encerrar) */}
          <RemoteDrawer
            showRanking={!!session?.show_ranking}
            onToggleRanking={() => toggleSessionFlag("show_ranking")}
            showGiantQr={!!session?.show_join_qr}
            onToggleGiantQr={toggleGiantQr}
            onEndSession={exitToHub}
          />

          {/* Trava de Segurança IA: Liberar Início */}
          {session?.mode === "ai" && !session?.is_ready && (
            <button
              type="button"
              onClick={async () => {
                setBusy(true);
                try {
                  const { error } = await supabase
                    .from("sessions")
                    .update({ 
                      is_ready: true,
                      status: 'live' 
                    })
                    .eq("id", id);
                  if (error) toast.error("Falha ao liberar início.");
                  else {
                    haptic(100);
                    toast.success("Palestra iniciada!");
                  }
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
              className="relative flex h-[84px] w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl border-0 bg-gradient-to-r from-[#F68B1F] to-[#A6193C] text-white shadow-xl shadow-[#F68B1F]/30 transition-all duration-100 active:scale-[0.98] disabled:opacity-60"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 animate-pulse" />
                <span className="text-lg font-black uppercase tracking-widest">Iniciar Palestra AGORA</span>
              </div>
              <span className="text-[10px] font-bold opacity-80">LIBERAR ÁUDIO E SLIDES DA IA</span>
            </button>
          )}

          {/* APONTADOR LASER — toggle */}

          <button
            type="button"
            onClick={toggleLaser}
            aria-pressed={laserOn}
            aria-label="Apontador Laser"
            className={`flex h-16 w-full items-center gap-3 rounded-2xl border px-4 text-left text-sm font-bold shadow-md transition-all duration-100 active:scale-[0.98] ${
              laserOn
                ? "border-[#A6193C] bg-red-500/10 text-white shadow-[0_0_24px_-4px_rgba(166,25,60,0.55)]"
                : "border-[#262D3D] bg-[#161A23] text-white"
            }`}
          >
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                laserOn
                  ? "border-[#A6193C]/60 bg-[#A6193C]/30 text-white"
                  : "border-[#262D3D] bg-[#0E1015] text-red-400"
              }`}
            >
              <Target className={`h-5 w-5 ${laserOn ? "animate-pulse" : ""}`} />
            </span>
            <span className="flex-1">
              <span className="block text-base font-extrabold">
                {laserOn ? (
                  <>
                    <span className="animate-pulse">🔴</span> Laser Ativo
                  </>
                ) : (
                  "Apontador Laser 🔴"
                )}
              </span>
              <span className={`block text-[11px] font-medium ${laserOn ? "text-red-200" : "text-[#9CA3AF]"}`}>
                {laserOn ? "Mova o celular para mirar" : "Toque para ativar o ponteiro"}
              </span>
            </span>
          </button>

          {/* PILHA VERTICAL — AVANÇAR (topo) + VOLTAR (base) */}
          <div className="flex w-full flex-col gap-2.5">
            <button
              type="button"
              onClick={nextSlide}
              disabled={busy}
              aria-label="Avançar"
              className="relative flex h-[72px] w-full items-center justify-center gap-2 overflow-hidden rounded-2xl border-0 bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-lg font-black uppercase tracking-wide text-white shadow-lg shadow-orange-500/20 transition-all duration-100 active:scale-[0.98] active:from-[#8E1432] active:to-[#D87412] disabled:opacity-60"
            >
              AVANÇAR
              <ChevronRight className="h-7 w-7" strokeWidth={3} />
            </button>
            <button
              type="button"
              onClick={prevSlide}
              disabled={busy || currentSlide <= 1}
              aria-label="Voltar"
              className="flex h-[64px] w-full items-center justify-center gap-2 rounded-2xl border border-[#262D3D] bg-[#1E2235] text-base font-bold uppercase tracking-wide text-gray-200 shadow-md transition-all duration-100 active:scale-[0.98] active:bg-[#161A23] disabled:opacity-40"
            >
              <ChevronLeft className="h-6 w-6" strokeWidth={2.5} /> VOLTAR
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * Overlay de tela cheia exibido enquanto o controle remoto NÃO está
 * autorizado. Cobre toda a tela e bloqueia o uso dos botões abaixo.
 */
function AuthorizationGate({
  status,
  name,
  onLeave,
}: {
  status: "pending" | "authorized" | "denied" | null;
  name: string;
  onLeave: () => void;
}) {
  const denied = status === "denied";
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-[#0E1015]/95 px-6 text-center text-white backdrop-blur">
      <div
        className={`flex h-20 w-20 items-center justify-center rounded-3xl ${
          denied
            ? "bg-red-600/20 text-red-300"
            : "bg-gradient-to-br from-[#A6193C] to-[#F68B1F] text-white"
        }`}
      >
        {denied ? <ShieldX className="h-10 w-10" /> : <ShieldAlert className="h-10 w-10 animate-pulse" />}
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-black tracking-tight">
          {denied
            ? "Acesso negado pelo palestrante"
            : status === "pending"
            ? "Aguardando autorização"
            : "Verificando autorização..."}
        </h1>
        <p className="max-w-sm text-sm text-[#9CA3AF]">
          {denied
            ? "Sua solicitação foi recusada. Fale com o palestrante se isso foi um engano."
            : "Sua solicitação foi enviada ao Painel de Controle do palestrante. Assim que ele autorizar, este aparelho assume o controle automaticamente."}
        </p>
        {name && (
          <p className="text-xs text-[#6B7280]">
            Identificado como <span className="font-semibold text-white">{name}</span>
          </p>
        )}
      </div>
      {!denied && <Loader2 className="h-6 w-6 animate-spin text-[#F68B1F]" />}
      <button
        type="button"
        onClick={onLeave}
        className="mt-2 rounded-xl border border-[#3A4255] px-5 py-2 text-xs font-bold uppercase tracking-wide text-[#9CA3AF] transition hover:border-white hover:text-white"
      >
        {denied ? "Tentar novamente" : "Cancelar solicitação"}
      </button>
    </div>
  );
}