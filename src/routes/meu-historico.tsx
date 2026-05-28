import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Award,
  Download,
  FileDown,
  Loader2,
  Mic,
  Search,
  Trophy,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthSession } from "@/hooks/use-auth";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { downloadCertificate } from "@/lib/certificate";
import { toast } from "sonner";

export const Route = createFileRoute("/meu-historico")({
  head: () => ({ meta: [{ title: "Meu Histórico — QuizBini" }] }),
  component: MyHistory,
});

const DEVICE_TOKEN_KEY = "qp:device_token";

function readDeviceToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(DEVICE_TOKEN_KEY);
  } catch {
    return null;
  }
}

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
  presentation_file_url?: string | null;
  allow_download?: boolean;
  event_threshold?: number | null;
  speaker_name?: string | null;
};

function MyHistory() {
  const navigate = useNavigate();
  const { user, loading } = useAuthSession();
  const [query, setQuery] = useState("");
  const [deviceToken, setDeviceToken] = useState<string | null>(null);

  useEffect(() => {
    setDeviceToken(readDeviceToken());
  }, []);

  // FUSÃO DE IDENTIDADE: ao logar, vincula registros anônimos (device_token)
  // deste celular ao google_user_id do usuário, para que o histórico anterior
  // ao login apareça no Currículo.
  useEffect(() => {
    if (!user?.id || !deviceToken) return;
    (async () => {
      try {
        await (supabase.from("participant_scores") as any)
          .update({ google_user_id: user.id, email: user.email ?? null })
          .eq("device_token", deviceToken)
          .is("google_user_id", null);
        await (supabase.from("participants") as any)
          .update({ google_user_id: user.id, email: user.email ?? null })
          .eq("device_token", deviceToken)
          .is("google_user_id", null);
      } catch {
        /* silencioso: a fusão é best-effort */
      }
    })();
  }, [user?.id, user?.email, deviceToken]);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["my-history", user?.id ?? "anon", deviceToken ?? "no-device"],
    enabled: !!(user?.id || deviceToken),
    queryFn: async () => {
      // Une registros vinculados ao Google (se logado) E registros do celular
      // atual (device_token), eliminando duplicatas pelo id.
      const queries: Array<Promise<{ data: any[] | null }>> = [];
      if (user?.id) {
        queries.push(
          (supabase.from("participant_scores") as any)
            .select(
              "id, event_id, presentation_id, participant_name, score, correct_count, answer_count, updated_at",
            )
            .eq("google_user_id", user.id)
            .order("updated_at", { ascending: false }) as any,
        );
      }
      if (deviceToken) {
        queries.push(
          (supabase.from("participant_scores") as any)
            .select(
              "id, event_id, presentation_id, participant_name, score, correct_count, answer_count, updated_at",
            )
            .eq("device_token", deviceToken)
            .order("updated_at", { ascending: false }) as any,
        );
      }
      const results = await Promise.all(queries);
      const byId = new Map<string, HistoryRow>();
      for (const r of results) {
        for (const row of ((r?.data ?? []) as HistoryRow[])) {
          if (!byId.has(row.id)) byId.set(row.id, row);
        }
      }
      const list = Array.from(byId.values()).sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      );
      const evIds = Array.from(new Set(list.map((r) => r.event_id).filter(Boolean))) as string[];
      const prIds = Array.from(new Set(list.map((r) => r.presentation_id).filter(Boolean)));
      const [eventsRes, presRes] = await Promise.all([
        evIds.length > 0
          ? (supabase.from("events") as any)
              .select("id, title, completion_threshold")
              .in("id", evIds)
          : Promise.resolve({ data: [] }),
        prIds.length > 0
          ? (supabase.from("presentations") as any)
              .select("id, title, file_url, allow_download, user_id")
              .in("id", prIds)
          : Promise.resolve({ data: [] }),
      ]);
      const evMap = new Map<string, { title: string; threshold: number }>();
      for (const e of ((eventsRes as any).data ?? []) as any[]) {
        evMap.set(e.id, { title: e.title, threshold: Number(e.completion_threshold ?? 0.7) });
      }
      const prMap = new Map<
        string,
        { title: string; file_url: string; allow_download: boolean; user_id: string }
      >();
      for (const p of ((presRes as any).data ?? []) as any[]) {
        prMap.set(p.id, {
          title: p.title,
          file_url: p.file_url,
          allow_download: !!p.allow_download,
          user_id: p.user_id,
        });
      }
      // Resolve nomes dos palestrantes (perfis)
      const speakerIds = Array.from(
        new Set(Array.from(prMap.values()).map((p) => p.user_id).filter(Boolean)),
      );
      const speakerMap = new Map<string, string>();
      if (speakerIds.length > 0) {
        const { data: profs } = await (supabase.from("profiles") as any)
          .select("user_id, full_name, username")
          .in("user_id", speakerIds);
        for (const p of (profs ?? []) as any[]) {
          speakerMap.set(p.user_id, p.full_name || p.username || "");
        }
      }
      return list.map((r) => ({
        ...r,
        event_title: r.event_id ? evMap.get(r.event_id)?.title ?? "Evento" : "Sem evento",
        event_threshold: r.event_id ? evMap.get(r.event_id)?.threshold ?? 0.7 : 0.7,
        presentation_title: prMap.get(r.presentation_id)?.title ?? "Apresentação",
        presentation_file_url: prMap.get(r.presentation_id)?.file_url ?? null,
        allow_download: !!prMap.get(r.presentation_id)?.allow_download,
        speaker_name:
          (prMap.get(r.presentation_id)?.user_id &&
            speakerMap.get(prMap.get(r.presentation_id)!.user_id)) ||
          null,
      }));
    },
  });

  const filteredRows = useMemo(() => {
    if (!rows) return rows;
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [
        r.event_title ?? "",
        r.presentation_title ?? "",
        r.speaker_name ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, query]);

  // Aba "Minhas Palestras": apresentações onde o usuário é o palestrante
  // (user_id == auth.uid OU speaker_email == e-mail logado).
  type SpeakerRow = {
    id: string;
    title: string;
    created_at: string;
    event_id: string | null;
    event_title?: string | null;
    file_url: string;
    allow_download: boolean;
    participants_count: number;
  };
  const { data: speakerRows, isLoading: speakerLoading } = useQuery({
    queryKey: ["my-speaker-history", user?.id ?? "anon", user?.email ?? ""],
    enabled: !!user?.id,
    queryFn: async (): Promise<SpeakerRow[]> => {
      const emailLower = (user?.email ?? "").toLowerCase();
      // OR no mesmo .or() do PostgREST
      const orParts = [`user_id.eq.${user!.id}`];
      if (emailLower) orParts.push(`speaker_email.eq.${emailLower}`);
      const { data: pres } = await (supabase.from("presentations") as any)
        .select("id, title, created_at, event_id, file_url, allow_download")
        .or(orParts.join(","))
        .order("created_at", { ascending: false });
      const list = ((pres ?? []) as any[]).map((p) => ({
        id: p.id,
        title: p.title,
        created_at: p.created_at,
        event_id: p.event_id,
        file_url: p.file_url,
        allow_download: !!p.allow_download,
        participants_count: 0,
      })) as SpeakerRow[];
      if (list.length === 0) return list;
      const evIds = Array.from(
        new Set(list.map((r) => r.event_id).filter(Boolean)),
      ) as string[];
      const prIds = list.map((r) => r.id);
      const [evRes, scoresRes] = await Promise.all([
        evIds.length > 0
          ? (supabase.from("events") as any).select("id, title").in("id", evIds)
          : Promise.resolve({ data: [] }),
        (supabase.from("participant_scores") as any)
          .select("presentation_id, participant_id")
          .in("presentation_id", prIds),
      ]);
      const evMap = new Map<string, string>();
      for (const e of ((evRes as any).data ?? []) as any[]) evMap.set(e.id, e.title);
      const counts = new Map<string, Set<string>>();
      for (const s of ((scoresRes as any).data ?? []) as any[]) {
        if (!counts.has(s.presentation_id)) counts.set(s.presentation_id, new Set());
        counts.get(s.presentation_id)!.add(s.participant_id);
      }
      return list
        .map((r) => ({
          ...r,
          event_title: r.event_id ? evMap.get(r.event_id) ?? "Evento" : null,
          participants_count: counts.get(r.id)?.size ?? 0,
        }))
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
    },
  });

  const filteredSpeakerRows = useMemo(() => {
    if (!speakerRows) return speakerRows;
    const q = query.trim().toLowerCase();
    if (!q) return speakerRows;
    return speakerRows.filter((r) => {
      const hay = [r.title ?? "", r.event_title ?? ""].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [speakerRows, query]);

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
      <div className="flex min-h-screen items-center justify-center bg-[#0E1015] text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando...
      </div>
    );
  }

  // Sem login E sem device_token: mostra o convite de login (cenário raro,
  // SSR ou primeiro acesso). Se o device_token existir, vamos exibir o
  // currículo anônimo abaixo.
  if (!user && !deviceToken) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#0E1015] p-6 text-center text-white">
        <Award className="h-12 w-12 text-[#F68B1F]" />
        <h1 className="text-2xl font-bold">Currículo</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Entre com sua conta Google para ver os eventos em que você participou,
          suas pontuações, baixar seus certificados e materiais autorizados.
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
    <div className="min-h-screen bg-[#0E1015] text-white">
      <header className="border-b border-[#262D3D] bg-[#131722]">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div>
            <button
              type="button"
              onClick={() => navigate({ to: "/" })}
              className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-[#9CA3AF] hover:text-[#F68B1F]"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Início
            </button>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <Award className="h-6 w-6 text-[#F68B1F]" /> Currículo
            </h1>
            <p className="text-sm text-muted-foreground">
              {user
                ? user.user_metadata?.full_name || user.email
                : "Histórico deste celular — entre com Google para salvar permanentemente"}
            </p>
          </div>
          {user ? (
            <Button
              variant="ghost"
              onClick={async () => {
                await supabase.auth.signOut();
                navigate({ to: "/" });
              }}
            >
              Sair
            </Button>
          ) : (
            <Button onClick={loginGoogle} className="bg-white text-black hover:bg-white/90">
              Entrar com Google
            </Button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">
        {/* Aviso para anônimos: incentivar fusão por login */}
        {!user && deviceToken && rows && rows.length > 0 && (
          <div className="mb-6 flex flex-col gap-3 rounded-xl border border-[#F68B1F]/40 bg-[#1A140E] p-4 md:flex-row md:items-center md:justify-between">
            <p className="text-sm leading-relaxed text-[#FFCB05]">
              Você está vendo o histórico salvo neste celular. Entre com Google
              para preservar suas participações e acessar de qualquer aparelho.
            </p>
            <Button
              onClick={loginGoogle}
              className="bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-white"
            >
              Entrar com Google
            </Button>
          </div>
        )}

        {/* Busca */}
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-[#262D3D] bg-[#161A23] px-3 py-2">
          <Search className="h-4 w-4 text-[#9CA3AF]" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pesquisar por evento, palestra ou palestrante..."
            className="border-0 bg-transparent px-0 text-sm text-white placeholder:text-[#9CA3AF] focus-visible:ring-0"
          />
        </div>

        <Tabs defaultValue="participations" className="w-full">
          <TabsList className="mb-4 grid w-full grid-cols-2 bg-[#161A23] border border-[#262D3D]">
            <TabsTrigger value="participations" className="data-[state=active]:bg-[#07A684] data-[state=active]:text-white">
              <Trophy className="mr-2 h-4 w-4" /> Minhas Participações
            </TabsTrigger>
            <TabsTrigger value="speaker" className="data-[state=active]:bg-[#F68B1F] data-[state=active]:text-white">
              <Mic className="mr-2 h-4 w-4" /> Minhas Palestras
            </TabsTrigger>
          </TabsList>

          <TabsContent value="participations">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando histórico...
          </div>
        ) : !filteredRows || filteredRows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#262D3D] bg-[#161A23]/60 p-12 text-center">
            <Trophy className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              {rows && rows.length > 0
                ? "Nenhuma participação corresponde à sua pesquisa."
                : "Você ainda não participou de nenhuma palestra. Ao entrar em uma sala via QR Code, sua participação aparecerá aqui."}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {filteredRows.map((r) => {
              const pct = r.answer_count > 0 ? r.correct_count / r.answer_count : 0;
              const eligible = pct >= (r.event_threshold ?? 0.7);
              const canDownloadMaterial =
                !!r.allow_download && !!r.presentation_file_url && eligible;
              return (
                <li
                  key={r.id}
                  className="flex flex-col gap-3 rounded-xl border border-[#262D3D] bg-[#161A23] p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="rounded-full bg-[#07A684] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                        Participante
                      </span>
                    </div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      {r.event_title}
                      {r.speaker_name ? ` • ${r.speaker_name}` : ""}
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
                      Acertos: {r.correct_count}/{r.answer_count} ({Math.round(pct * 100)}%)
                    </span>
                    {canDownloadMaterial && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (r.presentation_file_url) {
                            window.open(r.presentation_file_url, "_blank", "noopener,noreferrer");
                          }
                        }}
                        className="border-[#F68B1F]/60 text-[#F68B1F] hover:bg-[#F68B1F]/10 hover:text-[#F68B1F]"
                      >
                        <FileDown className="mr-1.5 h-4 w-4" /> Material
                      </Button>
                    )}
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
          </TabsContent>

          <TabsContent value="speaker">
            {!user ? (
              <div className="rounded-xl border border-dashed border-[#262D3D] bg-[#161A23]/60 p-10 text-center">
                <Mic className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">
                  Entre com Google para ver as palestras vinculadas ao seu e-mail.
                </p>
                <Button
                  onClick={loginGoogle}
                  className="mt-4 bg-white text-black hover:bg-white/90"
                >
                  Entrar com Google
                </Button>
              </div>
            ) : speakerLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando palestras...
              </div>
            ) : !filteredSpeakerRows || filteredSpeakerRows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#262D3D] bg-[#161A23]/60 p-12 text-center">
                <Mic className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">
                  Nenhuma palestra vinculada ao seu e-mail ({user.email}). Quando
                  um palestrante cadastrar este e-mail como dele, a palestra
                  aparecerá aqui automaticamente.
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {filteredSpeakerRows.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-col gap-3 rounded-xl border border-[#262D3D] bg-[#161A23] p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="rounded-full bg-[#F68B1F] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                          Palestrante
                        </span>
                      </div>
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">
                        {s.event_title ?? "Sem evento"}
                      </p>
                      <h3 className="truncate text-base font-semibold">{s.title}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(s.created_at).toLocaleString("pt-BR")}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#161A23] px-3 py-1 font-semibold text-[#07A684]">
                        <Users className="h-3.5 w-3.5" /> {s.participants_count} participantes
                      </span>
                      {s.allow_download && s.file_url && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            window.open(s.file_url, "_blank", "noopener,noreferrer")
                          }
                          className="border-[#F68B1F]/60 text-[#F68B1F] hover:bg-[#F68B1F]/10 hover:text-[#F68B1F]"
                        >
                          <FileDown className="mr-1.5 h-4 w-4" /> Material
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}