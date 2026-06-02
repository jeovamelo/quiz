import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize,
  QrCode,
  Trophy,
  Smartphone,
  ScanLine,
  Power,
  Tv,
  Users,
  LayoutDashboard,
  ExternalLink,
  Clock,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRequireSpeaker } from "@/hooks/use-auth";
import { useRemoteBridge } from "@/hooks/use-remote-bridge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { RemoteAuthorizationPanel } from "@/components/remote-authorization-panel";

export const Route = createFileRoute("/operator/$id")({
  head: () => ({ meta: [{ title: "Central de Controle — QuizBini" }] }),
  component: OperatorConsole,
});

/**
 * Central de Controle do Operador (Desktop).
 * Roda no monitor principal do notebook enquanto a janela `/present/$id`
 * (popup do segundo monitor) projeta os slides.
 *
 * - Envia comandos via `useRemoteBridge` (mesmo canal de tempo real do
 *   celular do palestrante).
 * - Lê o estado dos overlays diretamente da tabela `sessions`, então os
 *   toggles refletem em tempo real qualquer ação tomada no celular.
 */
function OperatorConsole() {
  useRequireSpeaker();
  const { id } = Route.useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState<any>(null);
  const [presentationTitle, setPresentationTitle] = useState<string>("");
  const [participantsCount, setParticipantsCount] = useState(0);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [projectorWindow, setProjectorWindow] = useState<Window | null>(null);
  const [busy, setBusy] = useState(false);

  // Ponte de tempo real (mesma do celular). Como há apenas um projetor
  // recebendo, podemos atuar como mais um "remote" — o servidor de
  // broadcast entrega para todos os assinantes do canal.
  const bridge = useRemoteBridge({ sessionId: id, role: "remote" });

  const joinUrl = useMemo(
    () => (typeof window !== "undefined" ? `${window.location.origin}/join?session=${id}` : ""),
    [id],
  );
  const pairUrl = useMemo(
    () => (typeof window !== "undefined" ? `${window.location.origin}/remote-setup/${id}` : ""),
    [id],
  );

  // === Carrega sessão + apresentação + contagem de participantes ===
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: s } = await supabase.from("sessions").select("*").eq("id", id).single();
      if (cancelled) return;
      setSession(s);
      if (s) {
        const { data: p } = await (supabase.from("presentations") as any)
          .select("title")
          .eq("id", s.presentation_id)
          .single();
        if (!cancelled) setPresentationTitle((p as any)?.title ?? "");
      }
      const { count } = await supabase
        .from("participants")
        .select("id", { count: "exact", head: true })
        .eq("session_id", id);
      if (!cancelled) setParticipantsCount(count ?? 0);
    }
    load();
    const ch = supabase
      .channel(`operator-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sessions", filter: `id=eq.${id}` },
        (payload) => setSession(payload.new),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "participants", filter: `session_id=eq.${id}` },
        async () => {
          const { count } = await supabase
            .from("participants")
            .select("id", { count: "exact", head: true })
            .eq("session_id", id);
          setParticipantsCount(count ?? 0);
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [id]);

  // === Abre o projetor em popup (segundo monitor) ===
  const popupOpenedRef = useRef(false);
  function openProjector() {
    const url = `/present/${id}`;
    const w = window.open(
      url,
      `quizpulse-projector-${id}`,
      "popup=yes,width=1280,height=720,scrollbars=no,toolbar=no,menubar=no,location=no,status=no",
    );
    if (w) {
      setProjectorWindow(w);
      popupOpenedRef.current = true;
      toast.success("Janela do projetor aberta. Arraste-a para o segundo monitor.");
    } else {
      toast.error("O navegador bloqueou o popup. Permita popups e tente de novo.");
    }
  }

  // Auto-abre o projetor na primeira renderização — exige clique do usuário
  // primeiro (autoplay/popup policies), então deixamos a ação no botão.
  useEffect(() => {
    return () => {
      // Ao sair do console, mantemos o projetor aberto (operador pode
      // continuar controlando da rota de origem ou recarregar).
    };
  }, []);

  // === Comandos ===
  async function setFlag(
    field: "show_join_qr" | "show_ranking" | "show_pair_qr" | "is_fullscreen",
    value: boolean,
  ) {
    setBusy(true);
    try {
      const { error } = await (supabase.from("sessions") as any)
        .update({ [field]: value })
        .eq("id", id);
      if (error) toast.error("Falha ao atualizar projeção.");
      if (field === "is_fullscreen") {
        bridge.send("TOGGLE_FULLSCREEN", { value }).catch(() => {});
      }
    } finally {
      setBusy(false);
    }
  }

  async function advance() {
    setBusy(true);
    try {
      const sent = await bridge.send("NEXT");
      if (!sent) toast.warning("Sem sinal do projetor. Verifique a janela aberta.");
    } finally {
      setBusy(false);
    }
  }

  async function back() {
    setBusy(true);
    try {
      const sent = await bridge.send("PREV");
      if (!sent) toast.warning("Sem sinal do projetor.");
    } finally {
      setBusy(false);
    }
  }

  async function endNow() {
    setConfirmEnd(false);
    setBusy(true);
    try {
      await bridge.send("END_EARLY").catch(() => {});
      // Garantia adicional via DB (caso o projetor não esteja respondendo).
      await supabase
        .from("sessions")
        .update({ status: "ended" })
        .eq("id", id);
      toast.success("Apresentação encerrada. Pódio sendo revelado.");
    } finally {
      setBusy(false);
    }
  }

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0E1015] text-white">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando central de controle...
      </div>
    );
  }

  const showJoinQr = !!session.show_join_qr;
  const showRanking = !!session.show_ranking;
  const showPairQr = !!session.show_pair_qr;
  const isFullscreen = !!session.is_fullscreen;
  const isEnded = session.status === "ended";

  return (
    <div className="min-h-screen bg-[#0E1015] text-white">
      {/* Cabeçalho */}
      <header className="sticky top-0 z-10 border-b border-[#262D3D] bg-[#131722]/95 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to="/dashboard"
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[#3A4255] px-3 py-2 text-xs font-semibold text-[#9CA3AF] transition-colors hover:border-[#9CA3AF] hover:text-white"
            >
              <LayoutDashboard className="h-4 w-4" /> Painel
            </Link>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.3em] text-[#F68B1F]">
                <Tv className="h-3 w-3" /> Central de Controle
              </p>
              <h1 className="mt-0.5 truncate text-xl font-black leading-tight">
                {presentationTitle || "Apresentação ao vivo"}
              </h1>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${
                bridge.status === "connected" && bridge.partnerOnline
                  ? "border-[#07A684]/40 bg-[#07A684]/10 text-[#07A684]"
                  : bridge.status === "connected"
                  ? "border-[#FFCB05]/40 bg-[#FFCB05]/10 text-[#FFCB05]"
                  : "border-[#A6193C]/40 bg-[#A6193C]/10 text-[#F68B1F]"
              }`}
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  bridge.partnerOnline
                    ? "bg-[#07A684] animate-pulse"
                    : bridge.status === "connected"
                    ? "bg-[#FFCB05]"
                    : "bg-[#A6193C]"
                }`}
              />
              {bridge.partnerOnline
                ? "Projetor sincronizado"
                : bridge.status === "connected"
                ? "Aguardando projetor"
                : "Sem conexão"}
            </div>
            <div className="flex items-center gap-1.5 rounded-full border border-[#262D3D] bg-[#161A23] px-3 py-1.5 text-xs font-semibold text-[#9CA3AF]">
              <Users className="h-3.5 w-3.5 text-[#07A684]" />
              <span className="font-bold text-white">{participantsCount}</span> usuários
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        {/* Aviso quando o projetor ainda não foi aberto */}
        {!projectorWindow && (
          <section className="rounded-2xl border border-[#F68B1F]/40 bg-gradient-to-br from-[#1A140E] to-[#131722] p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#F68B1F]">
                  Tela do projetor
                </p>
                <h2 className="mt-1 text-lg font-extrabold text-white">
                  Abra a janela da apresentação
                </h2>
                <p className="mt-1 text-sm text-[#9CA3AF]">
                  Clique para abrir a janela do projetor e arraste-a para o segundo monitor.
                </p>
              </div>
              <button
                type="button"
                onClick={openProjector}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#A6193C] to-[#F68B1F] px-5 py-3 text-sm font-extrabold uppercase tracking-wide text-white shadow-lg shadow-[#A6193C]/40 transition active:scale-95"
              >
                <ExternalLink className="h-4 w-4" /> Abrir Tela do Projetor
              </button>
            </div>
          </section>
        )}

        {/* === BLOCO A — Navegação principal === */}
        <section className="rounded-2xl border border-[#262D3D] bg-[#161A23] p-6 shadow-xl">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#9CA3AF]">
                Bloco A · Navegação
              </p>
              <h2 className="mt-1 text-lg font-extrabold text-white">
                Controle do slide e dos quizzes
              </h2>
            </div>
            <p className="hidden text-[11px] text-[#9CA3AF] md:block">
              Slide atual: <span className="font-bold text-white">{session.current_slide ?? 1}</span>
            </p>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-[1fr_2fr]">
            <button
              type="button"
              onClick={back}
              disabled={busy || isEnded}
              className="flex h-20 items-center justify-center gap-2 rounded-xl border border-[#3A4255] bg-[#1E2235] text-base font-bold text-white shadow-md transition active:scale-95 disabled:opacity-40"
            >
              <ChevronLeft className="h-6 w-6" /> Voltar
            </button>
            <button
              type="button"
              onClick={advance}
              disabled={busy || isEnded}
              className="flex h-20 items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-xl font-black uppercase tracking-wide text-white shadow-xl shadow-[#A6193C]/40 transition active:scale-95 disabled:opacity-60"
            >
              Avançar <ChevronRight className="h-7 w-7" strokeWidth={3} />
            </button>
          </div>
        </section>

        {/* === BLOCO B — Overlays === */}
        <RemoteAuthorizationPanel sessionId={id} />

        {session.mode === "ai" && <TimeStatusPanel session={session} />}

        {/* === BLOCO B — Overlays === */}
        <section className="rounded-2xl border border-[#262D3D] bg-[#161A23] p-6 shadow-xl">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#9CA3AF]">
              Bloco B · Exibições no projetor
            </p>
            <h2 className="mt-1 text-lg font-extrabold text-white">
              Alternadores síncronos das modais flutuantes
            </h2>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
            <OperatorToggle
              icon={<Maximize className="h-5 w-5" />}
              label="Alternar Tela Cheia"
              hint="F11 remoto na janela do projetor"
              active={isFullscreen}
              onToggle={() => setFlag("is_fullscreen", !isFullscreen)}
            />
            <OperatorToggle
              icon={<QrCode className="h-5 w-5" />}
              label="QR Code de Participantes"
              hint={joinUrl}
              active={showJoinQr}
              onToggle={() => setFlag("show_join_qr", !showJoinQr)}
            />
            <OperatorToggle
              icon={<Smartphone className="h-5 w-5" />}
              label="QR do Controle Remoto"
              hint={pairUrl}
              active={showPairQr}
              onToggle={() => setFlag("show_pair_qr", !showPairQr)}
            />
            <OperatorToggle
              icon={<Trophy className="h-5 w-5" />}
              label="Classificação em Tempo Real"
              hint="Frame flutuante do ranking sobre o slide"
              active={showRanking}
              onToggle={() => setFlag("show_ranking", !showRanking)}
            />
            <OperatorToggle
              icon={<ScanLine className="h-5 w-5" />}
              label="QR Code Gigante (Atrasados)"
              hint="Mesma modal do QR de participantes, em destaque"
              active={showJoinQr}
              onToggle={() => setFlag("show_join_qr", !showJoinQr)}
            />
          </div>
        </section>

        {/* === BLOCO C — Encerramento === */}
        <section className="rounded-2xl border border-red-500/40 bg-gradient-to-br from-[#1A0E14] to-[#161A23] p-6 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-red-300">
                Bloco C · Ação crítica
              </p>
              <h2 className="mt-1 text-lg font-extrabold text-white">
                Encerrar apresentação precocemente
              </h2>
              <p className="mt-1 text-sm text-[#9CA3AF]">
                Pula para o pódio dos 3 primeiros lugares imediatamente.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmEnd(true)}
              disabled={busy || isEnded}
              className="flex items-center gap-2 rounded-xl border border-red-500/60 bg-red-600/15 px-5 py-3 text-sm font-extrabold uppercase tracking-wide text-red-200 transition active:scale-95 hover:bg-red-600/25 disabled:opacity-40"
            >
              <Power className="h-5 w-5" /> Encerrar Apresentação
            </button>
          </div>
        </section>

        {/* Atalhos rápidos abaixo */}
        <p className="text-center text-[11px] text-[#9CA3AF]">
          💡 <span className="font-bold text-[#FFCB05]">Dica:</span> mantenha a janela do
          projetor em foco no segundo monitor para que o modo tela cheia funcione sem
          intervenção do navegador.
        </p>
      </main>

      <AlertDialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        <AlertDialogContent className="border-[#262D3D] bg-[#0E1015] text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              Deseja realmente encerrar a apresentação e ir para o pódio de 3 lugares agora?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[#9CA3AF]">
              A janela do projetor mudará imediatamente para a revelação dos campeões.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#262D3D] bg-transparent text-[#9CA3AF] hover:bg-[#1E2235] hover:text-white">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={endNow}
              className="bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-white hover:opacity-95"
            >
              Sim, revelar o pódio
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function OperatorToggle({
  icon,
  label,
  hint,
  active,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={`flex w-full items-center gap-3 rounded-xl border px-4 py-4 text-left transition active:scale-[0.98] ${
        active
          ? "border-[#07A684]/50 bg-[#07A684]/10"
          : "border-[#262D3D] bg-[#131722] hover:border-[#3A4255]"
      }`}
    >
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${
          active ? "bg-[#07A684]/20 text-[#07A684]" : "bg-[#1E2235] text-[#9CA3AF]"
        }`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-white">{label}</span>
        <span className="block truncate text-[11px] text-[#9CA3AF]">{hint}</span>
      </span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          active ? "bg-[#07A684]" : "bg-[#3A4255]"
        }`}
        aria-hidden="true"
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            active ? "translate-x-5" : ""
          }`}
        />
      </span>
    </button>
  );
}