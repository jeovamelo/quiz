import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, Smartphone, ArrowLeft, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/login-qr")({
  head: () => ({ meta: [{ title: "Login via QR Code — QuizBini" }] }),
  component: LoginQR,
});

const EXPIRY_SECONDS = 300;

function LoginQR() {
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"creating" | "waiting" | "authorized" | "expired" | "error">("creating");
  const [secondsLeft, setSecondsLeft] = useState(EXPIRY_SECONDS);
  const [authorizedName, setAuthorizedName] = useState<string | null>(null);

  const qrUrl = useMemo(() => {
    if (!token || typeof window === "undefined") return "";
    return `${window.location.origin}/qr-auth/${token}`;
  }, [token]);

  // Create the session row
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("qr_login_sessions")
        .insert({ status: "pending" })
        .select("id")
        .single();
      if (cancelled) return;
      if (error || !data) {
        console.error("[qr-login] create error", error);
        setStatus("error");
        toast.error("Não foi possível gerar o QR Code. Tente novamente.");
        return;
      }
      setToken(data.id);
      setStatus("waiting");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Countdown
  useEffect(() => {
    if (status !== "waiting") return;
    const t = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          setStatus("expired");
          clearInterval(t);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [status]);

  // Realtime subscription + initial poll fallback
  useEffect(() => {
    if (!token) return;
    const sessionId = token;

    async function handleRow(row: any) {
      if (!row) return;
      if (row.status === "authorized" && row.access_token && row.refresh_token) {
        setAuthorizedName(row.user_name ?? row.user_email ?? null);
        setStatus("authorized");
        const { error } = await supabase.auth.setSession({
          access_token: row.access_token,
          refresh_token: row.refresh_token,
        });
        if (error) {
          console.error("[qr-login] setSession error", error);
          toast.error("Falha ao iniciar a sessão.");
          setStatus("error");
          return;
        }
        // Best-effort: clear the tokens from the row so they aren't reusable
        await supabase
          .from("qr_login_sessions")
          .update({ access_token: null, refresh_token: null, status: "consumed" })
          .eq("id", sessionId);
        toast.success("Login confirmado!");
        setTimeout(() => navigate({ to: "/dashboard", replace: true }), 800);
      }
    }

    const channel = supabase
      .channel(`qr-login-${token}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "qr_login_sessions", filter: `id=eq.${sessionId}` },
        (payload) => handleRow(payload.new),
      )
      .subscribe();

    // Initial poll in case the update raced the subscription
    (async () => {
      const { data } = await supabase
        .from("qr_login_sessions")
        .select("*")
        .eq("id", sessionId)
        .maybeSingle();
      if (data?.status === "authorized") void handleRow(data);
    })();

    return () => {
      void supabase.removeChannel(channel);
    };
    // token is non-null in this branch
  }, [token, navigate]);

  const mins = Math.floor(secondsLeft / 60);
  const secs = (secondsLeft % 60).toString().padStart(2, "0");

  return (
    <div className="min-h-screen bg-[#0E1015] text-white flex flex-col">
      <header className="px-6 py-5 border-b border-[#262D3D]">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-[#9CA3AF] hover:text-white transition">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-md bg-[#161A23] border border-[#262D3D] rounded-3xl p-8 text-center">
          <h1 className="text-2xl md:text-3xl font-black">
            Login via <span className="bg-gradient-to-r from-[#F68B1F] to-[#FFCB05] bg-clip-text text-transparent">QR Code</span>
          </h1>
          <p className="mt-2 text-sm text-[#9CA3AF]">
            Escaneie com o celular onde você já está logado.
          </p>

          <div className="mt-8 flex items-center justify-center">
            {status === "creating" && (
              <div className="h-[260px] w-[260px] flex items-center justify-center rounded-2xl bg-[#0E1015] border border-[#262D3D]">
                <Loader2 className="w-8 h-8 animate-spin text-[#F68B1F]" />
              </div>
            )}

            {status === "waiting" && qrUrl && (
              <div className="p-4 rounded-2xl bg-white">
                <QRCodeSVG value={qrUrl} size={232} level="M" includeMargin={false} />
              </div>
            )}

            {status === "authorized" && (
              <div className="h-[260px] w-[260px] flex flex-col items-center justify-center rounded-2xl bg-[#0E1015] border border-[#07A684]/40 gap-3">
                <CheckCircle2 className="w-14 h-14 text-[#07A684]" />
                <p className="font-bold">Autorizado!</p>
                {authorizedName && <p className="text-xs text-[#9CA3AF]">{authorizedName}</p>}
                <p className="text-xs text-[#6B7280]">Entrando…</p>
              </div>
            )}

            {(status === "expired" || status === "error") && (
              <div className="h-[260px] w-[260px] flex flex-col items-center justify-center rounded-2xl bg-[#0E1015] border border-[#A6193C]/40 gap-3 px-4">
                <p className="font-bold text-[#F68B1F]">
                  {status === "expired" ? "QR Code expirado" : "Erro ao gerar"}
                </p>
                <button
                  onClick={() => window.location.reload()}
                  className="mt-2 px-4 py-2 rounded-xl bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-white text-sm font-bold"
                >
                  Gerar novo QR
                </button>
              </div>
            )}
          </div>

          {status === "waiting" && (
            <div className="mt-6 space-y-2">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#0E1015] border border-[#262D3D] text-sm">
                <Smartphone className="w-4 h-4 text-[#FFCB05]" />
                <span className="text-[#9CA3AF]">Aguardando autorização no seu dispositivo móvel</span>
              </div>
              <p className="text-xs text-[#6B7280]">
                Expira em <span className="font-mono text-white">{mins}:{secs}</span>
              </p>
            </div>
          )}

          <div className="mt-8 pt-6 border-t border-[#262D3D] text-left">
            <p className="text-xs font-bold text-[#6B7280] tracking-widest mb-3">COMO USAR</p>
            <ol className="space-y-2 text-xs text-[#9CA3AF] list-decimal list-inside">
              <li>Abra a câmera do celular onde já está logado no QuizBini.</li>
              <li>Aponte para o QR Code acima.</li>
              <li>Confirme a autorização no celular.</li>
              <li>Pronto! Você entrará automaticamente.</li>
            </ol>
          </div>
        </div>
      </main>
    </div>
  );
}
