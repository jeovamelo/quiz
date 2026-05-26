import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import confetti from "canvas-confetti";
import { Loader2 } from "lucide-react";
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
    if (!ranking || ranking.length === 0 || confettiFired.current) return;
    confettiFired.current = true;
    const end = Date.now() + 4000;
    const colors = ["#ffd700", "#c0c0c0", "#cd7f32", "#ff7a18", "#ffffff"];
    (function frame() {
      confetti({ particleCount: 4, angle: 60, spread: 70, origin: { x: 0 }, colors });
      confetti({ particleCount: 4, angle: 120, spread: 70, origin: { x: 1 }, colors });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }, [ranking]);

  if (isLoading || !ranking) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Calculando ranking do evento...
      </div>
    );
  }

  const top3 = ranking.slice(0, 3);
  const rest = ranking.slice(3, 20);
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

      {rest.length > 0 && (
        <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">Classificação geral</h3>
          <ol className="space-y-1">
            {rest.map((p, idx) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded border border-border bg-background/40 px-3 py-2 text-sm"
              >
                <span>
                  <span className="mr-2 inline-block w-6 text-right text-muted-foreground">{idx + 4}.</span>
                  {p.name}
                </span>
                <span className="font-semibold text-primary">{p.score} pts</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <Button variant="outline" onClick={() => navigate({ to: "/event/$id", params: { id } })}>
        Voltar ao Evento
      </Button>
    </div>
  );
}