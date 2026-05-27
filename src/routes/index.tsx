import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { Upload, Sparkles, Radio, Presentation, Users, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuthSession } from "@/hooks/use-auth";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "QuizHubine — Apresentações Interativas em Tempo Real" }] }),
  component: Landing,
});

function GoogleIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.2c-2 1.5-4.6 2.4-7.3 2.4-5.2 0-9.6-3.3-11.2-8L6.3 32.6C9.6 39.4 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.6l6.2 5.2c-.4.4 6.7-4.9 6.7-14.8 0-1.3-.1-2.3-.4-3.5z"/>
    </svg>
  );
}

function LoginDialog({ trigger, mode }: { trigger: React.ReactNode; mode: "login" | "signup" }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleGoogle() {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: `${window.location.origin}/dashboard`,
      });
      if (result.error) {
        toast.error("Erro ao autenticar com Google.");
        setLoading(false);
      }
    } catch (e) {
      toast.error("Não foi possível iniciar o login.");
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="bg-[#161A23] border-[#262D3D] text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-white">
            {mode === "login" ? "Acessar QuizHubine" : "Criar conta de palestrante"}
          </DialogTitle>
          <DialogDescription className="text-[#9CA3AF]">
            Entre com sua conta Google para gerenciar suas apresentações, eventos e quizzes.
          </DialogDescription>
        </DialogHeader>
        <button
          onClick={handleGoogle}
          disabled={loading}
          className="w-full mt-4 py-4 rounded-2xl bg-white text-[#0E1015] font-semibold flex items-center justify-center gap-3 hover:bg-white/90 transition disabled:opacity-60"
        >
          <GoogleIcon />
          {loading ? "Conectando..." : "Continuar com o Google"}
        </button>
        <p className="text-xs text-[#6B7280] text-center mt-4">
          Ao continuar, você concorda com os termos de uso da plataforma QuizHubine.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function Landing() {
  const { session, loading } = useAuthSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && session) {
      navigate({ to: "/dashboard", replace: true });
    }
  }, [loading, session, navigate]);

  async function handleHeroCTA() {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: `${window.location.origin}/dashboard`,
    });
    if (result.error) toast.error("Erro ao autenticar com Google.");
  }

  return (
    <div className="min-h-screen bg-[#0E1015] text-white">
      {/* Navbar */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-[#0E1015]/80 border-b border-[#262D3D]">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#A6193C] to-[#F68B1F] flex items-center justify-center font-black">Q</div>
            <span className="text-xl font-bold tracking-tight">
              Quiz<span className="bg-gradient-to-r from-[#F68B1F] to-[#FFCB05] bg-clip-text text-transparent">Hubine</span>
            </span>
          </div>
          <nav className="hidden md:flex items-center gap-8 text-sm text-[#9CA3AF]">
            <a href="#como-funciona" className="hover:text-white transition">Como Funciona</a>
            <a href="#funcionalidades" className="hover:text-white transition">Funcionalidades</a>
            <a href="#contato" className="hover:text-white transition">Contato</a>
          </nav>
          <div className="flex items-center gap-3">
            <LoginDialog
              mode="login"
              trigger={
                <button className="px-4 py-2 rounded-xl border border-[#374151] text-white hover:bg-[#161A23] transition text-sm font-semibold">
                  Login
                </button>
              }
            />
            <LoginDialog
              mode="signup"
              trigger={
                <button className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-white hover:opacity-90 transition text-sm font-bold shadow-lg shadow-[#A6193C]/30">
                  Cadastrar-se
                </button>
              }
            />
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(246,139,31,0.15),_transparent_60%)]" />
        <div className="relative max-w-6xl mx-auto px-6 py-24 md:py-32 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#161A23] border border-[#262D3D] text-xs font-semibold text-[#FFCB05] mb-8">
            <Sparkles className="w-3.5 h-3.5" /> Powered by IA — Banco do Nordeste
          </div>
          <h1 className="text-4xl md:text-6xl font-black tracking-tight leading-tight max-w-4xl mx-auto">
            Transforme suas palestras em{" "}
            <span className="bg-gradient-to-r from-[#A6193C] via-[#F68B1F] to-[#FFCB05] bg-clip-text text-transparent">
              apresentações interativas
            </span>{" "}
            em tempo real.
          </h1>
          <p className="mt-6 text-lg md:text-xl text-[#9CA3AF] max-w-2xl mx-auto">
            Carregue sua apresentação em PDF, gere perguntas inteligentes com IA em segundos
            e engaje seu público diretamente pelo celular, sem que eles precisem baixar nada
            ou fazer login.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4">
            <button
              onClick={handleHeroCTA}
              className="group relative px-10 py-5 rounded-2xl bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-white text-lg font-black shadow-2xl shadow-[#A6193C]/40 hover:scale-105 transition-transform animate-pulse-cta flex items-center gap-3"
            >
              <GoogleIcon />
              Começar Grátis com o Google
            </button>
            <p className="text-xs text-[#6B7280]">
              Sem cartão de crédito • Acesso imediato após o login
            </p>
          </div>
        </div>
      </section>

      {/* Como Funciona */}
      <section id="como-funciona" className="py-24 border-t border-[#262D3D]">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-black">Como Funciona</h2>
            <p className="mt-3 text-[#9CA3AF]">Três etapas simples para começar a engajar seu público.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: Upload,
                step: "01",
                title: "Upload Simplificado",
                desc: "Carregue sua apresentação em PDF no nosso visualizador nativo página por página.",
                color: "from-[#A6193C] to-[#F68B1F]",
              },
              {
                icon: Sparkles,
                step: "02",
                title: "Configuração com IA",
                desc: "Defina dificuldade, tempo de resposta e crie quizzes de Verdadeiro/Falso ou Múltipla Escolha usando Inteligência Artificial.",
                color: "from-[#F68B1F] to-[#FFCB05]",
              },
              {
                icon: Radio,
                step: "03",
                title: "Engajamento Realtime",
                desc: "Projete os slides em modo Cinema. O público entra escaneando o QR Code pelo celular e responde síncronamente na hora certa.",
                color: "from-[#FFCB05] to-[#07A684]",
              },
            ].map(({ icon: Icon, step, title, desc, color }) => (
              <div key={step} className="relative p-8 rounded-2xl bg-[#161A23] border border-[#262D3D] hover:border-[#F68B1F]/40 transition group">
                <div className={`absolute -top-5 left-8 w-12 h-12 rounded-2xl bg-gradient-to-br ${color} flex items-center justify-center font-black text-white shadow-lg`}>
                  <Icon className="w-6 h-6" />
                </div>
                <div className="mt-4 text-xs font-bold text-[#6B7280] tracking-widest">PASSO {step}</div>
                <h3 className="mt-2 text-xl font-bold">{title}</h3>
                <p className="mt-3 text-sm text-[#9CA3AF] leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Funcionalidades */}
      <section id="funcionalidades" className="py-24 border-t border-[#262D3D] bg-[#0B0D12]">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-black">Funcionalidades</h2>
            <p className="mt-3 text-[#9CA3AF]">Tudo que você precisa para conduzir eventos inesquecíveis.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: Presentation, title: "Modo Cinema", desc: "Apresente em tela cheia no projetor com QR Code visível para o público." },
              { icon: Users, title: "Sem Barreiras", desc: "Participantes entram apenas com nome e data de nascimento — zero atrito." },
              { icon: Trophy, title: "Pódio Sensacional", desc: "Revele os campeões com efeitos visuais e sonoros memoráveis." },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="p-6 rounded-2xl bg-[#161A23] border border-[#262D3D]">
                <Icon className="w-8 h-8 text-[#F68B1F]" />
                <h3 className="mt-4 text-lg font-bold">{title}</h3>
                <p className="mt-2 text-sm text-[#9CA3AF]">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contato / CTA Final */}
      <section id="contato" className="py-24 border-t border-[#262D3D]">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-black">Pronto para revolucionar suas palestras?</h2>
          <p className="mt-4 text-[#9CA3AF]">Comece agora gratuitamente. Sem cartão, sem complicação.</p>
          <button
            onClick={handleHeroCTA}
            className="mt-8 inline-flex items-center gap-3 px-8 py-4 rounded-2xl bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-white font-bold shadow-xl shadow-[#A6193C]/30 hover:scale-105 transition-transform"
          >
            <GoogleIcon />
            Entrar com o Google
          </button>
          <div className="mt-12 flex items-center justify-center gap-2 text-sm text-[#6B7280]">
            <span>Participa de um evento?</span>
            <Link to="/join" className="text-[#FFCB05] hover:underline font-semibold">
              Entrar como participante →
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-[#262D3D] py-8 text-center text-xs text-[#6B7280]">
        © {new Date().getFullYear()} QuizHubine • Banco do Nordeste
      </footer>

      <style>{`
        @keyframes pulse-cta {
          0%, 100% { box-shadow: 0 20px 50px -10px rgba(166,25,60,0.5); }
          50% { box-shadow: 0 20px 60px -5px rgba(246,139,31,0.7); }
        }
        .animate-pulse-cta { animation: pulse-cta 2.5s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

// Suppress unused warning for supabase import (used by hook indirectly)
void supabase;
