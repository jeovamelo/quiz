export type ParticipantRow = {
  id: string;
  name: string;
  birth_date: string;
  score: number;
  correct_count: number;
  total_response_ms: number;
  answer_count: number;
};

export function sortRanking(rows: ParticipantRow[]): ParticipantRow[] {
  return [...rows].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.correct_count !== a.correct_count) return b.correct_count - a.correct_count;
    const avgA = a.answer_count ? a.total_response_ms / a.answer_count : Number.MAX_SAFE_INTEGER;
    const avgB = b.answer_count ? b.total_response_ms / b.answer_count : Number.MAX_SAFE_INTEGER;
    if (avgA !== avgB) return avgA - avgB;
    // mais velho ganha → data de nascimento menor
    return a.birth_date.localeCompare(b.birth_date);
  });
}

export type ScoreRow = {
  device_token: string | null;
  participant_name: string;
  birth_date: string | null;
  score: number;
  correct_count: number;
  answer_count: number;
  total_response_ms: number;
};

// Agrega pontuações de múltiplas apresentações pelo device_token (mesmo celular).
// Quando device_token está ausente, cada linha é tratada individualmente.
export function aggregateEventRanking(rows: ScoreRow[]): ParticipantRow[] {
  const map = new Map<string, ParticipantRow>();
  for (const r of rows) {
    const key = r.device_token || `anon:${r.participant_name}:${r.birth_date ?? ""}:${Math.random()}`;
    const cur = map.get(key);
    if (cur) {
      cur.score += r.score;
      cur.correct_count += r.correct_count;
      cur.answer_count += r.answer_count;
      cur.total_response_ms += r.total_response_ms;
    } else {
      map.set(key, {
        id: key,
        name: r.participant_name || "Participante",
        birth_date: r.birth_date ?? "9999-12-31",
        score: r.score,
        correct_count: r.correct_count,
        answer_count: r.answer_count,
        total_response_ms: r.total_response_ms,
      });
    }
  }
  return sortRanking(Array.from(map.values()));
}
