import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { Loader2, Zap, ArrowLeft, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { aggregateEventRanking, type ScoreRow } from "@/lib/ranking";

export const Route = createFileRoute("/event/$id/podium")({
  head: () => ({ meta: [{ title: "Grande Pódio do Evento — QuizPulse" }] }),
  component: EventPodium,
});

function EventPodium() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const confettiFired = useRef(false);
  const [finaleMode, setFinaleMode] = useState(false);

  const { data: event } = useQuery({
    queryKey: ["event", id],
    queryFn: async () => {
      const { data } = await (supabase.from("events") as any)
        .select("title")
        .eq("id", id)
        .maybeSingle();
      return data;
    },
  });

  const { data: ranking, isLoading } = useQuery({
    queryKey: ["event-podium", id],
    queryFn: async () => {
      const { data, error } = await (supabase.from("participant_scores") as any)
        .select("device_token, participant_name, birth_date, score, correct_count, answer_count, total_response_ms")
        .eq("event_id", id);
      if (error) throw error;
      return aggregateEventRanking((data ?? []) as ScoreRow[]);
    },
    refetchInterval: 3000,
  });

  useEffect(() => {
    if (finaleMode) return;
    if (!ranking || ranking.length === 0 || confettiFired.current) return;
    confettiFired.current = true;
    const end = Date.now() + 4000;
    const colors = ["#ffd700", "#c0c0c0", "#cd7f32", "#ff7a18", "#ffffff"];
    (function frame() {
      confetti({ particleCount: 4, angle: 60, spread: 70, origin: { x: 0 }, colors });
      confetti({ particleCount: 4, angle: 120, spread: 70, origin: { x: 1 }, colors });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }, [ranking, finaleMode]);

  if (isLoading || !ranking) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Calculando ranking do evento...
      </div>
    );
  }

  if (finaleMode) {
    return <DramaticReveal eventId={id} ranking={ranking} onExit={() => setFinaleMode(false)} />;
  }

  const top3 = ranking.slice(0, 3);
  const slots: Array<{ place: 1 | 2 | 3; p: (typeof ranking)[number] }> = [];
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
        <p className="text-sm uppercase tracking-widest text-muted-foreground">{event?.title ?? "Evento"}</p>
        <h1 className="mt-2 text-6xl font-extrabold text-foreground">Grande Pódio do Evento</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Soma da pontuação de todas as apresentações do evento
        </p>
      </div>

      {top3.length === 0 ? (
        <p className="text-xl text-muted-foreground">Ainda não há pontuações registradas.</p>
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

      {ranking.length > 0 && (
        <div className="w-full max-w-2xl rounded-xl border border-[#262D3D] bg-[#161A23] p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white">
            Classificação geral ({ranking.length} {ranking.length === 1 ? "participante" : "participantes"})
          </h3>
          <ol className="space-y-1">
            {ranking.map((p, idx) => {
              const pos = idx + 1;
              const medal = pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : null;
              return (
                <li
                  key={p.id}
                  className={`flex items-center justify-between rounded border px-3 py-2 text-sm ${
                    pos <= 3
                      ? "border-[#F68B1F]/40 bg-[#F68B1F]/5"
                      : "border-[#262D3D] bg-[#0E1015]/60"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="inline-flex w-8 justify-end text-right font-bold text-muted-foreground">
                      {medal ?? `${pos}º`}
                    </span>
                    <span className="font-medium text-white">{p.name}</span>
                  </span>
                  <span className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{p.correct_count}/{p.answer_count} acertos</span>
                    <span className="text-base font-bold text-[#F68B1F]">{p.score} pts</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button variant="outline" onClick={() => navigate({ to: "/event/$id", params: { id } })}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Voltar ao Evento
        </Button>
        {top3.length > 0 && (
          <Button
            onClick={() => setFinaleMode(true)}
            className="border-0 bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-white shadow-lg shadow-[#A6193C]/40 hover:opacity-95"
          >
            <Zap className="mr-2 h-4 w-4" /> Encerrar com Revelação Dramática
          </Button>
        )}
      </div>
    </div>
  );
}

type RankItem = {
  id: string;
  name: string;
  score: number;
  device_token?: string | null;
};

function DramaticReveal({
  eventId,
  ranking,
  onExit,
}: {
  eventId: string;
  ranking: Array<RankItem & Record<string, any>>;
  onExit: () => void;
}) {
  // step: 0 = nada revelado, 1 = bronze, 2 = prata, 3 = ouro
  const [step, setStep] = useState(0);
  const [flash, setFlash] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);

  const top3 = useMemo(() => ranking.slice(0, 3), [ranking]);
  const third = top3[2];
  const second = top3[1];
  const first = top3[0];

  // Tempo entre batidas do coração (acelera conforme a revelação avança)
  const beatInterval = step >= 3 ? 380 : step === 2 ? 520 : step === 1 ? 700 : 900;

  // Web Audio: batida grave sintetizada
  useEffect(() => {
    function getCtx() {
      if (!audioCtxRef.current) {
        try {
          const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
          if (Ctx) audioCtxRef.current = new Ctx();
        } catch {
          /* sem áudio */
        }
      }
      return audioCtxRef.current;
    }
    function boom(freq = 55, dur = 0.18, gain = 0.35) {
      const ctx = getCtx();
      if (!ctx) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(freq, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.4), ctx.currentTime + dur);
      g.gain.setValueAtTime(gain, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + dur);
    }
    function doubleBeat() {
      boom(60, 0.16, 0.32);
      window.setTimeout(() => boom(48, 0.18, 0.28), 140);
    }
    const tick = () => {
      doubleBeat();
    };
    // primeiro toque imediato
    tick();
    heartbeatTimerRef.current = window.setInterval(tick, beatInterval) as unknown as number;
    return () => {
      if (heartbeatTimerRef.current) window.clearInterval(heartbeatTimerRef.current);
    };
  }, [beatInterval]);

  useEffect(() => {
    return () => {
      try {
        audioCtxRef.current?.close();
      } catch {
        /* noop */
      }
    };
  }, []);

  async function broadcastWinner(place: 1 | 2 | 3, p?: RankItem) {
    if (!p?.device_token) return;
    try {
      const ch = supabase.channel(`event-finale-${eventId}`);
      await new Promise<void>((resolve) => {
        ch.subscribe((status) => {
          if (status === "SUBSCRIBED") resolve();
        });
        window.setTimeout(() => resolve(), 800);
      });
      await ch.send({
        type: "broadcast",
        event: "winner",
        payload: { place, device_token: p.device_token, name: p.name, score: p.score },
      });
      window.setTimeout(() => {
        supabase.removeChannel(ch);
      }, 500);
    } catch {
      /* ignorar erro de realtime */
    }
  }

  function fireConfetti(strong: boolean) {
    const end = Date.now() + (strong ? 5000 : 1400);
    const colors = strong
      ? ["#FFCB05", "#F68B1F", "#A6193C", "#FFFFFF", "#FFE6CB"]
      : ["#FFE6CB", "#F68B1F"];
    (function frame() {
      confetti({
        particleCount: strong ? 8 : 4,
        angle: 60,
        spread: 75,
        origin: { x: 0, y: 0.7 },
        colors,
      });
      confetti({
        particleCount: strong ? 8 : 4,
        angle: 120,
        spread: 75,
        origin: { x: 1, y: 0.7 },
        colors,
      });
      if (strong) {
        confetti({
          particleCount: 6,
          startVelocity: 55,
          spread: 360,
          origin: { x: 0.5, y: 0.4 },
          colors,
        });
      }
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }

  async function revealNext() {
    if (step >= 3) return;
    if (step === 0) {
      fireConfetti(false);
      await broadcastWinner(3, third);
      setStep(1);
    } else if (step === 1) {
      fireConfetti(false);
      await broadcastWinner(2, second);
      setStep(2);
    } else if (step === 2) {
      setFlash(true);
      window.setTimeout(() => setFlash(false), 320);
      fireConfetti(true);
      await broadcastWinner(1, first);
      setStep(3);
    }
  }

  const nextLabel =
    step === 0
      ? "Revelar 3º Colocado (Bronze)"
      : step === 1
      ? "Revelar 2º Colocado (Prata)"
      : step === 2
      ? "Revelar o Campeão!"
      : "Revelação concluída";

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#08090C] text-white"
      style={{ animation: `qp-shake ${Math.max(0.18, beatInterval / 1000 / 2)}s ease-in-out infinite` }}
    >
      <style>{`
        @keyframes qp-heartbeat {
          0% { transform: scale(0.85); opacity: 0.35; }
          15% { transform: scale(1.05); opacity: 0.85; }
          30% { transform: scale(0.92); opacity: 0.5; }
          45% { transform: scale(1.0); opacity: 0.8; }
          100% { transform: scale(0.85); opacity: 0.3; }
        }
        @keyframes qp-shake {
          0%, 100% { transform: translate(0, 0); }
          25% { transform: translate(-1.5px, 1px); }
          50% { transform: translate(1.5px, -1px); }
          75% { transform: translate(-1px, -1.5px); }
        }
        @keyframes qp-pedestal-shake {
          0%, 100% { transform: translate(0,0) rotate(0deg); }
          25% { transform: translate(-4px, 2px) rotate(-0.6deg); }
          50% { transform: translate(4px, -2px) rotate(0.6deg); }
          75% { transform: translate(-3px, -3px) rotate(-0.4deg); }
        }
        @keyframes qp-text-flicker {
          0%, 100% { opacity: 0.9; }
          50% { opacity: 0.45; }
        }
      `}</style>

      {/* Fundo de batimento cardíaco */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at center, rgba(166,25,60,0.55) 0%, rgba(166,25,60,0.18) 35%, rgba(8,9,12,0) 70%)",
          animation: `qp-heartbeat ${beatInterval / 1000}s ease-in-out infinite`,
        }}
      />
      {flash && <div className="pointer-events-none absolute inset-0 z-50 bg-white/90" />}

      <div className="relative z-10 flex w-full max-w-6xl flex-col items-center gap-10 p-8">
        <div className="text-center">
          <p
            className="text-xs uppercase tracking-[0.4em] text-white/70"
            style={{ animation: "qp-text-flicker 1.6s ease-in-out infinite" }}
          >
            Calculando a pontuação acumulada...
          </p>
          <h1 className="mt-3 text-5xl font-extrabold tracking-tight md:text-6xl">
            Cerimônia de Premiação
          </h1>
        </div>

        <div className="flex w-full items-end justify-center gap-6 md:gap-10">
          <PodiumSlot
            place={2}
            revealed={step >= 2}
            participant={second}
            heightClass="h-56"
            color="from-[#C0C0C0] to-[#8A8A8A]"
            label="2º"
            shake={step === 1}
          />
          <PodiumSlot
            place={1}
            revealed={step >= 3}
            participant={first}
            heightClass="h-80"
            color="from-[#FFCB05] to-[#F68B1F]"
            label="1º"
            shake={step === 2}
            champion
          />
          <PodiumSlot
            place={3}
            revealed={step >= 1}
            participant={third}
            heightClass="h-40"
            color="from-[#FFE6CB] to-[#A6193C]"
            label="3º"
            shake={step === 0}
          />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          {step < 3 ? (
            <Button
              onClick={revealNext}
              size="lg"
              className="border-0 bg-gradient-to-r from-[#A6193C] to-[#F68B1F] px-8 text-base font-bold text-white shadow-2xl shadow-[#A6193C]/50 hover:opacity-95"
            >
              <Zap className="mr-2 h-5 w-5" /> {nextLabel}
            </Button>
          ) : (
            <div className="flex items-center gap-2 rounded-full bg-[#FFCB05]/15 px-6 py-2 text-[#FFCB05]">
              <Trophy className="h-5 w-5" /> Campeão consagrado!
            </div>
          )}
          <Button
            variant="outline"
            onClick={onExit}
            className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
          >
            Sair da Revelação
          </Button>
        </div>
      </div>
    </div>
  );
}

function PodiumSlot({
  place,
  revealed,
  participant,
  heightClass,
  color,
  label,
  shake,
  champion,
}: {
  place: 1 | 2 | 3;
  revealed: boolean;
  participant?: RankItem;
  heightClass: string;
  color: string;
  label: string;
  shake: boolean;
  champion?: boolean;
}) {
  const shakeStyle = shake
    ? { animation: "qp-pedestal-shake 0.12s linear infinite" }
    : undefined;
  return (
    <div className="flex w-44 flex-col items-center gap-3 md:w-56">
      <div
        className="flex h-24 w-24 items-center justify-center"
        style={shakeStyle}
      >
        {revealed ? (
          champion ? (
            <Trophy className="h-20 w-20 text-[#FFCB05] drop-shadow-[0_0_25px_rgba(255,203,5,0.8)]" />
          ) : (
            <div className="text-5xl">{place === 2 ? "🥈" : "🥉"}</div>
          )
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-black text-4xl font-black text-white/40 ring-2 ring-white/15">
            ?
          </div>
        )}
      </div>

      <div className="min-h-[3.25rem] text-center">
        {revealed && participant ? (
          <>
            <div
              className={`font-extrabold leading-tight ${
                champion ? "text-3xl text-[#FFCB05] drop-shadow-[0_0_18px_rgba(255,203,5,0.7)] md:text-4xl" : "text-xl text-white md:text-2xl"
              }`}
            >
              {participant.name}
            </div>
            <div className={`text-sm ${champion ? "text-[#FFCB05]/90" : "text-white/80"}`}>
              {participant.score} pts
            </div>
          </>
        ) : (
          <div className="text-sm uppercase tracking-widest text-white/40">
            Mistério
          </div>
        )}
      </div>

      <div
        className={`flex w-full items-start justify-center rounded-t-xl bg-gradient-to-b ${color} ${heightClass} pt-4 text-3xl font-black text-white shadow-2xl ${
          shake ? "" : ""
        }`}
        style={shakeStyle}
      >
        {label}
      </div>
    </div>
  );
}