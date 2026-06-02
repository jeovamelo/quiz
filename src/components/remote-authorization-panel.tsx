import { useEffect, useState } from "react";
import { Check, X, ShieldCheck, ShieldAlert, Smartphone, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { authorizeRemote, denyRemote, type SessionRemote } from "@/lib/session-remotes";

/**
 * Painel de "Dispositivos de Controle Conectados" exibido no Dashboard
 * do palestrante. Mostra solicitações pendentes e o controle ativo, com
 * botões Autorizar / Negar / Revogar — tudo em tempo real via Realtime.
 */
export function RemoteAuthorizationPanel({ sessionId }: { sessionId: string }) {
  const [rows, setRows] = useState<SessionRemote[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await supabase
        .from("session_remotes")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false });
      if (!cancelled) {
        setRows((data ?? []) as SessionRemote[]);
        setLoading(false);
      }
    }
    load();
    const ch = supabase
      .channel(`remote-auth-${sessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "session_remotes", filter: `session_id=eq.${sessionId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [sessionId]);

  async function handle(action: "authorize" | "deny", id: string) {
    setBusyId(id);
    try {
      if (action === "authorize") await authorizeRemote(id);
      else await denyRemote(id);
      toast.success(action === "authorize" ? "Controle autorizado." : "Solicitação negada.");
    } catch (err: any) {
      toast.error(err?.message || "Falha ao atualizar autorização.");
    } finally {
      setBusyId(null);
    }
  }

  const pending = rows.filter((r) => r.status === "pending");
  const authorized = rows.filter((r) => r.status === "authorized");

  return (
    <section className="rounded-2xl border border-[#262D3D] bg-[#161A23] p-6 shadow-xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#F68B1F]">
            Segurança · Controle Remoto
          </p>
          <h2 className="mt-1 flex items-center gap-2 text-lg font-extrabold text-white">
            <ShieldCheck className="h-5 w-5 text-[#07A684]" /> Dispositivos de Controle Conectados
          </h2>
          <p className="mt-1 text-sm text-[#9CA3AF]">
            Apenas dispositivos autorizados podem enviar comandos para esta apresentação.
          </p>
        </div>
        {pending.length > 0 && (
          <span className="rounded-full bg-[#F68B1F]/20 px-3 py-1 text-xs font-bold text-[#F68B1F]">
            {pending.length} pendente{pending.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="mt-5 space-y-3">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-[#9CA3AF]">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando dispositivos...
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-[#262D3D] bg-[#131722] p-5 text-center text-sm text-[#9CA3AF]">
            Nenhum dispositivo solicitou controle ainda. Escaneie o QR Code do controle remoto no celular para começar.
          </div>
        )}

        {pending.map((r) => (
          <DeviceCard
            key={r.id}
            row={r}
            tone="pending"
            busy={busyId === r.id}
            primary={{ label: "Autorizar", icon: <Check className="h-4 w-4" />, onClick: () => handle("authorize", r.id) }}
            secondary={{ label: "Negar", icon: <X className="h-4 w-4" />, onClick: () => handle("deny", r.id) }}
          />
        ))}

        {authorized.map((r) => (
          <DeviceCard
            key={r.id}
            row={r}
            tone="authorized"
            busy={busyId === r.id}
            secondary={{ label: "Revogar acesso", icon: <X className="h-4 w-4" />, onClick: () => handle("deny", r.id) }}
          />
        ))}
      </div>
    </section>
  );
}

function DeviceCard({
  row,
  tone,
  busy,
  primary,
  secondary,
}: {
  row: SessionRemote;
  tone: "pending" | "authorized";
  busy: boolean;
  primary?: { label: string; icon: React.ReactNode; onClick: () => void };
  secondary?: { label: string; icon: React.ReactNode; onClick: () => void };
}) {
  const borderClass =
    tone === "authorized" ? "border-[#07A684]/40 bg-[#07A684]/5" : "border-[#F68B1F]/40 bg-[#F68B1F]/5";
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border ${borderClass} p-4`}>
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${
            tone === "authorized" ? "bg-[#07A684]/20 text-[#07A684]" : "bg-[#F68B1F]/20 text-[#F68B1F]"
          }`}
        >
          {tone === "authorized" ? <ShieldCheck className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">{row.operator_name}</p>
          <p className="truncate text-xs text-[#9CA3AF]">{row.user_email ?? "sem e-mail"}</p>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
            {tone === "authorized" ? "Autorizado" : "Aguardando aprovação"}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {primary && (
          <button
            type="button"
            onClick={primary.onClick}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-[#07A684] px-4 py-2 text-xs font-extrabold uppercase tracking-wide text-white shadow transition active:scale-95 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : primary.icon}
            {primary.label}
          </button>
        )}
        {secondary && (
          <button
            type="button"
            onClick={secondary.onClick}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs font-extrabold uppercase tracking-wide text-red-200 transition active:scale-95 hover:bg-red-500/20 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : secondary.icon}
            {secondary.label}
          </button>
        )}
        {!primary && !secondary && (
          <span className="flex items-center gap-1 text-xs text-[#9CA3AF]">
            <ShieldAlert className="h-4 w-4" /> sem ações
          </span>
        )}
      </div>
    </div>
  );
}