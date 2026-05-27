import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useRequireSpeaker } from "@/hooks/use-auth";
import { Loader2, Maximize, Tv, Smartphone, QrCode } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import confetti from "canvas-confetti";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { sortRanking, type ParticipantRow } from "@/lib/ranking";
import { toast } from "sonner";
import { useRemoteBridge } from "@/hooks/use-remote-bridge";
import { useWebRTCTunnel } from "@/hooks/use-webrtc-tunnel";
import { GiantQrOverlay } from "@/components/giant-qr-overlay";
import { RankingOverlay } from "@/components/ranking-overlay";
import { consumeDashboardOrigin } from "@/lib/dashboard-origin";

type Question = {
  id: string;
  question_text: string;
  question_type: string;
  options: Record<string, string>;
  correct_option: string;
  slide_number: number;
  display_mode: string;
  time_limit: number;
  is_prize_question?: boolean;
  prize_multiplier?: number;
};

export function Present() {
  useRequireSpeaker();
  const { id } = useParams({ from: "/present/$id" });
  const navigate = useNavigate();
  const [session, setSession] = useState<any>(null);
  const [presentation, setPresentation] = useState<{ file_url: string; title: string; event_id: string | null; default_time_limit: number } | null>(null);
  const [nextPresentationId, setNextPresentationId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [answers, setAnswers] = useState<Array<{ question_id: string; selected_option: string; participant_id: string }>>([]);
  const [now, setNow] = useState(Date.now());
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [joinUrl, setJoinUrl] = useState("");
  const confettiFiredRef = useRef(false);
  const [projectorActivated, setProjectorActivated] = useState(false);
  const fullscreenAppliedRef = useRef<boolean | null>(null);
  // Máquina de estados de abertura do projetor:
  //   esperando_controle   → mostra apenas o QR do Controle Remoto
  //   esperando_participantes → mostra apenas o QR da plateia (Lobby)
  //   apresentando_slides  → status === 'live'; nenhum overlay de lobby
  // `pairFlowDone` marca que o palestrante já pareou OU fechou o QR
  // do controle manualmente (X/Esc), liberando a transição para o
  // QR de participantes.
  const [pairFlowDone, setPairFlowDone] = useState(false);
  const [remotesCount, setRemotesCount] = useState(0);
  // Frames flutuantes — agora sincronizados pelas colunas booleanas da
  // sessão (show_join_qr, show_ranking, show_pair_qr). Isso garante
  // sincronia bidirecional automática entre celular, projetor e Console
  // do Operador no desktop.
  const giantQrOpen = !!session?.show_join_qr;
  const rankingOpen = !!session?.show_ranking;
  const pairQrOpen = !!(session as any)?.show_pair_qr;
  const pairUrl = typeof window !== "undefined" ? `${window.location.origin}/remote-setup/${id}` : "";
  const questionsRef = useRef<Question[]>([]);
  useEffect(() => { questionsRef.current = questions; }, [questions]);

  // Helper: persiste o estado de um overlay no banco. Como o projetor e
  // todos os controles (celular + Console do Operador) escutam o canal
  // `postgres_changes` desta sessão, a sincronia bidirecional acontece
  // automaticamente sem precisar de novos broadcasts.
  async function setOverlayFlag(
    field: "show_join_qr" | "show_ranking" | "show_pair_qr",
    value: boolean,
  ) {
    await (supabase.from("sessions") as any)
      .update({ [field]: value })
      .eq("id", id);
  }

  // Ref para a função mestre de avanço — garante uso de estado fresco em
  // qualquer gatilho (clique no slide, teclado, broadcast do celular).
  const handleMasterAdvanceRef = useRef<() => Promise<void>>(async () => {});

  // === APONTADOR LASER recebido do celular ===
  const [laserCoords, setLaserCoords] = useState<{ x: number; y: number } | null>(null);
  const laserTimerRef = useRef<number | null>(null);
  const laserTargetRef = useRef<{ x: number; y: number } | null>(null);
  const laserRafRef = useRef<number | null>(null);

  // Loop de suavização (Lerp 15%) para amortecer tremores naturais da mão.
  useEffect(() => {
    function tick() {
      const target = laserTargetRef.current;
      if (target) {
        setLaserCoords((prev) => {
          if (!prev) return target;
          const dx = target.x - prev.x;
          const dy = target.y - prev.y;
          if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) return prev;
          return { x: prev.x + dx * 0.15, y: prev.y + dy * 0.15 };
        });
      }
      laserRafRef.current = window.requestAnimationFrame(tick);
    }
    laserRafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (laserRafRef.current) window.cancelAnimationFrame(laserRafRef.current);
    };
  }, []);

  useEffect(() => {
    setJoinUrl(`${window.location.origin}/join?session=${id}`);
  }, [id]);

  // === Ponte de tempo real com o celular (Broadcast com heartbeat) ===
  const bridge = useRemoteBridge({
    sessionId: id,
    role: "projector",
    onAction: async (action, payload) => {
      // === LASER: mais frequente — trate antes do fetch ao banco. ===
      if (action === "LASER") {
        const x = Number(payload?.x);
        const y = Number(payload?.y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          laserTargetRef.current = { x, y };
          if (laserTimerRef.current) window.clearTimeout(laserTimerRef.current);
          // Fadeout suave: some após 1.5s sem novas coordenadas.
          laserTimerRef.current = window.setTimeout(() => {
            laserTargetRef.current = null;
            setLaserCoords(null);
          }, 1500);
        }
        return;
      }
      if (action === "LASER_OFF") {
        if (laserTimerRef.current) window.clearTimeout(laserTimerRef.current);
        laserTargetRef.current = null;
        setLaserCoords(null);
        return;
      }

      // Overlays — agora persistidos como colunas booleanas em `sessions`
      // para sincronia bidirecional natural entre celular, projetor e
      // Console do Operador. O projetor reage via postgres_changes.
      if (action === "SHOW_GIANT_QR")  { await setOverlayFlag("show_join_qr", true);   return; }
      if (action === "HIDE_GIANT_QR")  { await setOverlayFlag("show_join_qr", false);  return; }
      if (action === "TOGGLE_GIANT_QR"){ await setOverlayFlag("show_join_qr", !giantQrOpen); return; }
      if (action === "SHOW_RANKING")   { await setOverlayFlag("show_ranking", true);   return; }
      if (action === "HIDE_RANKING")   { await setOverlayFlag("show_ranking", false);  return; }
      if (action === "TOGGLE_RANKING") { await setOverlayFlag("show_ranking", !rankingOpen); return; }
      if (action === "SHOW_PAIR_QR")   { await setOverlayFlag("show_pair_qr", true);   return; }
      if (action === "HIDE_PAIR_QR")   { await setOverlayFlag("show_pair_qr", false);  return; }
      if (action === "TOGGLE_PAIR_QR") { await setOverlayFlag("show_pair_qr", !pairQrOpen); return; }
      if (action === "END_EARLY") {
        await endSession(false);
        return;
      }

      // Re-busca o estado mais recente para evitar usar React state desatualizado.
      const { data: fresh } = await supabase
        .from("sessions")
        .select("current_slide, active_question_id, question_revealed, is_fullscreen, fired_question_ids")
        .eq("id", id)
        .single();
      const liveSlide: number = fresh?.current_slide ?? 1;

      if (action === "NEXT") {
        // Clique virtual do celular = mesmo comportamento do clique do mouse
        // no slide. Toda a lógica vive em handleMasterAdvance no computador.
        console.log("Clique remoto recebido do celular. Avançando apresentação...");
        await handleMasterAdvanceRef.current();
      } else if (action === "PREV") {
        await setSlide(Math.max(1, liveSlide - 1), { direction: "prev" });
      } else if (action === "TOGGLE_FULLSCREEN") {
        const nextVal = !fresh?.is_fullscreen;
        await (supabase.from("sessions") as any)
          .update({ is_fullscreen: nextVal })
          .eq("id", id);
      } else if (action === "SHOW_PODIUM") {
        await setOverlayFlag("show_ranking", true);
        const liveActive = questionsRef.current.find((q) => q.id === fresh?.active_question_id) || null;
        const liveRevealed: boolean = !!fresh?.question_revealed;
        if (liveActive && !liveRevealed) {
          await supabase.from("sessions").update({ question_revealed: true }).eq("id", id);
        }
      }
    },
  });

  // === Túneis WebRTC P2P (1 por slot) — host. ===
  // Quando algum DataChannel está aberto, exibimos badge verde.
  function handleTunnelMessage(msg: any) {
    if (!msg || typeof msg !== "object") return;
    const action = msg.action as string | undefined;
    if (!action) return;
    // Reaproveita o handler do bridge (single source of truth).
    bridgeOnActionRef.current?.(action as any, msg);
  }
  const bridgeOnActionRef = useRef<typeof bridge.send extends never ? never : ((a: any, p: any) => void) | null>(null);
  // Captura uma referência ao mesmo onAction passado ao bridge para reuso.
  useEffect(() => {
    bridgeOnActionRef.current = async (action: any, payload: any) => {
      // Re-emite via mesma ponte handler (chamada direta seria mais limpa,
      // mas mantemos um pequeno proxy para reutilizar a lógica completa).
      const evt = new CustomEvent("present:remote-action", { detail: { action, payload } });
      window.dispatchEvent(evt);
    };
  }, []);
  // Escuta o evento sintético e roteia para o mesmo onAction.
  useEffect(() => {
    function onEvt(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (!detail?.action) return;
      const action = detail.action as string;
      const payload = detail.payload ?? {};
      // Reaplica a mesma lógica do bridge.onAction.
      if (action === "SHOW_GIANT_QR")  { setOverlayFlag("show_join_qr", true);   return; }
      if (action === "HIDE_GIANT_QR")  { setOverlayFlag("show_join_qr", false);  return; }
      if (action === "TOGGLE_GIANT_QR"){ setOverlayFlag("show_join_qr", !giantQrOpen); return; }
      if (action === "SHOW_RANKING")   { setOverlayFlag("show_ranking", true);   return; }
      if (action === "HIDE_RANKING")   { setOverlayFlag("show_ranking", false);  return; }
      if (action === "TOGGLE_RANKING") { setOverlayFlag("show_ranking", !rankingOpen); return; }
      if (action === "SHOW_PAIR_QR")   { setOverlayFlag("show_pair_qr", true);   return; }
      if (action === "HIDE_PAIR_QR")   { setOverlayFlag("show_pair_qr", false);  return; }
      if (action === "TOGGLE_PAIR_QR") { setOverlayFlag("show_pair_qr", !pairQrOpen); return; }
      if (action === "END_EARLY") {
        (async () => { await endSession(false); })();
        return;
      }
      if (action === "NEXT") {
        handleMasterAdvanceRef.current();
        return;
      }
      if (action === "PREV") {
        (async () => {
          const { data: fresh } = await supabase
            .from("sessions")
            .select("current_slide")
            .eq("id", id)
            .single();
          const ls = (fresh as any)?.current_slide ?? 1;
          await setSlide(Math.max(1, ls - 1), { direction: "prev" });
        })();
        return;
      }
      if (action === "TOGGLE_FULLSCREEN") {
        (async () => {
          const { data: fresh } = await supabase
            .from("sessions")
            .select("is_fullscreen")
            .eq("id", id)
            .single();
          await (supabase.from("sessions") as any)
            .update({ is_fullscreen: !(fresh as any)?.is_fullscreen })
            .eq("id", id);
        })();
        return;
      }
    }
    window.addEventListener("present:remote-action", onEvt as any);
    return () => window.removeEventListener("present:remote-action", onEvt as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useWebRTCTunnel({ sessionId: id, slot: 1, role: "host", onMessage: handleTunnelMessage });

  // Sincroniza o pedido remoto de tela cheia (vindo do celular do palestrante)
  useEffect(() => {
    if (!projectorActivated) return;
    const wants = !!session?.is_fullscreen;
    if (fullscreenAppliedRef.current === wants) return;
    try {
      if (wants) {
        const el = document.documentElement as any;
        const req =
          el.requestFullscreen ||
          el.webkitRequestFullscreen ||
          el.msRequestFullscreen;
        if (req && !document.fullscreenElement) {
          req.call(el)?.catch?.(() => {
            /* navegador pode bloquear sem gesto recente */
          });
        }
      } else {
        const doc = document as any;
        const exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen;
        if (exit && document.fullscreenElement) {
          exit.call(doc)?.catch?.(() => {});
        }
      }
      fullscreenAppliedRef.current = wants;
    } catch {
      /* ignora */
    }
  }, [session?.is_fullscreen, projectorActivated]);

  // Mantém o estado sincronizado se o usuário sair da tela cheia pelo ESC
  useEffect(() => {
    function onChange() {
      const isFs = !!document.fullscreenElement;
      fullscreenAppliedRef.current = isFs;
      if (!isFs && session?.is_fullscreen) {
        // Usuário saiu manualmente — espelha no banco
        (supabase.from("sessions") as any)
          .update({ is_fullscreen: false })
          .eq("id", id);
      }
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [id, session?.is_fullscreen]);

  // tick
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // load + realtime
  useEffect(() => {
    async function load() {
      const { data: s } = await supabase.from("sessions").select("*").eq("id", id).single();
      setSession(s);
      if (s) {
        const { data: p } = await supabase
          .from("presentations")
          .select("file_url, title, event_id, sort_order, default_time_limit")
          .eq("id", s.presentation_id)
          .single();
        if (p) {
          setPresentation({
            file_url: p.file_url,
            title: p.title,
            event_id: (p as any).event_id ?? null,
            default_time_limit: (p as any).default_time_limit ?? 30,
          });
          // Buscar próxima apresentação do mesmo evento (sort_order > atual)
          if ((p as any).event_id) {
            const { data: nextList } = await (supabase.from("presentations") as any)
              .select("id, sort_order")
              .eq("event_id", (p as any).event_id)
              .gt("sort_order", (p as any).sort_order ?? 0)
              .order("sort_order", { ascending: true })
              .limit(1);
            setNextPresentationId(nextList && nextList.length > 0 ? nextList[0].id : null);
          }
        }
        const { data: qs } = await supabase
          .from("questions")
          .select("*")
          .eq("presentation_id", s.presentation_id)
          .order("position");
        setQuestions((qs as any) || []);
      }
      const { data: parts } = await supabase.from("participants").select("*").eq("session_id", id);
      setParticipants((parts as any) || []);
      const { data: ans } = await supabase
        .from("answers")
        .select("question_id, selected_option, participant_id")
        .eq("session_id", id);
      setAnswers((ans as any) || []);
    }
    load();
    const ch = supabase
      .channel(`present-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions", filter: `id=eq.${id}` }, (payload) => {
        setSession(payload.new);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "participants", filter: `session_id=eq.${id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "answers", filter: `session_id=eq.${id}` }, load)
      .subscribe();
    // Canal do evento — recebe "return_to_lobby" do celular do palestrante
    let lobbyCh: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data: sRow } = await supabase
        .from("sessions")
        .select("presentation_id")
        .eq("id", id)
        .single();
      if (!sRow) return;
      const { data: pRow } = await (supabase.from("presentations") as any)
        .select("event_id")
        .eq("id", sRow.presentation_id)
        .single();
      const evId = (pRow as any)?.event_id;
      if (!evId) return;
      lobbyCh = supabase
        .channel(`event-lobby-${evId}`)
        .on("broadcast", { event: "return_to_lobby" }, () => {
          navigate({ to: "/event/$id/lobby", params: { id: evId } });
        })
        .subscribe();
    })();
    return () => {
      supabase.removeChannel(ch);
      if (lobbyCh) supabase.removeChannel(lobbyCh);
    };
  }, [id]);

  // Carrega total de páginas do PDF via pdfjs
  useEffect(() => {
    if (!presentation?.file_url) return;
    let cancelled = false;
    (async () => {
      try {
        const pdfjs: any = await import("pdfjs-dist");
        const worker = await import("pdfjs-dist/build/pdf.worker.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = (worker as any).default;
        const doc = await pdfjs.getDocument(presentation.file_url).promise;
        if (!cancelled) setTotalPages(doc.numPages);
      } catch (e) {
        console.error("Falha ao contar páginas do PDF", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [presentation?.file_url]);

  const currentSlide: number = session?.current_slide || 1;
  const slideQuestion = useMemo(
    () => questions.find((q) => q.slide_number === currentSlide) || null,
    [questions, currentSlide],
  );
  const activeQuestion = useMemo(
    () => questions.find((q) => q.id === session?.active_question_id) || null,
    [questions, session?.active_question_id],
  );

  const remaining = useMemo(() => {
    if (!activeQuestion || !session?.question_started_at || session.question_revealed) return 0;
    const elapsed = (now - new Date(session.question_started_at).getTime()) / 1000;
    const effectiveLimit = activeQuestion.time_limit && activeQuestion.time_limit > 0
      ? activeQuestion.time_limit
      : presentation?.default_time_limit ?? 30;
    return Math.max(0, Math.ceil(effectiveLimit - elapsed));
  }, [activeQuestion, session, now]);

  // auto reveal when time hits 0
  useEffect(() => {
    if (activeQuestion && session?.question_started_at && !session.question_revealed) {
      const elapsed = (now - new Date(session.question_started_at).getTime()) / 1000;
      const effectiveLimit = activeQuestion.time_limit && activeQuestion.time_limit > 0
        ? activeQuestion.time_limit
        : presentation?.default_time_limit ?? 30;
      if (elapsed >= effectiveLimit) {
        revealResults();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, activeQuestion?.id, session?.question_revealed]);

  // Disparo de pódio pelo controle remoto (force_podium = true → encerra sessão).
  useEffect(() => {
    if (session?.force_podium && session?.status !== "ended") {
      (async () => {
        await endSession(false);
        await (supabase.from("sessions") as any)
          .update({ force_podium: false })
          .eq("id", id);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.force_podium]);

  /**
   * Navegação síncrona com clique único:
   * - direction "next": avança o slide e, se houver pergunta inédita vinculada,
   *   lança o quiz no mesmo instante (1 clique = mudar slide + abrir quiz).
   * - direction "prev": apenas exibe o slide anterior, NUNCA reabre quizzes
   *   já jogados (retrocesso seguro: status fixo de "exibindo slide").
   */
  async function setSlide(
    n: number,
    opts: { direction?: "next" | "prev"; fired?: string[] } = {},
  ) {
    const direction = opts.direction ?? "next";
    // Encerramento automático ao avançar além da última página → pódio
    if (direction === "next" && totalPages && n > totalPages) {
      await endSession(true);
      return;
    }
    const next = Math.max(1, n);
    const patch: any = {
      current_slide: next,
      question_revealed: false,
      active_question_id: null,
      question_started_at: null,
    };
    if (direction === "next") {
      const q = questions.find((qq) => qq.slide_number === next) || null;
      let fired = opts.fired;
      if (!fired) {
        const { data: s } = await (supabase.from("sessions") as any)
          .select("fired_question_ids")
          .eq("id", id)
          .single();
        fired = (s?.fired_question_ids as string[]) ?? [];
      }
      const alreadyFired = q ? fired.includes(q.id) : false;
      if (q && !alreadyFired && q.display_mode === "simultaneous") {
        patch.active_question_id = q.id;
        patch.question_started_at = new Date().toISOString();
        patch.fired_question_ids = [...fired, q.id];
      }
    }
    await supabase.from("sessions").update(patch).eq("id", id);
  }

  async function triggerQuestion() {
    if (!slideQuestion) return;
    await supabase
      .from("sessions")
      .update({
        active_question_id: slideQuestion.id,
        question_started_at: new Date().toISOString(),
        question_revealed: false,
      })
      .eq("id", id);
  }

  async function revealResults() {
    if (!activeQuestion) return;
    // grade pending answers (already saved as is_correct on insert)
    await supabase.from("sessions").update({ question_revealed: true }).eq("id", id);
  }

  /**
   * Função MESTRE de avanço — única fonte de verdade da máquina de estados
   * da apresentação. É disparada por 3 gatilhos idênticos:
   *   1) Clique do mouse em qualquer ponto do slide.
   *   2) Teclas ArrowRight ou Space no teclado físico.
   *   3) Broadcast "MASTER_CLICK" / "NEXT" enviado pelo celular do palestrante.
   *
   * Sequência de estados (1 clique = 1 passo):
   *   • Slide sem pergunta ativa, com quiz vinculado inédito → lança o quiz.
   *   • Quiz ativo com timer rodando → revela os resultados (encerra o timer).
   *   • Quiz revelado, OU slide sem quiz vinculado → avança para o próximo slide
   *     (se for o último, encerra a apresentação e abre o pódio).
   */
  async function handleMasterAdvance() {
    const { data: fresh } = await supabase
      .from("sessions")
      .select("current_slide, active_question_id, question_revealed, fired_question_ids, status")
      .eq("id", id)
      .single();
    if (!fresh || (fresh as any).status === "ended") return;
    const liveSlide: number = (fresh as any).current_slide ?? 1;
    const fired: string[] = ((fresh as any).fired_question_ids as string[]) ?? [];
    const activeId: string | null = (fresh as any).active_question_id ?? null;
    const revealed: boolean = !!(fresh as any).question_revealed;
    const activeQ = activeId
      ? questionsRef.current.find((q) => q.id === activeId) || null
      : null;

    // ESTADO 2 — quiz rodando, ainda não revelado → revela.
    if (activeQ && !revealed) {
      await supabase
        .from("sessions")
        .update({ question_revealed: true })
        .eq("id", id);
      return;
    }

    // ESTADO 1 — slide com pergunta vinculada ainda não disparada → lança quiz.
    if (!activeQ) {
      const slideQ = questionsRef.current.find((q) => q.slide_number === liveSlide) || null;
      if (
        slideQ &&
        !fired.includes(slideQ.id) &&
        slideQ.display_mode === "simultaneous"
      ) {
        await (supabase.from("sessions") as any)
          .update({
            active_question_id: slideQ.id,
            question_started_at: new Date().toISOString(),
            question_revealed: false,
            fired_question_ids: [...fired, slideQ.id],
          })
          .eq("id", id);
        return;
      }
    }

    // ESTADO 3 — avança para o próximo slide (sem reabrir quizzes já jogados).
    await setSlide(liveSlide + 1, { direction: "next", fired });
  }

  // Mantém a ref sempre apontando para a função com closures atuais.
  useEffect(() => {
    handleMasterAdvanceRef.current = handleMasterAdvance;
  });

  async function endSession(full = false) {
    const { error } = await supabase
      .from("sessions")
      .update({ status: "ended", active_question_id: null, question_started_at: null, question_revealed: false })
      .eq("id", id);
    if (error) {
      toast.error("Falha ao encerrar");
      return;
    }
    // Atualiza status de execução da apresentação
    if (session?.presentation_id) {
      await (supabase.from("presentations") as any)
        .update({ execution_status: full ? "completed_full" : "completed_partial" })
        .eq("id", session.presentation_id);
    }
  }

  /**
   * Retorna o palestrante para a tela de onde ele veio (Dashboard, página do
   * evento, etc.), limpando canais ativos antes da navegação.
   */
  function smartReturn() {
    try {
      // Limpa os canais realtime desta apresentação para evitar concorrência.
      supabase.removeAllChannels();
    } catch {
      /* ignora */
    }
    const target = consumeDashboardOrigin();
    // Navegação absoluta — preserva search e subrotas memorizadas.
    if (typeof window !== "undefined") {
      window.location.assign(target);
    } else {
      navigate({ to: "/dashboard" });
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(joinUrl);
      toast.success("Link copiado!");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = joinUrl;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        toast.success("Link copiado!");
      } catch {
        toast.error("Não foi possível copiar");
      }
      document.body.removeChild(ta);
    }
  }

  // keyboard nav
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignora quando o foco está em campos de digitação
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight" || e.code === "Space" || e.key === " ") {
        e.preventDefault();
        handleMasterAdvanceRef.current();
      } else if (e.key === "ArrowLeft") {
        setSlide(currentSlide - 1, { direction: "prev" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSlide, questions]);

  const questionAnswers = answers.filter((a) => a.question_id === activeQuestion?.id);
  const ranking = sortRanking(participants);
  const isEnded = session?.status === "ended";

  // Confete quando encerra
  useEffect(() => {
    if (!isEnded || confettiFiredRef.current) return;
    confettiFiredRef.current = true;
    const end = Date.now() + 4000;
    const colors = ["#ffd700", "#c0c0c0", "#cd7f32", "#ff7a18", "#ffffff"];
    (function frame() {
      confetti({ particleCount: 4, angle: 60, spread: 70, origin: { x: 0 }, colors });
      confetti({ particleCount: 4, angle: 120, spread: 70, origin: { x: 1 }, colors });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }, [isEnded]);

  if (!presentation) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando apresentação...
      </div>
    );
  }

  const optionKeys = activeQuestion
    ? activeQuestion.question_type === "true_false"
      ? ["A", "B"]
      : ["A", "B", "C", "D"].filter(
          (k) => ((activeQuestion.options?.[k] ?? "") as string).trim() !== "",
        )
    : [];

  // === TELA DE PÓDIO ===
  if (isEnded) {
    const top3 = ranking.slice(0, 3);
    // [place index 0..2 = posição real, participant]
    const slots: Array<{ place: 1 | 2 | 3; p: ParticipantRow }> = [];
    if (top3[1]) slots.push({ place: 2, p: top3[1] });
    if (top3[0]) slots.push({ place: 1, p: top3[0] });
    if (top3[2]) slots.push({ place: 3, p: top3[2] });
    const styleByPlace = {
      1: { h: "h-72", color: "from-[oklch(0.85_0.18_85)] to-[oklch(0.6_0.2_40)]", medal: "🥇", label: "1º" },
      2: { h: "h-48", color: "from-[oklch(0.85_0.02_240)] to-[oklch(0.6_0.02_240)]", medal: "🥈", label: "2º" },
      3: { h: "h-36", color: "from-[oklch(0.65_0.12_50)] to-[oklch(0.45_0.12_40)]", medal: "🥉", label: "3º" },
    } as const;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-10 bg-gradient-to-br from-background via-card to-background p-10">
        <div className="text-center">
          <p className="text-sm uppercase tracking-widest text-muted-foreground">{presentation.title}</p>
          <h1 className="mt-2 text-6xl font-extrabold text-foreground">Pódio Final</h1>
        </div>

        {top3.length === 0 ? (
          <p className="text-xl text-muted-foreground">Nenhum participante.</p>
        ) : (
          <div className="flex items-end gap-8">
            {slots.map(({ place, p }) => {
              const s = styleByPlace[place];
              return (
                <div key={p.id} className="flex w-56 flex-col items-center gap-3">
                  <div className="text-6xl">{s.medal}</div>
                  <div className="text-2xl font-bold">{p.name}</div>
                  <div className="text-lg text-muted-foreground">{p.score} pts</div>
                  <div
                    className={`flex w-full items-start justify-center rounded-t-xl bg-gradient-to-b pt-4 text-4xl font-black text-white shadow-2xl ${s.h} ${s.color}`}
                  >
                    {s.label}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <Button variant="outline" onClick={smartReturn}>
          Voltar ao Painel
        </Button>
        {presentation.event_id && (
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button
              onClick={() => navigate({ to: "/event/$id/podium", params: { id: presentation.event_id! } })}
            >
              Ver Grande Pódio do Evento
            </Button>
            {nextPresentationId && (
              <Button
                variant="secondary"
                onClick={async () => {
                  const { data: newSession, error } = await supabase
                    .from("sessions")
                    .insert({
                      presentation_id: nextPresentationId,
                      status: "lobby",
                      current_slide: 1,
                    })
                    .select("id")
                    .single();
                  if (error || !newSession) {
                    toast.error("Não foi possível iniciar a próxima apresentação");
                    return;
                  }
                  navigate({ to: "/lobby/$id", params: { id: newSession.id } });
                }}
              >
                Próxima Apresentação →
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <GiantQrOverlay open={giantQrOpen} joinUrl={joinUrl} onClose={() => setOverlayFlag("show_join_qr", false)} />
      <GiantQrOverlay open={pairQrOpen} joinUrl={pairUrl} onClose={() => setOverlayFlag("show_pair_qr", false)} />
      <RankingOverlay open={rankingOpen} sessionId={id} onClose={() => setOverlayFlag("show_ranking", false)} />
      {/* === ATALHOS FLUTUANTES (canto superior direito) ===
          Discretos no modo cinema (opacity-20) — brilham no hover. */}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col items-end gap-3 group/floating">
        <button
          type="button"
          onClick={() => setOverlayFlag("show_pair_qr", !pairQrOpen)}
          title="Conectar Controle Remoto"
          aria-label="Conectar Controle Remoto"
          className="flex items-center gap-2 rounded-full border border-white/20 bg-black/60 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white opacity-20 shadow-xl backdrop-blur transition-opacity duration-300 hover:opacity-100 focus:opacity-100"
        >
          <Smartphone className="h-5 w-5" />
          <span className="hidden whitespace-nowrap group-hover/floating:inline">Controle Remoto</span>
        </button>
        <button
          type="button"
          onClick={() => setOverlayFlag("show_join_qr", !giantQrOpen)}
          title="Conectar Participantes"
          aria-label="Conectar Participantes"
          className="flex items-center gap-2 rounded-full border border-white/20 bg-black/60 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white opacity-20 shadow-xl backdrop-blur transition-opacity duration-300 hover:opacity-100 focus:opacity-100"
        >
          <QrCode className="h-5 w-5" />
          <span className="hidden whitespace-nowrap group-hover/floating:inline">Participantes</span>
        </button>
      </div>
      {/* === APONTADOR LASER VIRTUAL (sobreposição total) === */}
      {laserCoords && (
        <div
          className="pointer-events-none fixed inset-0 z-[60]"
          aria-hidden="true"
        >
          <div
            className="absolute h-4 w-4 rounded-full bg-red-500 transition-all duration-75 ease-out"
            style={{
              left: `${laserCoords.x}%`,
              top: `${laserCoords.y}%`,
              transform: "translate(-50%, -50%)",
              boxShadow: "0 0 15px 4px rgba(239, 68, 68, 0.85)",
              border: "1px solid rgba(255,255,255,0.95)",
            }}
          >
            <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-ping" />
          </div>
        </div>
      )}
      {!projectorActivated && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm p-6">
          <div className="max-w-md rounded-2xl border border-[#262D3D] bg-[#131722] p-6 text-center shadow-2xl">
            <Tv className="mx-auto h-10 w-10 text-[#F68B1F]" />
            <h2 className="mt-3 text-xl font-bold text-white">Ativar Modo Projetor</h2>
            <p className="mt-2 text-sm text-[#9CA3AF]">
              Clique para liberar o áudio e permitir que o controle remoto do celular
              alterne a tela cheia (F11) deste computador.
            </p>
            <button
              type="button"
              onClick={() => {
                // Tentativa imediata: requisita tela cheia se já marcada (gesto do usuário)
                try {
                  if (session?.is_fullscreen) {
                    const el = document.documentElement as any;
                    const req =
                      el.requestFullscreen ||
                      el.webkitRequestFullscreen ||
                      el.msRequestFullscreen;
                    req?.call(el)?.catch?.(() => {});
                    fullscreenAppliedRef.current = true;
                  }
                } catch {
                  /* ignora */
                }
                setProjectorActivated(true);
              }}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#A6193C] to-[#F68B1F] px-6 py-3 text-sm font-extrabold uppercase tracking-wide text-white shadow-lg hover:opacity-95"
            >
              <Maximize className="h-5 w-5" /> Ativar Modo Projetor e Áudio
            </button>
          </div>
        </div>
      )}
      {/* === CINEMA LIMPO: slide ocupa 100% da tela com fundo preto. ===
          Nenhuma barra lateral ou coluna fixa. QR e Ranking aparecem
          apenas como frames flutuantes acionados pelo celular. */}
      <div
        className="relative flex flex-1 cursor-pointer items-center justify-center overflow-hidden bg-black"
        onClick={() => handleMasterAdvanceRef.current()}
        title="Clique para avançar / use as setas do teclado"
      >
        <iframe
          key={currentSlide}
          title={presentation.title}
          src={`${presentation.file_url}#page=${currentSlide}&toolbar=0&navpanes=0&scrollbar=0&statusbar=0&messages=0&view=Fit&zoom=page-fit&pagemode=none`}
          className="pointer-events-none block h-full w-full border-none bg-black"
          style={{ objectFit: "contain" }}
          scrolling="no"
        />
        <div className="absolute inset-0 z-10" aria-hidden="true" />
        <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-black/60 px-2 py-1 text-xs text-white/70">
          Slide {currentSlide}{totalPages ? ` / ${totalPages}` : ""}
        </div>
        {activeQuestion && !session?.question_revealed && (
          <div className="pointer-events-none absolute bottom-3 right-3 rounded bg-[#A6193C]/90 px-3 py-1 text-xs font-bold text-white shadow">
            ⏱ {remaining}s — {questionAnswers.length}/{participants.length}
          </div>
        )}
      </div>
    </div>
  );
}
