import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, AArrowDown, AArrowUp, LogOut, Download } from "lucide-react";
import confetti from "canvas-confetti";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuthSession } from "@/hooks/use-auth";
import { downloadCertificate } from "@/lib/certificate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { sortRanking, type ParticipantRow } from "@/lib/ranking";
import { AudienceQuestionPanel } from "@/components/audience-question-panel";

type Search = { session?: string };

export const Route = createFileRoute("/join")({
  head: () => ({ meta: [{ title: "Entrar na sala — QuizBini" }] }),
  validateSearch: (s: Record<string, unknown>): Search => ({ session: (s.session as string) || undefined }),
  component: Join,
});

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8a12 12 0 1 1 0-24c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 1 0 44 24c0-1.2-.1-2.3-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8A12 12 0 0 1 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3A12 12 0 0 1 12.7 28.6L6.2 33.6A20 20 0 0 0 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4 5.5l6.3 5.3C41.4 35.5 44 30.2 44 24c0-1.2-.1-2.3-.4-3.5z"/>
    </svg>
  );
}

type Q = {
  id: string;
  question_text: string;
  question_type: string;
  options: Record<string, string>;
  correct_option: string;
  time_limit: number;
  is_prize_question?: boolean;
  prize_multiplier?: number;
};

const DEVICE_TOKEN_KEY = "qp:device_token";
const FONT_SIZE_KEY = "qp:font_size";

const FONT_SCALE = [
  { label: "Padrão", question: "text-lg", option: "text-base" },
  { label: "Médio", question: "text-2xl", option: "text-xl" },
  { label: "Grande", question: "text-3xl", option: "text-2xl" },
] as const;

const MC_COLORS: Record<string, string> = {
  A: "bg-[#1E5BFF] text-white",
  B: "bg-[#F26B1F] text-white",
  C: "bg-[#7A3FF2] text-white",
  D: "bg-[#D81B6A] text-white",
};

function ensureDeviceToken(): string {
  if (typeof window === "undefined") return "";
  let tok = localStorage.getItem(DEVICE_TOKEN_KEY);
  if (!tok) {
    tok = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(DEVICE_TOKEN_KEY, tok);
  }
  return tok;
}

