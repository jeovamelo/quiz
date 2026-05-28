import { useEffect, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Award, Download, Loader2, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthSession } from "@/hooks/use-auth";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { downloadCertificate } from "@/lib/certificate";
import { toast } from "sonner";

export const Route = createFileRoute("/meu-historico")({
  head: () => ({ meta: [{ title: "Meu Histórico — QuizHubine" }] }),
  component: MyHistory,
});

type HistoryRow = {
  id: string;
  event_id: string | null;
  presentation_id: string;
  participant_name: string;
  score: number;
  correct_count: number;
  answer_count: number;
  updated_at: string;
  event_title?: string | null;
  presentation_title?: string | null;
  event_threshold?: number | null;
};

function MyHistory() {
  const navigate = useNavigate();
  const { user, loading } = useAuthSession();

  const { data: rows, isLoading } = useQuery({
    queryKey: ["my-history", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data: scores, error } = await (supabase.from("participant_scores") as any)
        .select(
          "id, event_id, presentation_id, participant_name, score, correct_count, answer_count, updated_at",
        )
        .eq("google_user_id", user!.id)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      const list = (scores ?? []) as HistoryRow[];
      const evIds = Array.from(new Set(list.map((r) => r.event_id).filter(Boolean))) as string[];
      const prIds = Array.from(new Set(list.map((r) => r.presentation_id).filter(Boolean)));
      const [eventsRes, presRes] = await Promise.all([
        evIds.length > 0
          ? (supabase.from("events") as any)
              .select("id, title, completion_threshold")
              .in("id", evIds)
          : Promise.resolve({ data: [] }),
        prIds.length > 0
          ? (supabase.from("presentations") as any).select("id, title").in("id", prIds)
          : Promise.resolve({ data: [] }),
      ]);
      const evMap = new Map<string, { title: string; threshold: number }>();
      for (const e of ((eventsRes as any).data ?? []) as any[]) {
        evMap.set(e.id, { title: e.title, threshold: Number(e.completion_threshold ?? 0.7) });
      }
      const prMap = new Map<string, string>();
      for (const p of ((presRes as any).data ?? []) as any[]) prMap.set(p.id, p.title);
      return list.map((r) => ({
        ...r,
        event_title: r.event_id ? evMap.get(r.event_id)?.title ?? "Evento" : "Sem evento",
        event_threshold: r.event_id ? evMap.get(r.event_id)?.threshold ?? 0.7 : 0.7,
        presentation_title: prMap.get(r.presentation_id) ?? "Apresentação",
      }));
    },
  });

  useEffect(() => {
    if (!loading && !user) {
      // não redireciona automaticamente: mostra estado vazio com botão de login
    }
  }, [loading, user]);

  async function loginGoogle() {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + "/meu-historico",
    });
    if (result.error) toast.error("Não foi possível iniciar o login.");
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <Award className="h-12 w-12 text-[#F68B1F]" />
        <h1 className="text-2xl font-bold">Meu Histórico</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Entre com sua conta Google para ver os eventos em que você participou,
          suas pontuações e baixar seus certificados.
        </p>
        <Button onClick={loginGoogle} className="bg-white text-black hover:bg-white/90">
          Entrar com Google
        </Button>
        <Link to="/" className="text-sm text-muted-foreground underline">
          Voltar ao início
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div>
            <button
              type="button"
              onClick={() => navigate({ to: "/" })}
              className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-[#9CA3AF] hover:text-[#F68B1F]"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Início
            </button>
            <h1 className="text-2xl font-bold">Meu Histórico</h1>
            <p className="text-sm text-muted-foreground">
              {user.user_metadata?.full_name || user.email}
            </p>
          </div>
          <Button
            variant="ghost"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/" });
            }}
          >
            Sair
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando histórico...
          </div>
        ) : !rows || rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/40 p-12 text-center">
            <Trophy className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              Você ainda não participou de nenhuma palestra com a sua conta logada.
              Quando entrar em uma sala via QR Code, lembre-se de fazer login com
              Google para salvar o histórico.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => {
              const pct = r.answer_count > 0 ? r.correct_count / r.answer_count : 0;
              const eligible = pct >= (r.event_threshold ?? 0.7);
              return (
                <li
                  key={r.id}
                  className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      {r.event_title}
                    </p>
                    <h3 className="truncate text-base font-semibold">
                      {r.presentation_title}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(r.updated_at).toLocaleString("pt-BR")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="rounded-full bg-[#161A23] px-3 py-1 font-semibold text-[#FFCB05]">
                      {r.score} pts
                    </span>
                    <span className="text-muted-foreground">
                      {r.correct_count}/{r.answer_count} ({Math.round(pct * 100)}%)
                    </span>
                    {eligible ? (
                      <Button
                        size="sm"
                        onClick={() =>
                          downloadCertificate({
                            participantName: r.participant_name,
                            eventTitle: r.event_title || "Evento",
                            presentationTitle: r.presentation_title,
                            score: r.score,
                            correctCount: r.correct_count,
                            answerCount: r.answer_count,
                            generatedAt: new Date(r.updated_at),
                          })
                        }
                        className="bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-white"
                      >
                        <Download className="mr-1.5 h-4 w-4" /> Certificado
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Aproveitamento abaixo da meta para certificado
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}