import { useEffect, useState } from "react";
import { User, Sparkles, Loader2, Clock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export type StartMode = "manual" | "ai";

type Props = {
  presentationId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (mode: StartMode, opts?: { totalMinutes?: number }) => void;
};

type AiReadiness = {
  loading: boolean;
  hasVoice: boolean;
  hasScripts: boolean;
  totalMinutes: number;
};

export function StartModeModal({ presentationId, open, onOpenChange, onConfirm }: Props) {
  const [selected, setSelected] = useState<StartMode>("manual");
  const [confirming, setConfirming] = useState(false);
  const [readiness, setReadiness] = useState<AiReadiness>({
    loading: false,
    hasVoice: false,
    hasScripts: false,
    totalMinutes: 0,
  });
  const [step, setStep] = useState<"mode" | "time">("mode");
  const [adjustedMinutes, setAdjustedMinutes] = useState<number>(0);

  useEffect(() => {
    if (!open || !presentationId) return;
    setSelected("manual");
    setConfirming(false);
    setStep("mode");
    setReadiness((r) => ({ ...r, loading: true }));
    (async () => {
      const { data: pres } = await (supabase.from("presentations") as any)
        .select("ai_voice, presenter_mode, total_duration_minutes")
        .eq("id", presentationId)
        .single();
      const { count } = await (supabase.from("slide_scripts") as any)
        .select("id", { count: "exact", head: true })
        .eq("presentation_id", presentationId);
      const total = Number((pres as any)?.total_duration_minutes ?? 0);
      setReadiness({
        loading: false,
        hasVoice: !!(pres && pres.ai_voice),
        hasScripts: (count ?? 0) > 0,
        totalMinutes: total,
      });
      setAdjustedMinutes(total);
      if (pres && (pres as any).presenter_mode === "ai") setSelected("ai");
    })();
  }, [open, presentationId]);

  const aiReady = readiness.hasVoice && readiness.hasScripts;

  function handleConfirm() {
    if (selected === "ai" && !aiReady && !readiness.loading) {
      const ok = window.confirm(
        "Configurações de IA incompletas (roteiro e/ou voz). Deseja prosseguir assim mesmo?",
      );
      if (!ok) return;
    }
    // Para IA com tempo total definido, passa pelo painel de "Status do Tempo"
    if (selected === "ai" && readiness.totalMinutes > 0 && step === "mode") {
      setStep("time");
      return;
    }
    setConfirming(true);
    onConfirm(
      selected,
      selected === "ai" && adjustedMinutes > 0
        ? { totalMinutes: adjustedMinutes }
        : undefined,
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {step === "mode" ? "Como deseja iniciar?" : "Status do Tempo"}
          </DialogTitle>
          <DialogDescription>
            {step === "mode"
              ? "Escolha o modo de execução desta apresentação."
              : "Confirme o tempo total disponível antes do primeiro slide."}
          </DialogDescription>
        </DialogHeader>

        {step === "mode" && (
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <ModeCard
            icon={<User className="h-6 w-6" />}
            title="Apresentação Padrão"
            subtitle="Você controla os slides e a interação manualmente."
            active={selected === "manual"}
            onClick={() => setSelected("manual")}
          />
          <ModeCard
            icon={<Sparkles className="h-6 w-6" />}
            title="Palestrante IA"
            subtitle="Resumo automático, voz (TTS) e gestão de tempo."
            badge={
              readiness.loading
                ? "Verificando…"
                : aiReady
                  ? "Pronto"
                  : "Config. incompleta"
            }
            badgeTone={readiness.loading ? "muted" : aiReady ? "good" : "warn"}
            active={selected === "ai"}
            onClick={() => setSelected("ai")}
          />
        </div>
        )}

        {step === "mode" && selected === "ai" && !readiness.loading && !aiReady && (
          <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            Faltam: {!readiness.hasScripts && "roteiro dos slides"}
            {!readiness.hasScripts && !readiness.hasVoice && " e "}
            {!readiness.hasVoice && "voz selecionada"}. Você ainda pode iniciar e
            configurar depois.
          </p>
        )}

        {step === "time" && (
          <div className="mt-2 space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              <p className="text-sm font-semibold">Tempo total da apresentação</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Original: <strong>{readiness.totalMinutes} min</strong>. Se o evento
              atrasou e você tem menos tempo, ajuste agora — a IA reescreverá o
              roteiro restante automaticamente para terminar dentro do prazo.
            </p>
            <div>
              <Label className="text-xs">Tempo total (minutos)</Label>
              <Input
                type="number"
                min={1}
                max={600}
                value={adjustedMinutes}
                onChange={(e) =>
                  setAdjustedMinutes(Math.max(1, Number(e.target.value)))
                }
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAdjustedMinutes(readiness.totalMinutes)}
              >
                Manter original ({readiness.totalMinutes} min)
              </Button>
              {[-10, -5, +5].map((d) => (
                <Button
                  key={d}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setAdjustedMinutes((m) => Math.max(1, m + d))
                  }
                >
                  {d > 0 ? `+${d}` : d} min
                </Button>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={confirming}>
            Cancelar
          </Button>
          {step === "time" && (
            <Button
              variant="outline"
              onClick={() => setStep("mode")}
              disabled={confirming}
            >
              Voltar
            </Button>
          )}
          <Button onClick={handleConfirm} disabled={confirming}>
            {confirming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {step === "mode" && selected === "ai" && readiness.totalMinutes > 0
              ? "Continuar"
              : "Iniciar apresentação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeCard({
  icon,
  title,
  subtitle,
  active,
  onClick,
  badge,
  badgeTone = "muted",
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  active: boolean;
  onClick: () => void;
  badge?: string;
  badgeTone?: "muted" | "good" | "warn";
}) {
  const toneClass =
    badgeTone === "good"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : badgeTone === "warn"
        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
        : "bg-muted text-muted-foreground";
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "group relative flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all " +
        (active
          ? "border-primary bg-primary/5 ring-2 ring-primary/40"
          : "border-border hover:border-primary/50 hover:bg-accent/30")
      }
    >
      <div
        className={
          "flex h-10 w-10 items-center justify-center rounded-lg " +
          (active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground")
        }
      >
        {icon}
      </div>
      <div className="font-semibold">{title}</div>
      <div className="text-xs text-muted-foreground">{subtitle}</div>
      {badge && (
        <span className={"mt-1 rounded-full px-2 py-0.5 text-[10px] font-medium " + toneClass}>
          {badge}
        </span>
      )}
    </button>
  );
}