function Join() {
  const { session: sessionId } = Route.useSearch();
  const { user: authUser } = useAuthSession();
  const [deviceToken, setDeviceToken] = useState<string>("");
  const [fontIdx, setFontIdx] = useState<number>(0);
  const [presentationId, setPresentationId] = useState<string | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [eventTitle, setEventTitle] = useState<string>("");
  const [presentationTitle, setPresentationTitle] = useState<string>("");
  const [completionThreshold, setCompletionThreshold] = useState<number>(0.7);
  const [resolvingIdentity, setResolvingIdentity] = useState(true);
  const [winnerPlace, setWinnerPlace] = useState<1 | 2 | 3 | null>(null);
  const [finaleLocked, setFinaleLocked] = useState(false);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [participantCreatedAt, setParticipantCreatedAt] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [question, setQuestion] = useState<Q | null>(null);
  const [defaultTimeLimit, setDefaultTimeLimit] = useState<number>(30);
  const [showPrizeIntro, setShowPrizeIntro] = useState(false);
  const [myAnswer, setMyAnswer] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [answerCountState, setAnswerCountState] = useState(0);
  const [pName, setPName] = useState("");
  const [pBirth, setPBirth] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [finalRank, setFinalRank] = useState<{ position: number; total: number; score: number } | null>(null);
  const [aiQuestionsEnabled, setAiQuestionsEnabled] = useState(false);

  // Preenche nome com o do Google quando logado
  useEffect(() => {
    if (authUser && !name) {
      const gName =
        (authUser.user_metadata?.full_name as string | undefined) ||
        (authUser.user_metadata?.name as string | undefined) ||
        "";
      if (gName) setName(gName);
    }
  }, [authUser, name]);

  // Quando usuário loga depois de já estar como participante, vincula o histórico
  useEffect(() => {
    if (!authUser || !participantId) return;
    (async () => {
      await (supabase.from("participants") as any)
        .update({ google_user_id: authUser.id, email: authUser.email ?? null })
        .eq("id", participantId)
        .is("google_user_id", null);
      await (supabase.from("participant_scores") as any)
        .update({ google_user_id: authUser.id, email: authUser.email ?? null })
        .eq("participant_id", participantId)
        .is("google_user_id", null);
    })();
  }, [authUser, participantId]);

  async function loginWithGoogle() {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.href,
    });
    if (result.error) toast.error("Não foi possível iniciar o login com Google.");
  }

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // Garantir device token persistente (uma vez por aparelho)
  useEffect(() => {
    setDeviceToken(ensureDeviceToken());
  }, []);

  // Carregar preferência de fonte
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem(FONT_SIZE_KEY);
    const n = raw ? parseInt(raw, 10) : 0;
    if (!Number.isNaN(n) && n >= 0 && n < FONT_SCALE.length) setFontIdx(n);
  }, []);

  function changeFont(delta: number) {
    setFontIdx((prev) => {
      const next = Math.min(FONT_SCALE.length - 1, Math.max(0, prev + delta));
      try {
        localStorage.setItem(FONT_SIZE_KEY, String(next));
      } catch {}
      return next;
    });
  }

  // Resolver identidade do participante para a sessão atual
  useEffect(() => {
    if (!sessionId || !deviceToken) return;
    let cancelled = false;
    (async () => {
      setResolvingIdentity(true);
      // 1. Carregar sessão → presentation_id → event_id
      const { data: sessRow } = await supabase
        .from("sessions")
        .select("presentation_id")
        .eq("id", sessionId)
        .maybeSingle();
      if (!sessRow) {
        if (!cancelled) setResolvingIdentity(false);
        return;
      }
      const presId = sessRow.presentation_id as string;
      if (!cancelled) setPresentationId(presId);

      const { data: presRow } = await (supabase.from("presentations") as any)
        .select("event_id, default_time_limit, title, ai_questions_enabled")
        .eq("id", presId)
        .maybeSingle();
      const evId = (presRow?.event_id as string | null) ?? null;
      if (!cancelled) {
        setEventId(evId);
        setDefaultTimeLimit((presRow as any)?.default_time_limit ?? 30);
        setPresentationTitle((presRow as any)?.title ?? "");
        setAiQuestionsEnabled(!!(presRow as any)?.ai_questions_enabled);
      }
      if (evId) {
        const { data: evRow } = await (supabase.from("events") as any)
          .select("title, completion_threshold")
          .eq("id", evId)
          .maybeSingle();
        if (!cancelled && evRow) {
          setEventTitle((evRow as any).title ?? "");
          setCompletionThreshold(Number((evRow as any).completion_threshold ?? 0.7));
        }
      }

      // 2. Já existe participante desta sessão com este device token?
      const { data: existingThisSession } = await (supabase.from("participants") as any)
        .select("id, created_at, name, birth_date")
        .eq("session_id", sessionId)
        .eq("device_token", deviceToken)
        .maybeSingle();
      if (existingThisSession) {
        if (!cancelled) {
          setParticipantId(existingThisSession.id);
          setParticipantCreatedAt(existingThisSession.created_at);
          setResolvingIdentity(false);
        }
        return;
      }

      // 3. Existe registro do mesmo device em outra apresentação do mesmo evento?
      if (evId) {
        const { data: priorInEvent } = await (supabase.from("participants") as any)
          .select("name, birth_date")
          .eq("event_id", evId)
          .eq("device_token", deviceToken)
          .limit(1);
        if (priorInEvent && priorInEvent.length > 0) {
          // Reaproveita identidade: cria participante desta sessão sem pedir formulário
          const prev = priorInEvent[0];
          const { data: created, error: insErr } = await (supabase.from("participants") as any)
            .insert({
              session_id: sessionId,
              name: prev.name,
              birth_date: prev.birth_date,
              device_token: deviceToken,
              event_id: evId,
            })
            .select("id, created_at")
            .single();
          if (!cancelled && created && !insErr) {
            setParticipantId(created.id);
            setParticipantCreatedAt(created.created_at);
          }
        }
      }
      if (!cancelled) setResolvingIdentity(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, deviceToken]);

  // load participant created_at
  useEffect(() => {
    if (!participantId) return;
    supabase
      .from("participants")
      .select("created_at, name, birth_date")
      .eq("id", participantId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setParticipantCreatedAt(data.created_at);
          setPName(data.name);
          setPBirth(data.birth_date);
        } else {
          // participant no longer exists (sessão deletada)
          setParticipantId(null);
        }
      });
  }, [participantId, sessionId]);

  // subscribe to session
  useEffect(() => {
    if (!sessionId) return;
    async function load() {
      const { data: s } = await supabase.from("sessions").select("*").eq("id", sessionId).single();
      setSession(s);
      if (s?.active_question_id) {
        const { data: q } = await supabase.from("questions").select("*").eq("id", s.active_question_id).single();
        setQuestion(q as any);
      } else {
        setQuestion(null);
        setMyAnswer(null);
      }
    }
    load();
    const ch = supabase
      .channel(`join-${sessionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions", filter: `id=eq.${sessionId}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [sessionId]);

  // Escuta a revelação dramática do evento e celebra no celular do vencedor
  useEffect(() => {
    if (!eventId || !deviceToken) return;
    const ch = supabase
      .channel(`event-finale-${eventId}`)
      .on("broadcast", { event: "winner" }, (msg: any) => {
        const payload = msg?.payload ?? {};
        if (payload?.device_token && payload.device_token === deviceToken) {
          const place = payload.place as 1 | 2 | 3;
          setWinnerPlace(place);
          setFinaleLocked(false);
          try {
            (navigator as any)?.vibrate?.([200, 80, 200, 80, 400]);
          } catch {
            /* sem vibração */
          }
        }
      })
      .on("broadcast", { event: "finale:lock" }, () => {
        setFinaleLocked(true);
        try {
          (navigator as any)?.vibrate?.([120, 60, 120]);
        } catch {
          /* sem vibração */
        }
      })
      .on("broadcast", { event: "event:closed" }, () => {
        setFinaleLocked(false);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [eventId, deviceToken]);

  // reset answer when question changes
  useEffect(() => {
    setMyAnswer(null);
    // Pergunta prêmio: vibração intensa + overlay de suspense
    if (question?.is_prize_question) {
      setShowPrizeIntro(true);
      try {
        (navigator as any)?.vibrate?.([300, 100, 300, 100, 300, 100, 500]);
      } catch {}
      const t = setTimeout(() => setShowPrizeIntro(false), 3500);
      return () => clearTimeout(t);
    }
  }, [question?.id, question?.is_prize_question]);

  // fetch existing answer for current question
  useEffect(() => {
    if (!question || !participantId) return;
    supabase
      .from("answers")
      .select("selected_option")
      .eq("question_id", question.id)
      .eq("participant_id", participantId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setMyAnswer(data.selected_option);
      });
  }, [question?.id, participantId]);

  // fetch my score
  useEffect(() => {
    if (!participantId) return;
    supabase
      .from("participants")
      .select("score, correct_count, answer_count")
      .eq("id", participantId)
      .single()
      .then(({ data }) => {
        if (data) {
          setScore(data.score);
          setCorrectCount(data.correct_count);
          setAnswerCountState((data as any).answer_count ?? 0);
        }
      });
  }, [participantId, session?.question_revealed]);

  const remaining = useMemo(() => {
    if (!question || session.question_revealed) return 0;
    if (session?.question_expires_at) {
      const ms = new Date(session.question_expires_at).getTime() - now;
      return Math.max(0, Math.ceil(ms / 1000));
    }
    if (!session?.question_started_at) return 0;
    const elapsed = (now - new Date(session.question_started_at).getTime()) / 1000;
    const limit = question.time_limit && question.time_limit > 0 ? question.time_limit : defaultTimeLimit;
    return Math.max(0, Math.ceil(limit - elapsed));
  }, [question, session, now, defaultTimeLimit]);

  async function join() {
    if (!sessionId) return;
    if (!name.trim()) {
      toast.error("Preencha seu nome");
      return;
    }
    setSubmitting(true);
    const { data, error } = await (supabase.from("participants") as any)
      .insert({
        session_id: sessionId,
        name: name.trim(),
        birth_date: "2000-01-01",
        device_token: deviceToken,
        event_id: eventId,
        google_user_id: authUser?.id ?? null,
        email: authUser?.email ?? null,
      })
      .select("id, created_at")
      .single();
    setSubmitting(false);
    if (error) {
      toast.error("Erro ao entrar na sala");
      return;
    }
    setParticipantId(data.id);
    setParticipantCreatedAt(data.created_at);
  }

  async function answer(option: string) {
    if (!question || !participantId || !session?.question_started_at) return;
    // Bloqueio entrada tardia: pergunta começou antes do participante entrar
    if (participantCreatedAt && new Date(session.question_started_at) < new Date(participantCreatedAt)) return;
    // Validação local: tempo expirou (a regra do servidor é a fonte da verdade)
    if (session?.question_expires_at && new Date(session.question_expires_at).getTime() <= Date.now()) {
      toast.error("Tempo esgotado para esta pergunta");
      return;
    }
    setMyAnswer(option);
    try {
      if (navigator.vibrate) navigator.vibrate(50);
    } catch {}
    const elapsedMs = now - new Date(session.question_started_at).getTime();
    const isCorrect = option === question.correct_option;
    // Novo cálculo: Base 500 + bônus proporcional ao tempo restante
    const effectiveLimitSec = question.time_limit && question.time_limit > 0 ? question.time_limit : defaultTimeLimit;
    const totalMs = effectiveLimitSec * 1000;
    const remainingMs = Math.max(0, totalMs - elapsedMs);
    const BASE = 500;
    const BONUS = 500;
    const rawPoints = isCorrect ? BASE + Math.round((remainingMs / totalMs) * BONUS) : 0;
    const multiplier = question.is_prize_question ? (question.prize_multiplier ?? 5) : 1;
    const points = rawPoints * multiplier;
    const { error } = await supabase.from("answers").insert({
      session_id: sessionId,
      question_id: question.id,
      participant_id: participantId,
      selected_option: option,
      is_correct: isCorrect,
      response_ms: elapsedMs,
    });
    if (error) {
      // já respondeu, expirou no servidor, ou pergunta já foi encerrada
      if ((error as any).message?.includes("question_expired")) {
        toast.error("Tempo esgotado");
      } else if ((error as any).message?.includes("question_already_closed")) {
        toast.error("Pergunta encerrada");
      }
      return;
    }
    // update participant aggregate
    const { data: p } = await supabase
      .from("participants")
      .select("score, correct_count, total_response_ms, answer_count")
      .eq("id", participantId)
      .single();
    if (p) {
      const newScore = p.score + points;
      const newCorrect = p.correct_count + (isCorrect ? 1 : 0);
      const newTotalMs = p.total_response_ms + elapsedMs;
      const newAnswerCount = p.answer_count + 1;
      await supabase
        .from("participants")
        .update({
          score: newScore,
          correct_count: newCorrect,
          total_response_ms: newTotalMs,
          answer_count: newAnswerCount,
        })
        .eq("id", participantId);

      // Upsert no agregado por apresentação (alimenta o Grande Pódio do Evento)
      if (presentationId) {
        await (supabase.from("participant_scores") as any).upsert(
          {
            event_id: eventId,
            presentation_id: presentationId,
            session_id: sessionId,
            participant_id: participantId,
            device_token: deviceToken,
            participant_name: pName || name || "",
            birth_date: pBirth || "2000-01-01",
            score: newScore,
            correct_count: newCorrect,
            answer_count: newAnswerCount,
            total_response_ms: newTotalMs,
            updated_at: new Date().toISOString(),
            google_user_id: authUser?.id ?? null,
            email: authUser?.email ?? null,
          },
          { onConflict: "presentation_id,participant_id" },
        );
      }
    }
  }

  // Quando sessão é encerrada, calcular colocação
  useEffect(() => {
    if (session?.status !== "ended" || !participantId) return;
    (async () => {
      const { data } = await supabase.from("participants").select("*").eq("session_id", sessionId);
      if (!data) return;
      const ranked = sortRanking(data as ParticipantRow[]);
      const idx = ranked.findIndex((p) => p.id === participantId);
      const me = ranked[idx];
      if (me) setFinalRank({ position: idx + 1, total: ranked.length, score: me.score });
    })();
  }, [session?.status, participantId, sessionId]);

  if (!sessionId) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <p className="text-center text-muted-foreground">
          Link inválido. Escaneie o QR Code do palestrante para entrar.
        </p>
      </div>
    );
  }

  // Bloqueio de clímax: o palestrante iniciou a cerimônia de revelação no projetor
  if (finaleLocked && !winnerPlace) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-black p-6 text-center text-white">
        <div className="text-6xl animate-pulse">👀</div>
        <h1 className="text-2xl font-extrabold text-[#FFCB05]">
          Fique atento à tela principal!
        </h1>
        <p className="max-w-xs text-sm text-white/80">
          A revelação do pódio está acontecendo agora. Olhe para a tela do projetor
          para descobrir os campeões.
        </p>
        <div className="mt-2 h-1 w-32 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/2 animate-[pulse_1.2s_ease-in-out_infinite] bg-[#A6193C]" />
        </div>
      </div>
    );
  }

  if (!participantId) {
    if (winnerPlace) return <WinnerCelebration place={winnerPlace} />;
    if (resolvingIdentity) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Conectando seu celular...
        </div>
      );
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0E1015] p-6">
        <div className="w-full max-w-sm space-y-6 rounded-2xl border border-[#262D3D] bg-[#161A23] p-6 shadow-2xl">
          <div className="text-center">
            <h1 className="text-2xl font-extrabold text-white">Entrar na sala</h1>
            <p className="text-xs uppercase tracking-widest text-[#F68B1F]">QuizBini</p>
          </div>

          {/* Seção: Login Google opcional */}
          {!authUser ? (
            <div className="space-y-2 rounded-xl border border-[#262D3D] bg-[#0E1015]/60 p-4">
              <p className="text-center text-sm font-medium text-white">
                Deseja salvar seu histórico e certificados?
                <br />
                <span className="text-[#9CA3AF]">Faça login com Google.</span>
              </p>
              <button
                type="button"
                onClick={loginWithGoogle}
                className="flex w-full items-center justify-center gap-3 rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm font-semibold text-[#1F1F1F] shadow-sm transition hover:bg-[#F8F9FA] active:scale-[0.98]"
              >
                <GoogleIcon className="h-5 w-5" />
                <span>Login com Google</span>
              </button>
              <p className="text-center text-[11px] leading-snug text-[#6B7280]">
                O login é opcional, mas garante que suas participações sejam
                registradas no seu histórico profissional.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-[#07A684]/30 bg-[#07A684]/10 p-3 text-xs text-[#34D399]">
              <span className="text-base">✓</span>
              <span>
                Seu histórico será salvo na conta{" "}
                <span className="font-semibold">{authUser.email}</span>
              </span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-[#262D3D]" />
            <span className="text-[10px] uppercase tracking-widest text-[#6B7280]">
              continue para entrar
            </span>
            <div className="h-px flex-1 bg-[#262D3D]" />
          </div>

          <div className="space-y-3">
            <div>
              <Label htmlFor="name" className="text-xs font-semibold uppercase tracking-wider text-[#9CA3AF]">
                Seu nome
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Como gostaria de ser chamado(a)?"
                className="mt-1 border-[#262D3D] bg-[#0E1015] text-white placeholder:text-[#3A4255] focus-visible:ring-[#F68B1F]"
              />
            </div>
            <Button
              className="w-full bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-base font-extrabold uppercase tracking-wide text-white shadow-lg shadow-[#A6193C]/30 hover:opacity-95"
              onClick={join}
              disabled={submitting}
            >
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Entrar
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Sessão encerrada → tela de colocação personalizada
  if (winnerPlace) return <WinnerCelebration place={winnerPlace} />;
  if (session?.status === "ended") {
    if (!finalRank) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Calculando sua colocação...
        </div>
      );
    }
    const pos = finalRank.position;
    const isChampion = pos === 1;
    const isPodium = pos <= 3;
    const medal = pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : "🎯";
    const bg = isChampion
      ? "bg-gradient-to-br from-[oklch(0.85_0.18_85)] via-[oklch(0.75_0.18_60)] to-[oklch(0.6_0.2_40)]"
      : pos === 2
      ? "bg-gradient-to-br from-[oklch(0.85_0.02_240)] to-[oklch(0.65_0.02_240)]"
      : pos === 3
      ? "bg-gradient-to-br from-[oklch(0.65_0.12_50)] to-[oklch(0.45_0.12_40)]"
      : "bg-card";
    const pctCorrect = answerCountState > 0 ? correctCount / answerCountState : 0;
    const eligibleCert = pctCorrect >= completionThreshold && answerCountState > 0;
    async function handleDownloadCertificate() {
      if (!participantId) return;
      try {
        await (supabase.from("certificates") as any).insert({
          participant_id: participantId,
          event_id: eventId,
          presentation_id: presentationId,
          google_user_id: authUser?.id ?? null,
          participant_name: pName || name || "Participante",
          event_title: eventTitle || "QuizBini",
          presentation_title: presentationTitle || null,
          score,
          correct_count: correctCount,
          answer_count: answerCountState,
        });
      } catch {
        /* idempotente — já pode existir */
      }
      downloadCertificate({
        participantName: pName || name || "Participante",
        eventTitle: eventTitle || "QuizBini",
        presentationTitle: presentationTitle || null,
        score,
        correctCount,
        answerCount: answerCountState,
      });
    }
    return (
      <div className={`flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center ${bg}`}>
        <div className="text-7xl">{medal}</div>
        <h1 className="text-3xl font-bold text-white drop-shadow">
          {isChampion ? "Parabéns, Campeão!" : isPodium ? "Pódio!" : "Obrigado pela participação!"}
        </h1>
        <p className="text-xl text-white/95 drop-shadow">
          Você terminou em <span className="font-extrabold">{pos}º lugar</span>
          {isPodium ? "" : ` de ${finalRank.total}`}
        </p>
        <p className="text-lg text-white/90">
          com <span className="font-bold">{finalRank.score}</span> pontos
        </p>
        {eligibleCert && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <Button
              onClick={handleDownloadCertificate}
              className="bg-white text-black hover:bg-white/90"
            >
              <Download className="mr-2 h-4 w-4" /> Baixar Certificado
            </Button>
            {!authUser && (
              <button
                type="button"
                onClick={loginWithGoogle}
                className="text-xs text-white/90 underline"
              >
                Entre com Google para guardar o certificado no seu histórico
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // Entrada tardia: pergunta ativa começou antes do participante entrar
  const lateForCurrent =
    !!question &&
    !!session?.question_started_at &&
    !!participantCreatedAt &&
    new Date(session.question_started_at) < new Date(participantCreatedAt);

  // Esperando pergunta
  if (!question || lateForCurrent) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <div className="rounded-full bg-primary/20 px-3 py-1 text-xs font-semibold text-primary">Conectado</div>
        <h2 className="text-xl font-semibold">
          {lateForCurrent ? "Você entrou após o início desta pergunta" : "Acompanhe a explicação na tela principal"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {lateForCurrent
            ? "Aguarde a próxima pergunta para participar."
            : "Sua próxima pergunta aparecerá aqui automaticamente."}
        </p>
        <p className="mt-6 text-xs text-muted-foreground">
          Pontuação: <span className="font-semibold text-foreground">{score}</span> · Acertos:{" "}
          <span className="font-semibold text-foreground">{correctCount}</span>
        </p>
      </div>
    );
  }

  const optionKeys =
    question.question_type === "true_false"
      ? ["A", "B"]
      : ["A", "B", "C", "D"].filter(
          (k) => ((question.options?.[k] ?? "") as string).trim() !== "",
        );
  const revealed = !!session?.question_revealed;
  const userCorrect = revealed && myAnswer === question.correct_option;
  const scale = FONT_SCALE[fontIdx];
  const isTF = question.question_type === "true_false";

  return (
    <div className="flex h-[100dvh] flex-col justify-between bg-background p-3">
      {/* Overlay dramático de Pergunta Prêmio */}
      {showPrizeIntro && question?.is_prize_question && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-[#FFCB05] via-[#F68B1F] to-[#A6193C] p-6 text-center animate-fade-in">
          <div className="text-7xl animate-pulse">⚡</div>
          <h1 className="text-3xl font-extrabold text-white drop-shadow-lg">
            HORA DA VIRADA!
          </h1>
          <p className="text-xl font-bold text-white drop-shadow">
            Pergunta Prêmio Ativa!
          </p>
          <p className="rounded-full bg-black/30 px-5 py-2 text-base font-extrabold text-white">
            Vale até {1000 * (question.prize_multiplier ?? 5)} pontos!
          </p>
          <p className="mt-2 text-xs uppercase tracking-widest text-white/80">
            Prepare-se...
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          Pontuação: <span className="font-semibold text-foreground">{score}</span>
        </span>
        <div className="flex items-center gap-2">
          {!revealed && (
            <span
              className={`rounded px-2 py-1 text-sm font-bold ${
                question.is_prize_question
                  ? "bg-[#FFCB05] text-black animate-pulse"
                  : "bg-primary text-primary-foreground"
              }`}
            >
              {remaining}s
            </span>
          )}
          <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1">
            <button
              type="button"
              onClick={() => changeFont(-1)}
              disabled={fontIdx === 0}
              aria-label="Diminuir tamanho do texto"
              className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition active:scale-95 disabled:opacity-40"
            >
              <AArrowDown className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => changeFont(1)}
              disabled={fontIdx === FONT_SCALE.length - 1}
              aria-label="Aumentar tamanho do texto"
              className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition active:scale-95 disabled:opacity-40"
            >
              <AArrowUp className="h-5 w-5" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              if (confirm("Tem certeza que deseja sair desta palestra?")) {
                window.location.href = "/join";
              }
            }}
            aria-label="Sair desta palestra"
            title="Sair desta palestra"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[#262D3D] text-[#9CA3AF] transition hover:bg-[#1E2235] hover:text-[#F68B1F] active:scale-95"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      {question.is_prize_question && (
        <div className="mt-2 flex items-center justify-center gap-1 rounded-md border border-[#FFCB05] bg-gradient-to-r from-[#FFCB05] to-[#F68B1F] px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wider text-black animate-pulse">
          ⚡ PERGUNTA PRÊMIO · {question.prize_multiplier ?? 5}X PONTOS
        </div>
      )}

      <h2 className={`my-4 font-semibold leading-snug ${scale.question}`}>
        {question.question_text}
      </h2>

      <div className="flex flex-col gap-3 pb-2">
        {optionKeys.map((k, index) => {
          const selected = myAnswer === k;
          const isCorrect = question.correct_option === k;

          let base: string;
          if (isTF) {
            base =
              k === "A"
                ? "bg-[#07A684] text-white"
                : "bg-[#A6193C] text-white";
          } else {
            base = MC_COLORS[k] ?? "bg-card text-foreground";
          }

          let stateCls = "border-transparent";
          if (revealed) {
            if (isCorrect) stateCls = "border-[#FFCB05] ring-2 ring-[#FFCB05]";
            else if (selected) stateCls = "border-destructive opacity-70";
            else stateCls = "border-transparent opacity-60";
          } else if (selected) {
            stateCls = "border-[#FFCB05] ring-2 ring-[#FFCB05]";
          }

          const label = isTF ? (k === "A" ? "Verdadeiro" : "Falso") : question.options[k];
          const letterLabel = isTF ? k : String.fromCharCode(65 + index);

          return (
            <button
              key={k}
              disabled={revealed || !!myAnswer || remaining === 0}
              onClick={() => answer(k)}
              className={`flex min-h-[64px] w-full items-center rounded-2xl border-2 px-5 py-4 text-left font-bold shadow-sm transition active:scale-95 disabled:cursor-not-allowed ${base} ${stateCls} ${scale.option}`}
            >
              {!isTF && <span className="mr-3 opacity-90">{letterLabel}.</span>}
              <span className="flex-1">{label}</span>
            </button>
          );
        })}
      </div>

      {revealed && (
        <div
          className={`mt-3 rounded-xl p-3 text-center ${
            userCorrect
              ? "bg-[oklch(0.66_0.14_165)]/20 text-[oklch(0.66_0.14_165)]"
              : "bg-destructive/20 text-destructive"
          }`}
        >
          <p className="text-lg font-bold">{userCorrect ? "Você acertou! 🎉" : myAnswer ? "Errou." : "Sem resposta"}</p>
          <p className="mt-1 text-sm">
            Resposta correta:{" "}
            <span className="font-semibold">
              {(() => {
                const idx = optionKeys.indexOf(question.correct_option);
                return idx >= 0 ? String.fromCharCode(65 + idx) : question.correct_option;
              })()}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

function WinnerCelebration({ place }: { place: 1 | 2 | 3 }) {
  useEffect(() => {
    const end = Date.now() + 6000;
    const colors =
      place === 1
        ? ["#FFCB05", "#F68B1F", "#FFFFFF", "#FFE6CB"]
        : place === 2
        ? ["#C0C0C0", "#FFFFFF", "#9CA3AF"]
        : ["#FFE6CB", "#F68B1F", "#A6193C"];
    (function frame() {
      confetti({ particleCount: 6, angle: 60, spread: 80, origin: { x: 0, y: 0.7 }, colors });
      confetti({ particleCount: 6, angle: 120, spread: 80, origin: { x: 1, y: 0.7 }, colors });
      confetti({ particleCount: 4, startVelocity: 50, spread: 360, origin: { x: 0.5, y: 0.4 }, colors });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }, [place]);

  const title =
    place === 1
      ? "PARABÉNS! Você é o Campeão do QuizBini!"
      : place === 2
      ? "Espetacular! Você é o Vice-Campeão!"
      : "Parabéns! Você ficou em 3º lugar!";
  const medal = place === 1 ? "🏆" : place === 2 ? "🥈" : "🥉";
  const bg =
    place === 1
      ? "from-[#FFCB05] via-[#F68B1F] to-[#A6193C]"
      : place === 2
      ? "from-[#E5E7EB] via-[#9CA3AF] to-[#4B5563]"
      : "from-[#FFE6CB] via-[#F68B1F] to-[#A6193C]";

  return (
    <div
      className={`flex min-h-[100dvh] flex-col items-center justify-center gap-6 bg-gradient-to-br p-8 text-center ${bg}`}
    >
      <div className="text-8xl drop-shadow">{medal}</div>
      <h1 className="text-3xl font-extrabold text-white drop-shadow md:text-4xl">{title}</h1>
      <p className="text-lg font-semibold text-white/95 drop-shadow">
        {place}º lugar no Grande Pódio do Evento
      </p>
    </div>
  );
}
