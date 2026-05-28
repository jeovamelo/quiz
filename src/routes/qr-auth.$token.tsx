import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { Loader2, ShieldCheck, Monitor, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuthSession } from "@/hooks/use-auth";
import { toast } from "sonner";

export const Route = createFileRoute("/qr-auth/$token")({
  head: () => ({ meta: [{ title: "Autorizar Login — QuizBini" }] }),
  component: QRAuth,
});

function QRAuth() {
  const { token } = Route.useParams();
  const { session, user, loading } = useAuthSession();
  const navigate = useNavigate();

  const [sessionState, setSessionState] = useState<"checking" | "valid" | "expired" | "consumed" | "notfound">("checking");
  const [authorizing, setAuthorizing] = useState(false);
  const [done, setDone] = useState(false);

  // Validate the QR session
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("qr_login_sessions")
        .select("status, expires_at")
        .eq("id", token)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setSessionState("notfound");
        return;
      }
      if (data.status !== "pending") {
        setSessionState("consumed");
        return;
      }
      if (new Date(data.expires_at).getTime() < Date.now()) {
        setSessionState("expired");
        return;
      }
      setSessionState("valid");
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleGoogleLogin() {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: `${window.location.origin}/qr-auth/${token}`,
    });
    if (result.error) toast.error("Erro ao autenticar com Google.");
  }

  async function handleAuthorize() {
    if (!session || !user) return;
    setAuthorizing(true);
    try {
      const { error } = await supabase
        .from("qr_login_sessions")
        .update({
          status: "authorized",
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          authorized_user_id: user.id,
          user_email: user.email ?? null,
          user_name:
            (user.user_metadata?.full_name as string | undefined) ??
            (user.user_metadata?.name as string | undefined) ??
            user.email ??
            null,
          authorized_at: new Date().toISOString(),
        })
        .eq("id", token);

      if (error) {
        console.error("[qr-auth] authorize error", error);
        toast.error("Não foi possível autorizar. O QR Code pode ter expirado.");
        setSessionState("expired");
        return;
      }
      setDone(true);
      toast.success("Login autorizado no computador!");
    } finally {
      setAuthorizing(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0E1015] text-white flex flex-col">
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm bg-[#161A23] border border-[#262D3D] rounded-3xl p-6 text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-[#A6193C] to-[#F68B1F] flex items-center justify-center">
            <Monitor className="w-7 h-7 text-white" />
          </div>
          <h1 className="mt-4 text-xl font-black">Autorizar acesso no computador</h1>

          {(loading || sessionState === "checking") && (
            <div className="mt-8 flex justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-[#F68B1F]" />
            </div>
          )}

          {!loading && sessionState === "notfound" && (
            <div className="mt-6 space-y-3">
              <XCircle className="w-12 h-12 text-[#A6193C] mx-auto" />
              <p className="text-sm text-[#9CA3AF]">QR Code inválido ou não encontrado.</p>
            </div>
          )}

          {!loading && sessionState === "expired" && (
            <div className="mt-6 space-y-3">
              <XCircle className="w-12 h-12 text-[#A6193C] mx-auto" />
              <p className="text-sm text-[#9CA3AF]">Este QR Code expirou. Gere um novo no computador.</p>
            </div>
          )}

          {!loading && sessionState === "consumed" && (
            <div className="mt-6 space-y-3">
              <CheckCircle2 className="w-12 h-12 text-[#07A684] mx-auto" />
              <p className="text-sm text-[#9CA3AF]">Este QR Code já foi utilizado.</p>
            </div>
          )}

          {!loading && sessionState === "valid" && !done && (
            <>
              {!session ? (
                <div className="mt-6 space-y-4">
                  <p className="text-sm text-[#9CA3AF]">
                    Para autorizar este login, entre primeiro com sua conta Google.
                  </p>
                  <button
                    onClick={handleGoogleLogin}
                    className="w-full py-3 rounded-2xl bg-white text-[#0E1015] font-bold"
                  >
                    Entrar com Google
                  </button>
                </div>
              ) : (
                <div className="mt-6 space-y-4 text-left">
                  <div className="p-4 rounded-2xl bg-[#0E1015] border border-[#262D3D]">
                    <p className="text-xs text-[#6B7280]">Logado como</p>
                    <p className="text-sm font-bold mt-1 break-all">{user?.email}</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-[#0E1015] border border-[#F68B1F]/30 flex gap-3">
                    <ShieldCheck className="w-5 h-5 text-[#F68B1F] flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-[#9CA3AF]">
                      Ao confirmar, o computador que está exibindo este QR Code entrará
                      logado com a sua conta. Só autorize se foi você quem gerou o QR.
                    </p>
                  </div>
                  <button
                    onClick={handleAuthorize}
                    disabled={authorizing}
                    className="w-full py-3 rounded-2xl bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-white font-bold disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {authorizing && <Loader2 className="w-4 h-4 animate-spin" />}
                    {authorizing ? "Autorizando…" : "Autorizar login"}
                  </button>
                  <button
                    onClick={() => navigate({ to: "/dashboard" })}
                    className="w-full py-2 text-xs text-[#6B7280] hover:text-white transition"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </>
          )}

          {done && (
            <div className="mt-6 space-y-3">
              <CheckCircle2 className="w-14 h-14 text-[#07A684] mx-auto" />
              <p className="font-bold">Login autorizado!</p>
              <p className="text-xs text-[#9CA3AF]">
                Pode voltar para o computador — você já está logado lá.
              </p>
              <Link
                to="/dashboard"
                className="inline-block mt-3 px-4 py-2 rounded-xl border border-[#262D3D] text-sm hover:bg-[#0E1015] transition"
              >
                Ir para o painel
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
