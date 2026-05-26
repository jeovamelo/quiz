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
    if (b.correct_count !== a.correct_count) return b.correct_count - a.correct_count;
    const avgA = a.answer_count ? a.total_response_ms / a.answer_count : Number.MAX_SAFE_INTEGER;
    const avgB = b.answer_count ? b.total_response_ms / b.answer_count : Number.MAX_SAFE_INTEGER;
    if (avgA !== avgB) return avgA - avgB;
    // mais velho ganha → data de nascimento menor
    return a.birth_date.localeCompare(b.birth_date);
  });
}
