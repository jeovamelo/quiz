import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRequireSpeaker } from "@/hooks/use-auth";
import { ArrowLeft, Trophy, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/event/$id/classificacao-geral")({
  head: () => ({ meta: [{ title: "Classificação Geral — QuizBini" }] }),
  component: ClassificacaoGeral,
});

type AggRow = {
  key: string;
  name: string;
  score: number;
  correct_count: number;
  answer_count: number;
  total_response_ms: number;
  presentations_participated: number;
  birth_date: string;
};

function formatAvgMs(ms: number) {
  if (!ms || !isFinite(ms)) return "—";
  const s = ms / 1000;
  return `${s.toFixed(1)}s`;
}

function ClassificacaoGeral() {
  useRequireSpeaker();
  const { id } = Route.useParams();
  const navigate = useNavigate();

  const { data: event, isLoading: loadingEvent, isError: eventError } = useQuery({
    queryKey: ["event", id],
    queryFn: async () => {
      const { data, error } = await (supabase.from("events") as any)
        .select("title")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    enabled: !!id,
    retry: 1,
  });

  const { data: ranking, isLoading: loadingRanking } = useQuery({
    queryKey: ["event-classificacao-geral", id],
    queryFn: async () => {
      const { data, error } = await (supabase.from("participant_scores") as any)
        .select(
          "device_token, participant_name, birth_date, score, correct_count, answer_count, total_response_ms, presentation_id",
        )
        .eq("event_id", id);
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        device_token: string | null;
        participant_name: string;
        birth_date: string | null;
        score: number;
        correct_count: number;
        answer_count: number;
        total_response_ms: number;
        presentation_id: string;
      }>;
      const map = new Map<string, AggRow & { _presIds: Set<string> }>();
      for (const r of rows ?? []) {
        const key =
          r?.device_token ||
          `anon:${r?.participant_name ?? ""}:${r?.birth_date ?? ""}:${r?.presentation_id ?? ""}`;
        const cur = map.get(key);
        if (cur) {
          cur.score += r.score ?? 0;
          cur.correct_count += r.correct_count ?? 0;
          cur.answer_count += r.answer_count ?? 0;
          cur.total_response_ms += r.total_response_ms ?? 0;
          if (r.presentation_id) cur._presIds.add(r.presentation_id);
        } else {
          map.set(key, {
            key,
            name: r.participant_name || "Participante",
            score: r.score ?? 0,
            correct_count: r.correct_count ?? 0,
            answer_count: r.answer_count ?? 0,
            total_response_ms: r.total_response_ms ?? 0,
            birth_date: r.birth_date ?? "9999-12-31",
            presentations_participated: 1,
            _presIds: new Set(r.presentation_id ? [r.presentation_id] : []),
          });
        }
      }
      const list: AggRow[] = Array.from(map.values()).map((r) => ({
        key: r.key,
        name: r.name,
        score: r.score,
        correct_count: r.correct_count,
        answer_count: r.answer_count,
        total_response_ms: r.total_response_ms,
        birth_date: r.birth_date,
        presentations_participated: r._presIds.size,
      }));
      list.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.correct_count !== a.correct_count) return b.correct_count - a.correct_count;
        const avgA = a.answer_count ? a.total_response_ms / a.answer_count : Number.MAX_SAFE_INTEGER;
        const avgB = b.answer_count ? b.total_response_ms / b.answer_count : Number.MAX_SAFE_INTEGER;
        if (avgA !== avgB) return avgA - avgB;
        return a.birth_date.localeCompare(b.birth_date);
      });
      return list;
    },
    enabled: !!id,
    retry: 1,
    refetchInterval: 5000,
  });

  if (loadingEvent || loadingRanking) {
    return (
      <div className="min-h-screen bg-[#0E1015] flex flex-col items-center justify-center gap-4">
        <div className="w-10 h-10 rounded-full border-4 border-t-transparent border-[#F68B1F] animate-spin" />
        <p className="text-sm text-[#9CA3AF] font-medium">
          Carregando classificação do evento...
        </p>
      </div>
    );
  }

  if (eventError || !event) {
    return (
      <div className="min-h-screen bg-[#0E1015] flex flex-col items-center justify-center gap-4 text-center p-6">
        <AlertTriangle className="h-10 w-10 text-amber-500" />
        <h2 className="text-lg font-bold text-white">Evento não encontrado</h2>
        <p className="text-xs text-[#9CA3AF] max-w-sm">
          O link está corrompido ou o evento foi removido do painel administrativo.
        </p>
        <button
          onClick={() => navigate({ to: "/dashboard" })}
          className="mt-4 px-4 py-2 bg-[#161A23] border border-[#262D3D] text-white rounded-xl text-xs hover:bg-[#252C41] transition"
        >
          Voltar ao Painel
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0E1015] text-foreground">
      <header className="border-b border-[#262D3D] bg-[#131722]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={() => navigate({ to: "/event/$id", params: { id } })}
              className="border-[#262D3D] text-[#9CA3AF] hover:border-[#F68B1F] hover:text-[#F68B1F]"
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Voltar para o Evento
            </Button>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                {event?.title ?? "Evento"}
              </p>
              <h1 className="truncate text-2xl font-bold text-white">
                Classificação Geral
              </h1>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-[#FFCB05]/40 bg-[#FFCB05]/10 px-4 py-1.5 text-xs font-semibold text-[#FFCB05] md:flex">
            <Trophy className="h-4 w-4" /> Visão administrativa
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {!ranking || ranking.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#262D3D] bg-[#161A23] p-12 text-center">
            <Trophy className="mx-auto h-12 w-12 text-[#9CA3AF]" />
            <h2 className="mt-4 text-lg font-semibold text-white">
              Ainda não há participantes pontuados neste evento
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Assim que as apresentações começarem, a classificação aparecerá aqui em tempo real.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[#262D3D] bg-[#161A23]">
            <table className="w-full text-sm">
              <thead className="bg-[#131722] text-[11px] uppercase tracking-wider text-[#9CA3AF]">
                <tr>
                  <th className="px-4 py-3 text-left">Colocação</th>
                  <th className="px-4 py-3 text-left">Nome</th>
                  <th className="px-4 py-3 text-right">Pontuação Acumulada</th>
                  <th className="px-4 py-3 text-right">Tempo Médio de Resposta</th>
                  <th className="px-4 py-3 text-right">Apresentações Participadas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#262D3D]">
                {ranking?.map((p, idx) => {
                  const pos = idx + 1;
                  const avg = p.answer_count ? p.total_response_ms / p.answer_count : 0;
                  const badge =
                    pos === 1
                      ? "bg-[#FFCB05] text-black"
                      : pos === 2
                        ? "bg-[#C0C0C0] text-black"
                        : pos === 3
                          ? "bg-[#FFE6CB] text-[#A6193C]"
                          : "bg-[#262D3D] text-[#9CA3AF]";
                  return (
                    <tr
                      key={p.key}
                      className={pos <= 3 ? "bg-[#FFCB05]/[0.03]" : "hover:bg-white/5"}
                    >
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex h-9 min-w-[3rem] items-center justify-center rounded-full px-3 text-sm font-extrabold ${badge}`}
                        >
                          {pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : `${pos}º`}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-white">{p.name}</td>
                      <td className="px-4 py-3 text-right text-base font-bold text-[#F68B1F]">
                        {p.score} pts
                      </td>
                      <td className="px-4 py-3 text-right text-[#9CA3AF]">
                        {formatAvgMs(avg)}
                      </td>
                      <td className="px-4 py-3 text-right text-[#9CA3AF]">
                        {p.presentations_participated}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}