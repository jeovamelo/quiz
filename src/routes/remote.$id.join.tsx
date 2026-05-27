import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  claimRemoteSlot,
  getOrCreateDeviceToken,
  loadStoredRemote,
  saveStoredRemote,
} from "@/lib/session-remotes";
import { haptic } from "@/hooks/use-haptic";

export const Route = createFileRoute("/remote/$id/join")({
  head: () => ({ meta: [{ title: "Ativar Controle Remoto — QuizPulse" }] }),
  component: RemoteJoin,
});

function RemoteJoin() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sessionExists, setSessionExists] = useState<boolean | null>(null);

  // Verifica que a sessão existe e pré-preenche o nome se já houver cadastro.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: s } = await supabase
        .from("sessions")
        .select("id, status")
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      setSessionExists(!!s);
      const stored = loadStoredRemote(id);
      if (stored?.name) setName(stored.name);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function activate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      toast.error("Digite seu nome (mínimo 2 letras).");
      return;
    }
    if (trimmed.length > 60) {
      toast.error("Nome muito longo (máx. 60 caracteres).");
      return;
    }
    setSubmitting(true);
    try {
      const deviceToken = getOrCreateDeviceToken(id);
      const claimed = await claimRemoteSlot(id, trimmed, deviceToken);
      if (!claimed) {
        toast.error("Os 2 controles desta sessão já estão conectados.");
        return;
      }
      saveStoredRemote(id, {
        remoteId: claimed.id,
        slot: claimed.slot as 1 | 2,
        name: claimed.operator_name,
        deviceToken,
      });
      haptic(60);
      toast.success(`Você é o Controle ${claimed.slot}!`);
      navigate({ to: "/remote/$id", params: { id } });
    } catch (err: any) {
      toast.error(err?.message || "Falha ao ativar controle remoto.");
    } finally {
      setSubmitting(false);
    }
  }

  if (sessionExists === false) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-[#0E1015] p-6 text-center text-white">
        <h1 className="text-2xl font-black">Sessão não encontrada</h1>
        <p className="text-sm text-[#9CA3AF]">
          Confira com o palestrante se o QR Code é desta apresentação.
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-[#0E1015] via-[#131722] to-[#0E1015] px-6 text-white">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-[#A6193C]/20 via-[#F68B1F]/10 to-transparent blur-3xl" />

      <form onSubmit={activate} className="relative z-10 w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#A6193C] to-[#F68B1F] shadow-lg">
            <Smartphone className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-3xl font-black tracking-tight">Qual é o seu nome?</h1>
          <p className="mt-2 text-sm text-[#9CA3AF]">
            Esse nome aparecerá no projetor para identificar este controle.
          </p>
        </div>

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-widest text-[#F68B1F]">
            Seu nome
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Jeová Silva"
            autoFocus
            maxLength={60}
            required
            className="mt-2 w-full rounded-xl border border-[#262D3D] bg-[#131722] px-4 py-4 text-lg font-semibold text-white placeholder:text-[#3A4255] focus:border-[#F68B1F] focus:outline-none focus:ring-2 focus:ring-[#F68B1F]/40"
          />
        </label>

        <button
          type="submit"
          disabled={submitting || sessionExists === null}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#A6193C] to-[#F68B1F] px-6 py-4 text-base font-extrabold uppercase tracking-wide text-white shadow-2xl shadow-[#A6193C]/40 transition-all duration-100 active:scale-95 disabled:opacity-60"
        >
          {submitting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" /> Conectando...
            </>
          ) : (
            <>Ativar Controle Remoto 📱</>
          )}
        </button>
      </form>
    </div>
  );
}