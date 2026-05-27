import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRequireSpeaker } from "@/hooks/use-auth";
import { PairingStatusBadge } from "@/components/pairing-status-badge";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, Copy, Loader2, LogOut, Maximize, Tv, Trophy } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import confetti from "canvas-confetti";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { sortRanking, type ParticipantRow } from "@/lib/ranking";
import { toast } from "sonner";
import { useRemoteBridge } from "@/hooks/use-remote-bridge";
import { Smartphone } from "lucide-react";
import { consumeDashboardOrigin } from "@/lib/dashboard-origin";

export const Route = createFileRoute("/present/$id")({
  head: () => ({ meta: [{ title: "Apresentação ao vivo — QuizPulse" }] }),
  component: Present,
});

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

function Present() {
  const { user } = useRequireSpeaker();
  const { id } = Route.useParams();
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
  // showRanking agora é controlado pela sessão (session.show_ranking),
  // permitindo que ambos os controles remotos alternem em sincronia.
  const confettiFiredRef = useRef(false);
  const [projectorActivated, setProjectorActivated] = useState(false);
  const fullscreenAppliedRef = useRef<boolean | null>(null);
  const questionsRef = useRef<Question[]>([]);
  useEffect(() => { questionsRef.current = questions; }, [questions]);

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
        await (supabase.from("sessions") as any)
          .update({ show_ranking: true })
          .eq("id", id);
        const liveActive = questionsRef.current.find((q) => q.id === fresh?.active_question_id) || null;
        const liveRevealed: boolean = !!fresh?.question_revealed;
        if (liveActive && !liveRevealed) {
          await supabase.from("sessions").update({ question_revealed: true }).eq("id", id);
        }
      }
    },
  });

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
      <div className="flex flex-1 overflow-hidden">
        {/* Coluna esquerda — PDF */}
        <div
          className="relative flex-[2] cursor-pointer bg-black"
          onClick={() => handleMasterAdvanceRef.current()}
          title="Clique para avançar / use as setas do teclado"
        >
          <iframe
            key={currentSlide}
            title={presentation.title}
            src={`${presentation.file_url}#page=${currentSlide}&toolbar=0&navpanes=0&scrollbar=0&statusbar=0&messages=0&view=Fit&zoom=page-fit`}
            className="pointer-events-none h-full w-full border-none bg-black"
            style={{ objectFit: "contain" }}
          />
          {/* Camada protetora: bloqueia scroll/arrasto dentro do iframe do PDF */}
          <div className="absolute inset-0 z-10" aria-hidden="true" />
          <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-black/60 px-2 py-1 text-xs text-white/80">
            Slide {currentSlide}
          </div>
          {/* Botão voltar para Evento */}
          {presentation.event_id && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                navigate({ to: "/event/$id", params: { id: presentation.event_id! } });
              }}
              title="Voltar para o Evento"
              aria-label="Voltar para o Evento"
              className="absolute left-4 top-4 z-20 flex h-12 w-12 items-center justify-center rounded-full border border-[#262D3D] bg-[#161A23]/90 text-[#9CA3AF] shadow-lg backdrop-blur transition hover:scale-105 hover:text-[#F68B1F] hover:bg-[#161A23]"
            >
              <ArrowLeft className="h-6 w-6" />
            </button>
          )}
          {/* Botão flutuante de Classificação — espelha session.show_ranking */}
          <button
            type="button"
            onClick={async (e) => {
              e.stopPropagation();
              await (supabase.from("sessions") as any)
                .update({ show_ranking: !session?.show_ranking })
                .eq("id", id);
            }}
            title={session?.show_ranking ? "Ocultar Classificação" : "Mostrar Classificação"}
            aria-label={session?.show_ranking ? "Ocultar Classificação" : "Mostrar Classificação"}
            className="absolute right-4 top-4 z-20 flex h-12 w-12 items-center justify-center rounded-full border border-[#262D3D] bg-[#161A23]/90 text-[#FFCB05] shadow-lg backdrop-blur transition hover:scale-105 hover:bg-[#161A23]"
          >
            <Trophy className="h-6 w-6" />
          </button>
          {/* Selo persistente de pareamento com o celular */}
          <div className="absolute right-20 top-4 z-20">
            <PairingStatusBadge userId={user?.id} variant="desktop" compact />
          </div>
        </div>

        {/* Painel retrátil — Classificação em tempo real */}
        <div
          className={`overflow-hidden border-l border-[#262D3D] bg-[#161A23] transition-all duration-300 ease-in-out ${
            session?.show_ranking ? "w-80" : "w-0"
          }`}
          aria-hidden={!session?.show_ranking}
        >
          <div className="flex h-full w-80 flex-col">
            <div className="border-b border-[#262D3D] px-4 py-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-white">
                Classificação em tempo real
              </h3>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {ranking.length} {ranking.length === 1 ? "participante" : "participantes"}
              </p>
            </div>
            <ol className="flex-1 space-y-2 overflow-y-auto p-3">
              {ranking.map((p, idx) => {
                const pos = idx + 1;
                const firstName = (p.name || "").trim().split(/\s+/)[0] || "—";
                const badgeCls =
                  pos === 1
                    ? "bg-[#F68B1F] text-white"
                    : pos === 2
                    ? "bg-[#9CA3AF] text-white"
                    : pos === 3
                    ? "bg-[#FFE6CB] text-[#A6193C]"
                    : "bg-[#0E1015] text-muted-foreground border border-[#262D3D]";
                return (
                  <li
                    key={p.id}
                    style={{ order: pos }}
                    className="flex items-center gap-3 rounded-lg border border-[#262D3D] bg-[#0E1015]/60 px-3 py-2 transition-all duration-500 ease-in-out animate-fade-in"
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${badgeCls}`}
                    >
                      {pos}º
                    </span>
                    <span className="flex-1 truncate text-sm font-medium text-white">
                      {firstName}
                    </span>
                    <span className="text-sm font-bold text-[#FFCB05]">
                      {p.score}
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">pts</span>
                    </span>
                  </li>
                );
              })}
              {ranking.length === 0 && (
                <li className="rounded border border-dashed border-[#262D3D] px-3 py-6 text-center text-xs text-muted-foreground">
                  Aguardando participantes...
                </li>
              )}
            </ol>
          </div>
        </div>

        {/* Coluna direita — painel admin (oculta se show_sidebar = false) */}
        {session?.show_sidebar !== false && (
        <aside className="flex w-[400px] flex-col gap-3 overflow-y-auto border-l border-border bg-card p-4">
          {/* Convite — controlado pelo toggle de QR no celular */}
          {session?.show_join_qr !== false && (
          <div className="rounded-lg border border-border bg-background/40 p-3 text-center">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Entre na sala a qualquer momento
            </p>
            <div className="mx-auto inline-block rounded-md bg-white p-2">
              {joinUrl && <QRCodeSVG value={joinUrl} size={130} />}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-background/60 px-2 py-1 text-[10px] text-muted-foreground">
                {joinUrl}
              </code>
              <Button size="sm" variant="outline" onClick={copyLink}>
                <Copy className="mr-1 h-3 w-3" /> Copiar
              </Button>
            </div>
          </div>
          )}

          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{presentation.title}</p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <Button size="sm" variant="outline" onClick={() => setSlide(currentSlide - 1, { direction: "prev" })}>
                ◀ Anterior
              </Button>
              <span className="text-sm font-semibold">
                Slide {currentSlide}
                {totalPages ? ` / ${totalPages}` : ""}
              </span>
              <Button size="sm" variant="outline" onClick={() => setSlide(currentSlide + 1, { direction: "next" })}>
                Próximo ▶
              </Button>
            </div>
          </div>

          {!slideQuestion && (
            <div className="rounded-lg border border-dashed border-border bg-background/40 p-4 text-center text-sm text-muted-foreground">
              Conteúdo livre para explicação
            </div>
          )}

          {slideQuestion && !activeQuestion && (
            <div className="space-y-2 rounded-lg border border-border bg-background/40 p-3">
              <p className="text-xs text-muted-foreground">
                Pergunta vinculada ({slideQuestion.display_mode === "after_slide" ? "Pós-Slide" : "Simultâneo"})
              </p>
              <p className="text-sm font-medium">{slideQuestion.question_text}</p>
              {slideQuestion.display_mode === "after_slide" && (
                <Button size="sm" className="w-full" onClick={triggerQuestion}>
                  Liberar pergunta agora
                </Button>
              )}
            </div>
          )}

          {activeQuestion && (
            <div
              className={`space-y-3 rounded-lg border p-3 ${
                activeQuestion.is_prize_question
                  ? "border-[#FFCB05] bg-[#FFCB05]/10 shadow-[0_0_24px_-4px_#FFCB05]"
                  : "border-primary/40 bg-primary/5"
              }`}
            >
              {activeQuestion.is_prize_question && (
                <div className="rounded-md border border-[#FFCB05] bg-gradient-to-r from-[#FFCB05] to-[#F68B1F] px-3 py-2 text-center text-xs font-extrabold uppercase tracking-wider text-black animate-pulse">
                  ⚡ ATENÇÃO: PERGUNTA PRÊMIO VALENDO {activeQuestion.prize_multiplier ?? 5}X MAIS PONTOS!
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className={`text-xs font-semibold uppercase ${activeQuestion.is_prize_question ? "text-[#FFCB05]" : "text-primary"}`}>
                  {activeQuestion.is_prize_question ? "⚡ Pergunta Prêmio" : "Pergunta ativa"}
                </span>
                {!session?.question_revealed ? (
                  <span
                    className={`rounded px-2 py-1 text-xs font-bold ${
                      activeQuestion.is_prize_question
                        ? "bg-[#FFCB05] text-black animate-pulse"
                        : "bg-primary text-primary-foreground"
                    }`}
                  >
                    {remaining}s
                  </span>
                ) : (
                  <span className="rounded bg-[oklch(0.66_0.14_165)] px-2 py-1 text-xs font-bold text-background">
                    Revelado
                  </span>
                )}
              </div>
              <p className="text-sm">{activeQuestion.question_text}</p>
              <p className="text-xs text-muted-foreground">
                {questionAnswers.length}/{participants.length} responderam
              </p>

              {session?.question_revealed && (
                <div className="space-y-1">
                  {optionKeys.map((k, index) => {
                    const count = questionAnswers.filter((a) => a.selected_option === k).length;
                    const pct = participants.length ? (count / participants.length) * 100 : 0;
                    const isCorrect = k === activeQuestion.correct_option;
                    const letterLabel = activeQuestion.question_type === "true_false"
                      ? k
                      : String.fromCharCode(65 + index);
                    return (
                      <div key={k} className="text-xs">
                        <div className="flex justify-between">
                          <span className={isCorrect ? "font-semibold text-[oklch(0.66_0.14_165)]" : ""}>
                            {letterLabel}. {activeQuestion.options[k]}
                          </span>
                          <span>{count}</span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded bg-muted">
                          <div
                            className={isCorrect ? "h-full bg-[oklch(0.66_0.14_165)]" : "h-full bg-primary"}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {!session?.question_revealed && (
                <Button size="sm" variant="outline" className="w-full" onClick={revealResults}>
                  Revelar agora
                </Button>
              )}
            </div>
          )}

          <div className="mt-2">
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Ranking ao vivo</h3>
            <ol className="space-y-1">
              {ranking.slice(0, 10).map((p, idx) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded border border-border bg-background/40 px-2 py-1 text-sm"
                >
                  <span>
                    <span className="mr-2 inline-block w-5 text-right text-muted-foreground">{idx + 1}.</span>
                    {p.name}
                  </span>
                  <span className="text-xs font-semibold text-primary">{p.score} pts</span>
                </li>
              ))}
              {ranking.length === 0 && (
                <li className="text-xs text-muted-foreground">Nenhum participante ainda</li>
              )}
            </ol>
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="mt-auto border-[#A6193C]/60 text-[#9CA3AF] hover:bg-[#A6193C]/10 hover:text-white"
              >
                <LogOut className="mr-2 h-4 w-4" /> Sair da Apresentação
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="border-[#262D3D] bg-[#0E1015] text-white">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-white">Deseja realmente sair?</AlertDialogTitle>
                <AlertDialogDescription className="text-[#9CA3AF]">
                  Isso encerrará a conexão realtime com os celulares de todos os participantes ativos nesta palestra.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-[#262D3D] bg-transparent text-[#9CA3AF] hover:bg-[#1E2235] hover:text-white">
                  Cancelar
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={async () => {
                    await endSession();
                    smartReturn();
                  }}
                  className="bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-white hover:opacity-95"
                >
                  Sim, encerrar e sair
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </aside>
        )}
      </div>
    </div>
  );
}
