import { useQuery } from "@tanstack/react-query";
import { Loader2, Users, BarChart3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Pres = { id: string; title: string };

export function EventAnalytics({ eventId }: { eventId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["event-analytics", eventId],
    refetchInterval: 8000,
    queryFn: async () => {
      // 1. Apresentações do evento
      const { data: pres } = await (supabase.from("presentations") as any)
        .select("id, title, sort_order")
        .eq("event_id", eventId)
        .order("sort_order", { ascending: true });
      const presList = (pres ?? []) as Array<Pres & { sort_order: number }>;
      const presIds = presList.map((p) => p.id);
      if (presIds.length === 0) {
        return { perPresentation: [], participants: [] };
      }

      // 2. Sessões dessas apresentações
      const { data: sessions } = await supabase
        .from("sessions")
        .select("id, presentation_id")
        .in("presentation_id", presIds);
      const sList = (sessions ?? []) as Array<{ id: string; presentation_id: string }>;
      const sessionToPres = new Map(sList.map((s) => [s.id, s.presentation_id]));
      const sessionIds = sList.map((s) => s.id);

      // 3. Participantes conectados (por evento)
      const { data: parts } = await (supabase.from("participants") as any)
        .select("id, session_id, name")
        .in("session_id", sessionIds.length > 0 ? sessionIds : ["00000000-0000-0000-0000-000000000000"]);
      const pList = (parts ?? []) as Array<{ id: string; session_id: string; name: string }>;

      // 4. Respostas
      const { data: answers } = await supabase
        .from("answers")
        .select("participant_id, session_id, response_ms, is_correct")
        .in("session_id", sessionIds.length > 0 ? sessionIds : ["00000000-0000-0000-0000-000000000000"]);
      const aList = (answers ?? []) as Array<{
        participant_id: string;
        session_id: string;
        response_ms: number;
        is_correct: boolean;
      }>;

      // Engajamento por palestra
      const perPresentation = presList.map((p) => {
        const presSessionIds = sList.filter((s) => s.presentation_id === p.id).map((s) => s.id);
        const connected = pList.filter((part) => presSessionIds.includes(part.session_id));
        const answered = new Set(
          aList
            .filter((a) => presSessionIds.includes(a.session_id))
            .map((a) => a.participant_id),
        );
        const rate = connected.length > 0 ? answered.size / connected.length : 0;
        return {
          id: p.id,
          title: p.title,
          connected: connected.length,
          answered: answered.size,
          rate,
        };
      });

      // Lista de participantes com tempo médio
      const partStats = new Map<
        string,
        { name: string; totalMs: number; count: number; correct: number; presentations: Set<string> }
      >();
      for (const p of pList) {
        if (!partStats.has(p.id)) {
          partStats.set(p.id, {
            name: p.name,
            totalMs: 0,
            count: 0,
            correct: 0,
            presentations: new Set(),
          });
        }
      }
      for (const a of aList) {
        const s = partStats.get(a.participant_id);
        if (!s) continue;
        s.totalMs += a.response_ms;
        s.count += 1;
        if (a.is_correct) s.correct += 1;
        const presId = sessionToPres.get(a.session_id);
        if (presId) s.presentations.add(presId);
      }
      const participants = Array.from(partStats.entries())
        .map(([id, s]) => ({
          id,
          name: s.name,
          presentationsCount: s.presentations.size,
          answers: s.count,
          correct: s.correct,
          avgMs: s.count > 0 ? Math.round(s.totalMs / s.count) : 0,
        }))
        .sort((a, b) => b.correct - a.correct);

      return { perPresentation, participants };
    },
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Calculando engajamento...
      </div>
    );
  }

  const maxRate = Math.max(0.0001, ...data.perPresentation.map((d) => d.rate));

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-[#F68B1F]" />
          <h2 className="text-lg font-semibold">Engajamento por Palestra</h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Comparativo entre celulares conectados e participantes que efetivamente
          responderam às perguntas.
        </p>
        {data.perPresentation.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma palestra cadastrada.</p>
        ) : (
          <ul className="space-y-3">
            {data.perPresentation.map((d) => {
              const widthPct = Math.round((d.rate / maxRate) * 100);
              return (
                <li key={d.id}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="truncate font-medium">{d.title}</span>
                    <span className="ml-2 shrink-0 text-muted-foreground">
                      {d.answered}/{d.connected} ·{" "}
                      <span className="font-semibold text-[#F68B1F]">
                        {Math.round(d.rate * 100)}%
                      </span>
                    </span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-[#161A23]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#A6193C] to-[#F68B1F]"
                      style={{ width: `${Math.max(2, widthPct)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <Users className="h-5 w-5 text-[#F68B1F]" />
          <h2 className="text-lg font-semibold">Quem Participou</h2>
        </div>
        {data.participants.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ninguém participou ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4">Nome</th>
                  <th className="py-2 pr-4">Palestras</th>
                  <th className="py-2 pr-4">Acertos</th>
                  <th className="py-2 pr-4">Tempo Médio</th>
                </tr>
              </thead>
              <tbody>
                {data.participants.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="py-2 pr-4 font-medium">{p.name}</td>
                    <td className="py-2 pr-4">{p.presentationsCount}</td>
                    <td className="py-2 pr-4">
                      {p.correct}/{p.answers}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {(p.avgMs / 1000).toFixed(1)}s
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}