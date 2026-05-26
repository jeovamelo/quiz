import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { sortRanking, type ParticipantRow } from "@/lib/ranking";

type Search = { session?: string };

export const Route = createFileRoute("/join")({
  head: () => ({ meta: [{ title: "Entrar na sala — QuizPulse" }] }),
  validateSearch: (s: Record<string, unknown>): Search => ({ session: (s.session as string) || undefined }),
  component: Join,
});

type Q = {
  id: string;
  question_text: string;
  question_type: string;
  options: Record<string, string>;
  correct_option: string;
  time_limit: number;
};

function Join() {
  const { session: sessionId } = Route.useSearch();
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [participantCreatedAt, setParticipantCreatedAt] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [birth, setBirth] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [question, setQuestion] = useState<Q | null>(null);
  const [myAnswer, setMyAnswer] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [finalRank, setFinalRank] = useState<{ position: number; total: number; score: number } | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // restore from localStorage
  useEffect(() => {
    if (!sessionId) return;
    const saved = localStorage.getItem(`qp:participant:${sessionId}`);
    if (saved) setParticipantId(saved);
  }, [sessionId]);

  // load participant created_at
  useEffect(() => {
    if (!participantId) return;
    supabase
      .from("participants")
      .select("created_at")
      .eq("id", participantId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setParticipantCreatedAt(data.created_at);
        else {
          // participant no longer exists (sessão deletada)
          localStorage.removeItem(`qp:participant:${sessionId!}`);
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

  // reset answer when question changes
  useEffect(() => {
    setMyAnswer(null);
  }, [question?.id]);

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
      .select("score, correct_count")
      .eq("id", participantId)
      .single()
      .then(({ data }) => {
        if (data) {
          setScore(data.score);
          setCorrectCount(data.correct_count);
        }
      });
  }, [participantId, session?.question_revealed]);

  const remaining = useMemo(() => {
    if (!question || !session?.question_started_at || session.question_revealed) return 0;
    const elapsed = (now - new Date(session.question_started_at).getTime()) / 1000;
    return Math.max(0, Math.ceil(question.time_limit - elapsed));
  }, [question, session, now]);

  async function join() {
    if (!sessionId) return;
    if (!name.trim() || !birth) {
      toast.error("Preencha nome e data de nascimento");
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase
      .from("participants")
      .insert({ session_id: sessionId, name: name.trim(), birth_date: birth })
      .select("id, created_at")
      .single();
    setSubmitting(false);
    if (error) {
      toast.error("Erro ao entrar na sala");
      return;
    }
    localStorage.setItem(`qp:participant:${sessionId}`, data.id);
    setParticipantId(data.id);
    setParticipantCreatedAt(data.created_at);
  }

  async function answer(option: string) {
    if (!question || !participantId || !session?.question_started_at) return;
    // Bloqueio entrada tardia: pergunta começou antes do participante entrar
    if (participantCreatedAt && new Date(session.question_started_at) < new Date(participantCreatedAt)) return;
    setMyAnswer(option);
    try {
      if (navigator.vibrate) navigator.vibrate(50);
    } catch {}
    const elapsedMs = now - new Date(session.question_started_at).getTime();
    const isCorrect = option === question.correct_option;
    // Novo cálculo: Base 500 + bônus proporcional ao tempo restante
    const totalMs = (question.time_limit || 10) * 1000;
    const remainingMs = Math.max(0, totalMs - elapsedMs);
    const BASE = 500;
    const BONUS = 500;
    const points = isCorrect ? BASE + Math.round((remainingMs / totalMs) * BONUS) : 0;
    const { error } = await supabase.from("answers").insert({
      session_id: sessionId,
      question_id: question.id,
      participant_id: participantId,
      selected_option: option,
      is_correct: isCorrect,
      response_ms: elapsedMs,
    });
    if (error) {
      // already answered
      return;
    }
    // update participant aggregate
    const { data: p } = await supabase
      .from("participants")
      .select("score, correct_count, total_response_ms, answer_count")
      .eq("id", participantId)
      .single();
    if (p) {
      await supabase
        .from("participants")
        .update({
          score: p.score + points,
          correct_count: p.correct_count + (isCorrect ? 1 : 0),
          total_response_ms: p.total_response_ms + elapsedMs,
          answer_count: p.answer_count + 1,
        })
        .eq("id", participantId);
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

  if (!participantId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6">
          <div>
            <h1 className="text-2xl font-bold">Entrar na sala</h1>
            <p className="text-sm text-muted-foreground">QuizPulse · Banco do Nordeste</p>
          </div>
          <div>
            <Label htmlFor="name">Nome</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" />
          </div>
          <div>
            <Label htmlFor="birth">Data de nascimento</Label>
            <Input id="birth" type="date" value={birth} onChange={(e) => setBirth(e.target.value)} />
          </div>
          <Button className="w-full" onClick={join} disabled={submitting}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Entrar
          </Button>
        </div>
      </div>
    );
  }

  // Sessão encerrada → tela de colocação personalizada
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

  const optionKeys = question.question_type === "true_false" ? ["A", "B"] : ["A", "B", "C", "D"];
  const revealed = !!session?.question_revealed;
  const userCorrect = revealed && myAnswer === question.correct_option;

  return (
    <div className="flex min-h-screen flex-col bg-background p-4">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Pontuação: {score}</span>
        {!revealed && (
          <span className="rounded bg-primary px-2 py-1 text-sm font-bold text-primary-foreground">
            {remaining}s
          </span>
        )}
      </div>
      <h2 className="mb-6 text-lg font-semibold">{question.question_text}</h2>

      <div className="flex flex-col gap-3">
        {optionKeys.map((k) => {
          const selected = myAnswer === k;
          const isCorrect = question.correct_option === k;
          let cls = "border-border bg-card";
          if (revealed) {
            if (isCorrect) cls = "border-[oklch(0.66_0.14_165)] bg-[oklch(0.66_0.14_165)]/20";
            else if (selected) cls = "border-destructive bg-destructive/20";
          } else if (selected) cls = "border-primary bg-primary/20";

          // True/False — botões coloridos
          const tfColor =
            question.question_type === "true_false"
              ? k === "A"
                ? "border-[oklch(0.66_0.14_165)]"
                : "border-destructive"
              : "";

          return (
            <button
              key={k}
              disabled={revealed || !!myAnswer || remaining === 0}
              onClick={() => answer(k)}
              className={`rounded-xl border-2 px-4 py-5 text-left text-base transition ${cls} ${tfColor} disabled:cursor-not-allowed disabled:opacity-70`}
            >
              <span className="mr-2 font-bold">{k}.</span>
              {question.options[k]}
            </button>
          );
        })}
      </div>

      {revealed && (
        <div
          className={`mt-6 rounded-xl p-4 text-center ${
            userCorrect
              ? "bg-[oklch(0.66_0.14_165)]/20 text-[oklch(0.66_0.14_165)]"
              : "bg-destructive/20 text-destructive"
          }`}
        >
          <p className="text-lg font-bold">{userCorrect ? "Você acertou! 🎉" : myAnswer ? "Errou." : "Sem resposta"}</p>
          <p className="mt-1 text-sm">
            Resposta correta: <span className="font-semibold">{question.correct_option}</span>
          </p>
        </div>
      )}
    </div>
  );
}
