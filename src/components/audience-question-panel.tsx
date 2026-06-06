import { useEffect, useRef, useState } from "react";
import { Mic, Send, Loader2, MicOff, Sparkles, BrainCircuit } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { submitAudienceQuestion } from "@/lib/ai-script.functions";

type Props = {
  sessionId: string;
  participantId?: string | null;
};

type RecognitionState = "idle" | "listening" | "processing";

export function AudienceQuestionPanel({ sessionId, participantId }: Props) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [recState, setRecState] = useState<RecognitionState>("idle");
  const [supported, setSupported] = useState(true);
  const [isThinking, setIsThinking] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const recognitionRef = useRef<any>(null);
  const sendFn = useServerFn(submitAudienceQuestion);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SR) {
      setSupported(false);
      return;
    }
    const r = new SR();
    r.lang = "pt-BR";
    r.continuous = false;
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (ev: any) => {
      const transcript = ev.results?.[0]?.[0]?.transcript ?? "";
      if (transcript) setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    r.onerror = () => {
      setRecState("idle");
      toast.error("Não foi possível capturar o áudio. Verifique a permissão do microfone.");
    };
    r.onend = () => setRecState("idle");
    recognitionRef.current = r;
    return () => {
      try {
        r.abort();
      } catch {}
    };
  }, []);

  function toggleListening() {
    const r = recognitionRef.current;
    if (!r) return;
    if (recState === "listening") {
      try {
        r.stop();
      } catch {}
      setRecState("idle");
      return;
    }
    try {
      r.start();
      setRecState("listening");
    } catch {
      setRecState("idle");
    }
  }

  async function submit() {
    const trimmed = text.trim();
    if (trimmed.length < 3) {
      toast.error("Escreva uma pergunta com pelo menos 3 caracteres.");
      return;
    }
    if (trimmed.length > 1000) {
      toast.error("Pergunta muito longa (máx. 1000 caracteres).");
      return;
    }
    setSending(true);
    try {
      await sendFn({ data: { sessionId, question: trimmed, participantId: participantId || undefined } });
      setSent(true);
      setText("");
      toast.success("Pergunta enviada! O palestrante vai analisá-la.");
      setTimeout(() => setSent(false), 4000);
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao enviar pergunta.");
    } finally {
      setSending(false);
    }
  }

  if (!micEnabled) return null;

  return (
    <div className="mt-4 w-full max-w-md space-y-3 rounded-2xl border border-[#7A3FF2]/40 bg-gradient-to-br from-[#1A1530] to-[#0E1015] p-4 shadow-lg relative overflow-hidden">
      {isThinking && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 backdrop-blur-[1px]">
          <div className="flex flex-col items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#A78BFA]/20 text-[#A78BFA]">
              <BrainCircuit className="h-6 w-6 animate-pulse" />
            </div>
            <p className="text-[10px] font-black uppercase tracking-widest text-[#A78BFA] animate-pulse">A IA está processando sua dúvida...</p>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#A78BFA]">
        <Sparkles className="h-4 w-4" />
        Pergunte ao Palestrante IA
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Digite sua pergunta ou use o microfone..."
        maxLength={1000}
        rows={3}
        className="w-full resize-none rounded-xl border border-[#262D3D] bg-[#0E1015] px-3 py-2 text-sm text-white placeholder:text-[#3A4255] focus:border-[#A78BFA] focus:outline-none focus:ring-2 focus:ring-[#A78BFA]/30"
      />

      <div className="flex items-center gap-2">
        {supported ? (
          <button
            type="button"
            onClick={toggleListening}
            disabled={sending}
            className={`flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition active:scale-95 ${
              recState === "listening"
                ? "border-[#A6193C] bg-[#A6193C]/20 text-[#FCA5A5] animate-pulse"
                : "border-[#262D3D] bg-[#161A23] text-white hover:border-[#A78BFA]"
            }`}
          >
            {recState === "listening" ? (
              <>
                <MicOff className="h-4 w-4" /> Ouvindo... (toque para parar)
              </>
            ) : (
              <>
                <Mic className="h-4 w-4" /> Falar pergunta
              </>
            )}
          </button>
        ) : (
          <div className="flex-1 rounded-xl border border-[#262D3D] bg-[#161A23] px-3 py-2 text-[11px] text-[#9CA3AF]">
            Microfone não suportado neste navegador. Use o campo de texto.
          </div>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={sending || text.trim().length < 3}
          className="flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#7A3FF2] to-[#A78BFA] px-5 text-sm font-extrabold uppercase tracking-wide text-white shadow-lg shadow-[#7A3FF2]/40 transition active:scale-95 disabled:opacity-50"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Enviar
        </button>
      </div>

      {sent && (
        <div className="flex items-center gap-2 rounded-lg border border-[#07A684]/40 bg-[#07A684]/10 px-3 py-2 text-xs text-[#34D399]">
          ✓ Pergunta enviada! A IA vai escolher o melhor momento para responder.
        </div>
      )}
    </div>
  );
}