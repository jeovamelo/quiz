import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { sortRanking, type ParticipantRow } from "@/lib/ranking";
import { DraggableFrame } from "@/components/draggable-frame";

type Props = {
  open: boolean;
  sessionId: string;
  onClose: () => void;
};

/**
 * Frame flutuante centralizado de Classificação em tempo real.
 * Aciona-se pelo controle remoto (celular do palestrante).
 */
export function RankingOverlay({ open, sessionId, onClose }: Props) {
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function fetchAll() {
      const { data } = await supabase
        .from("participants")
        .select("*")
        .eq("session_id", sessionId);
      if (!cancelled) setParticipants((data as any) ?? []);
    }
    fetchAll();
    const ch = supabase
      .channel(`ranking-overlay-${sessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "participants", filter: `session_id=eq.${sessionId}` },
        () => fetchAll(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "answers", filter: `session_id=eq.${sessionId}` },
        () => fetchAll(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [open, sessionId]);

  const ranking = sortRanking(participants).slice(0, 12);

  return (
    <DraggableFrame
      open={open}
      onClose={onClose}
      storageKey="ranking-overlay-pos"
      ariaLabel="Classificação em tempo real"
      headerBg="#F68B1F"
      borderColor="#F68B1F99"
      header={<span>🏆 CLASSIFICAÇÃO — RANKING EM TEMPO REAL</span>}
    >
      <div className="p-7">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#FFCB05] to-[#F68B1F] text-[#0E1015] shadow-lg">
            <Trophy className="h-6 w-6" />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#F68B1F]">
              Classificação
            </p>
            <h2 className="text-2xl font-black leading-tight text-white">
              Ranking em tempo real
            </h2>
          </div>
        </div>

        <ol className="mt-6 space-y-2 max-h-[55vh] overflow-y-auto pr-1">
          {ranking.length === 0 && (
            <li className="rounded-lg border border-dashed border-[#262D3D] px-4 py-6 text-center text-sm text-[#9CA3AF]">
              Aguardando participantes...
            </li>
          )}
          {ranking.map((p, idx) => {
            const pos = idx + 1;
            const badge =
              pos === 1
                ? "bg-gradient-to-br from-[#FFCB05] to-[#F68B1F] text-[#0E1015]"
                : pos === 2
                ? "bg-[#9CA3AF] text-[#0E1015]"
                : pos === 3
                ? "bg-[#A6193C] text-white"
                : "bg-[#0E1015] text-[#9CA3AF] border border-[#262D3D]";
            const firstName = (p.name || "").trim().split(/\s+/)[0] || "—";
            return (
              <li
                key={p.id}
                className="flex items-center gap-3 rounded-xl border border-[#262D3D] bg-[#0E1015]/70 px-3 py-2.5"
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-black ${badge}`}
                >
                  {pos}º
                </span>
                <span className="flex-1 truncate text-base font-bold text-white">
                  {firstName}
                </span>
                <span className="font-mono text-base font-extrabold text-[#FFCB05]">
                  {p.score}
                  <span className="ml-1 text-[10px] font-normal text-[#9CA3AF]">pts</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </DraggableFrame>
  );
}
