import { AlertCircle, Brain, CheckCircle2, Loader2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { ModelProgress } from "@/lib/local-ai";

type Props = ModelProgress & {
  onStart?: () => void;
};

export function ModelLoader({ status, message, percent, onStart }: Props) {
  if (status === "idle") {
    return (
      <div className="text-center py-6 space-y-4">
        <Brain className="size-10 mx-auto text-[#F68B1F]/60" />
        <div>
          <p className="font-semibold text-sm">Motor de IA Local</p>
          <p className="text-xs text-[#9CA3AF] mt-1 max-w-xs mx-auto">
            O modelo (~150 MB) é baixado uma única vez e fica em cache no navegador.
            Funciona mesmo sem internet após o primeiro uso.
          </p>
        </div>
        {onStart && (
          <Button
            onClick={onStart}
            className="gap-2 bg-[#F68B1F] hover:bg-[#F26B1F] text-white"
          >
            <Zap className="size-4" />
            Inicializar IA Local
          </Button>
        )}
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="space-y-3 py-3">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin text-[#F68B1F] shrink-0" />
          <span className="text-[#9CA3AF] truncate">{message}</span>
        </div>
        <Progress value={percent} className="h-1.5 bg-[#262D3D]" />
        <div className="flex justify-between text-xs text-[#6B7280]">
          <span>Baixando modelo de IA…</span>
          <span>{percent}%</span>
        </div>
      </div>
    );
  }

  if (status === "ready") {
    return (
      <div className="flex items-center gap-2 text-sm text-green-400 py-1">
        <CheckCircle2 className="size-4 shrink-0" />
        Motor de IA pronto — processamento 100% local.
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm text-red-400 py-1">
      <AlertCircle className="size-4 shrink-0" />
      {message || "Erro ao carregar modelo."}
    </div>
  );
}
