import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Check, X, Sparkles, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

const USERNAME_REGEX = /^[a-z0-9_]{3,30}$/;

function suggestUsername(fullName: string | null | undefined, email: string | null | undefined): string {
  const base = (fullName ?? email?.split("@")[0] ?? "usuario")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 30);
  return base || "usuario";
}

type Availability = "idle" | "checking" | "available" | "taken" | "invalid";

export function OnboardingModal({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [username, setUsername] = useState("");
  const [availability, setAvailability] = useState<Availability>("idle");
  const [saving, setSaving] = useState(false);
  const [organization, setOrganization] = useState("");
  const [bio, setBio] = useState("");
  const checkSeqRef = useRef(0);

  const fullName = useMemo(
    () => (user.user_metadata?.full_name as string) ?? (user.user_metadata?.name as string) ?? "",
    [user]
  );
  const avatarUrl = useMemo(
    () => (user.user_metadata?.avatar_url as string) ?? (user.user_metadata?.picture as string) ?? "",
    [user]
  );

  // 1) Verifica se já existe perfil completo
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, onboarding_completed")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error("[onboarding] erro ao buscar perfil", error);
        setLoadingProfile(false);
        return;
      }
      if (!data) {
        setUsername(suggestUsername(fullName, user.email));
        setOpen(true);
      } else if (!data.onboarding_completed) {
        setUsername(data.username);
        setStep(2);
        setOpen(true);
      }
      setLoadingProfile(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user.id, fullName, user.email]);

  // 2) Validação debounced de unicidade do username
  useEffect(() => {
    if (step !== 1) return;
    const value = username.trim().toLowerCase();
    if (!value) {
      setAvailability("idle");
      return;
    }
    if (!USERNAME_REGEX.test(value)) {
      setAvailability("invalid");
      return;
    }
    setAvailability("checking");
    const seq = ++checkSeqRef.current;
    const handle = setTimeout(async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id")
        .ilike("username", value)
        .maybeSingle();
      if (seq !== checkSeqRef.current) return;
      if (error) {
        console.error("[onboarding] erro ao validar username", error);
        setAvailability("idle");
        return;
      }
      if (!data || data.user_id === user.id) {
        setAvailability("available");
      } else {
        setAvailability("taken");
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [username, step, user.id]);

  function handleUsernameChange(raw: string) {
    // Bloqueia espaços e força minúsculas; remove caracteres inválidos.
    const cleaned = raw.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9_]/g, "");
    setUsername(cleaned.slice(0, 30));
  }

  async function handleConfirmUsername() {
    if (availability !== "available") return;
    setSaving(true);
    const payload = {
      user_id: user.id,
      username: username.trim().toLowerCase(),
      full_name: fullName || null,
      avatar_url: avatarUrl || null,
      onboarding_completed: false,
    };
    const { error } = await supabase.from("profiles").upsert(payload, { onConflict: "user_id" });
    setSaving(false);
    if (error) {
      if ((error as any).code === "23505") {
        setAvailability("taken");
        toast.error("Nome de usuário indisponível.");
      } else {
        console.error("[onboarding] erro ao salvar perfil", error);
        toast.error("Não foi possível salvar agora. Tente novamente.");
      }
      return;
    }
    toast.success(`Nome confirmado: @${payload.username}`);
    setStep(2);
  }

  async function finishOnboarding(skip: boolean) {
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        organization: skip ? null : organization.trim() || null,
        bio: skip ? null : bio.trim() || null,
        onboarding_completed: true,
      })
      .eq("user_id", user.id);
    setSaving(false);
    if (error) {
      console.error("[onboarding] erro ao concluir", error);
      toast.error("Não foi possível concluir o cadastro.");
      return;
    }
    toast.success("Cadastro concluído. Boas apresentações!");
    setOpen(false);
  }

  if (loadingProfile) return null;

  return (
    <Dialog open={open} onOpenChange={() => { /* bloqueia fechamento — onboarding obrigatório */ }}>
      <DialogContent
        className="bg-[#161A23] border-[#262D3D] text-white max-w-md p-0 overflow-hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {/* Faixa decorativa */}
        <div className="h-1.5 bg-gradient-to-r from-[#A6193C] via-[#F68B1F] to-[#FFCB05]" />

        <div className="p-6">
          {/* Cabeçalho com avatar do Google */}
          <div className="flex items-center gap-4 mb-5">
            <div className="w-14 h-14 rounded-2xl overflow-hidden bg-[#0E1015] border border-[#262D3D] flex items-center justify-center">
              {avatarUrl ? (
                <img src={avatarUrl} alt={fullName || "Avatar"} className="w-full h-full object-cover" />
              ) : (
                <UserIcon className="w-6 h-6 text-[#9CA3AF]" />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-xs text-[#FFCB05] font-bold tracking-wide flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> CONECTADO COM GOOGLE
              </div>
              <div className="text-base font-semibold truncate">{fullName || user.email}</div>
              {fullName && <div className="text-xs text-[#9CA3AF] truncate">{user.email}</div>}
            </div>
          </div>

          {step === 1 ? (
            <>
              <DialogHeader className="text-left space-y-2 mb-4">
                <DialogTitle className="text-2xl font-black text-white">
                  Olá! Seja bem-vindo ao QuizBini.
                </DialogTitle>
                <DialogDescription className="text-[#9CA3AF] text-sm">
                  Escolha seu nome de usuário. Ele aparece nos eventos que você criar e ajuda seu público a te encontrar.
                </DialogDescription>
              </DialogHeader>

              <label className="block text-xs font-semibold text-[#9CA3AF] mb-2">
                NOME DE USUÁRIO
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280] font-semibold">@</span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => handleUsernameChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === " ") e.preventDefault(); }}
                  className="w-full pl-8 pr-10 py-3 rounded-xl bg-[#0E1015] border border-[#262D3D] focus:border-[#F68B1F] outline-none text-white font-medium"
                  placeholder="seunome"
                  autoFocus
                  maxLength={30}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2">
                  {availability === "checking" && <Loader2 className="w-4 h-4 text-[#9CA3AF] animate-spin" />}
                  {availability === "available" && <Check className="w-4 h-4 text-[#07A684]" />}
                  {(availability === "taken" || availability === "invalid") && <X className="w-4 h-4 text-[#EF4444]" />}
                </span>
              </div>

              <div className="min-h-[20px] mt-2 text-xs">
                {availability === "available" && <span className="text-[#07A684]">✓ Nome disponível</span>}
                {availability === "taken" && <span className="text-[#EF4444]">Nome de usuário indisponível</span>}
                {availability === "invalid" && (
                  <span className="text-[#EF4444]">
                    Use de 3 a 30 caracteres: letras minúsculas, números e _
                  </span>
                )}
                {availability === "idle" && (
                  <span className="text-[#6B7280]">Sem espaços. Apenas letras, números e underscore.</span>
                )}
                {availability === "checking" && <span className="text-[#9CA3AF]">Verificando disponibilidade…</span>}
              </div>

              <button
                onClick={handleConfirmUsername}
                disabled={availability !== "available" || saving}
                className="w-full mt-5 py-3 rounded-xl bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-white font-bold shadow-lg shadow-[#A6193C]/30 hover:opacity-95 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {saving ? "Salvando…" : "Confirmar e continuar"}
              </button>
            </>
          ) : (
            <>
              <DialogHeader className="text-left space-y-2 mb-4">
                <DialogTitle className="text-2xl font-black text-white">
                  Quase pronto, @{username}!
                </DialogTitle>
                <DialogDescription className="text-[#9CA3AF] text-sm">
                  Conte um pouco mais sobre você (opcional). Você pode pular e preencher depois.
                </DialogDescription>
              </DialogHeader>

              <label className="block text-xs font-semibold text-[#9CA3AF] mb-2">
                ONDE VOCÊ ESTUDA OU TRABALHA
              </label>
              <input
                type="text"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                className="w-full px-3 py-3 rounded-xl bg-[#0E1015] border border-[#262D3D] focus:border-[#F68B1F] outline-none text-white"
                placeholder="Ex.: Sua Empresa"
                maxLength={120}
              />

              <label className="block text-xs font-semibold text-[#9CA3AF] mt-4 mb-2">
                MINI BIO
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                className="w-full px-3 py-3 rounded-xl bg-[#0E1015] border border-[#262D3D] focus:border-[#F68B1F] outline-none text-white resize-none"
                placeholder="Palestrante, professor, criador de conteúdo…"
                maxLength={280}
              />

              <div className="mt-5 flex gap-3">
                <button
                  onClick={() => finishOnboarding(true)}
                  disabled={saving}
                  className="flex-1 py-3 rounded-xl border border-[#374151] text-white hover:bg-[#0E1015] transition font-semibold disabled:opacity-50"
                >
                  Pular por agora
                </button>
                <button
                  onClick={() => finishOnboarding(false)}
                  disabled={saving}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-white font-bold shadow-lg shadow-[#A6193C]/30 hover:opacity-95 transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {saving ? "Salvando…" : "Salvar"}
                </button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}