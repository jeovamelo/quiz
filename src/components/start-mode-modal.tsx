import { useEffect, useState } from "react";
import { User, Sparkles, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export type StartMode = "manual" | "ai";

type Props = {
  presentationId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (mode: StartMode) => void;
};

type AiReadiness = {
  loading: boolean;
  hasVoice: boolean;
  hasScripts: boolean;
};

export function StartModeModal({ presentationId, open, onOpenChange, onConfirm }: Props) {
  const [selected, setSelected] = useState<StartMode>("manual");
  const [confirming, setConfirming] = useState(false);
  const [readiness, setReadiness] = useState<AiReadiness>({
    loading: false,
    hasVoice: false,
    hasScripts: false,
  });

  useEffect(() => {
    if (!open || !presentationId) return;
    setSelected("manual");
    setConfirming(false);
    setReadiness((r) => ({ ...r, loading: true }));
    (async () => {
      const { data: pres } = await (supabase.from("presentations") as any)
        .select("ai_voice, presenter_mode")
        .eq("id", presentationId)
        .single();
      const { count } = await (supabase.from("slide_scripts") as any)
        .select("id", { count: "exact", head: true })
        .eq("presentation_id", presentationId);
      setReadiness({
        loading: false,
        hasVoice: !!(pres && pres.ai_voice),
        hasScripts: (count ?? 0) > 0,
      });
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
    setConfirming(true);
    onConfirm(selected);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Como deseja iniciar?</DialogTitle>
          <DialogDescription>
            Escolha o modo de execução desta apresentação.
          </DialogDescription>
        </DialogHeader>

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

        {selected === "ai" && !readiness.loading && !aiReady && (
          <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            Faltam: {!readiness.hasScripts && "roteiro dos slides"}
            {!readiness.hasScripts && !readiness.hasVoice && " e "}
            {!readiness.hasVoice && "voz selecionada"}. Você ainda pode iniciar e
            configurar depois.
          </p>
        )}

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={confirming}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={confirming}>
            {confirming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Iniciar apresentação
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