import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Clock, Loader2, Mic, Save, Sparkles, Volume2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { generateSlideScripts } from "@/lib/ai-script.functions";
import { extractPdfText } from "@/lib/pdf-extract";

type Settings = {
  presenter_mode: "human" | "ai";
  ai_voice: string | null;
  ai_voice_rate: number;
  ai_idle_timeout: number;
  ai_questions_enabled: boolean;
  total_duration_minutes: number;
  ai_max_answer_seconds: number;
};

type ScriptRow = { slide_number: number; script_text: string };

export function AiPresenterTab({ presentationId }: { presentationId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [fileUrl, setFileUrl] = useState<string>("");
  const [aiContext, setAiContext] = useState<string>("");
  const [settings, setSettings] = useState<Settings>({
    presenter_mode: "human",
    ai_voice: null,
    ai_voice_rate: 1.0,
    ai_idle_timeout: 0,
    ai_questions_enabled: false,
    total_duration_minutes: 0,
    ai_max_answer_seconds: 30,
  });
  const [scripts, setScripts] = useState<ScriptRow[]>([]);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const previewRef = useRef<SpeechSynthesisUtterance | null>(null);

  const generateFn = useServerFn(generateSlideScripts);

  // Load presentation + scripts
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: pres } = await (supabase.from("presentations") as any)
        .select(
          "file_url, ai_context, presenter_mode, ai_voice, ai_voice_rate, ai_idle_timeout, ai_questions_enabled, total_duration_minutes, ai_max_answer_seconds",
        )
        .eq("id", presentationId)
        .maybeSingle();
      if (pres) {
        setFileUrl(pres.file_url ?? "");
        setAiContext(pres.ai_context ?? "");
        setSettings({
          presenter_mode: (pres.presenter_mode as any) ?? "human",
          ai_voice: pres.ai_voice ?? null,
          ai_voice_rate: Number(pres.ai_voice_rate ?? 1),
          ai_idle_timeout: Number(pres.ai_idle_timeout ?? 0),
          ai_questions_enabled: !!pres.ai_questions_enabled,
          total_duration_minutes: Number(pres.total_duration_minutes ?? 0),
          ai_max_answer_seconds: Number(pres.ai_max_answer_seconds ?? 30),
        });
      }
      const { data: sc } = await (supabase.from("slide_scripts") as any)
        .select("slide_number, script_text")
        .eq("presentation_id", presentationId)
        .order("slide_number");
      setScripts((sc as ScriptRow[]) ?? []);
      setLoading(false);
    })();
  }, [presentationId]);

  // Load TTS voices
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const update = () => {
      const all = window.speechSynthesis.getVoices();
      const pt = all.filter((v) => v.lang.toLowerCase().startsWith("pt"));
      setVoices(pt.length > 0 ? pt : all);
    };
    update();
    window.speechSynthesis.onvoiceschanged = update;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const ptVoices = useMemo(() => voices, [voices]);

  function patch<K extends keyof Settings>(k: K, v: Settings[K]) {
    setSettings((s) => ({ ...s, [k]: v }));
  }

  async function handleSaveSettings() {
    setSaving(true);
    try {
      const { error } = await (supabase.from("presentations") as any)
        .update(settings)
        .eq("id", presentationId);
      if (error) throw error;
      toast.success("Configurações do Palestrante IA salvas!");
    } catch (e: any) {
      toast.error(e?.message || "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateScripts() {
    if (!fileUrl) {
      toast.error("Apresentação sem PDF associado.");
      return;
    }
    setGenerating(true);
    try {
      // Extrai texto do PDF no navegador
      const res = await fetch(fileUrl);
      const blob = await res.blob();
      const file = new File([blob], "pres.pdf", { type: "application/pdf" });
      const { text, numPages } = await extractPdfText(file);

      const result = await generateFn({
        data: {
          presentationId,
          pdfText: text,
          numPages,
          context: aiContext || "",
        },
      });

      // Recarrega scripts
      const { data: sc } = await (supabase.from("slide_scripts") as any)
        .select("slide_number, script_text")
        .eq("presentation_id", presentationId)
        .order("slide_number");
      setScripts((sc as ScriptRow[]) ?? []);
      toast.success(`${result.count} roteiros gerados pela IA!`);
    } catch (e: any) {
      toast.error(e?.message || "Falha ao gerar roteiros");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSaveScript(slideNumber: number, text: string) {
    const { error } = await (supabase.from("slide_scripts") as any).upsert(
      [{ presentation_id: presentationId, slide_number: slideNumber, script_text: text }],
      { onConflict: "presentation_id,slide_number" },
    );
    if (error) {
      toast.error("Falha ao salvar roteiro");
    } else {
      toast.success(`Roteiro do slide ${slideNumber} salvo!`);
    }
  }

  function previewVoice(text: string) {
    if (!window.speechSynthesis) {
      toast.error("Síntese de voz não suportada neste navegador");
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text || "Olá, este é um teste de voz.");
    const v = ptVoices.find((x) => x.name === settings.ai_voice);
    if (v) u.voice = v;
    u.rate = settings.ai_voice_rate;
    u.lang = v?.lang ?? "pt-BR";
    previewRef.current = u;
    window.speechSynthesis.speak(u);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando configurações…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Modo de Apresentação */}
      <div className="rounded-xl border border-[#262D3D] bg-[#161A23] p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-[#F68B1F]" />
          <h2 className="text-lg font-bold text-white">Modo de Apresentação</h2>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label className="text-xs">Quem apresenta</Label>
            <select
              value={settings.presenter_mode}
              onChange={(e) => patch("presenter_mode", e.target.value as any)}
              className="mt-1 w-full rounded-md border border-[#262D3D] bg-[#0E1015] px-3 py-2 text-sm"
            >
              <option value="human">Apresentação Humana</option>
              <option value="ai">Palestrante IA (autônomo)</option>
            </select>
          </div>

          <div>
            <Label className="text-xs">Voz (TTS do navegador)</Label>
            <select
              value={settings.ai_voice ?? ""}
              onChange={(e) => patch("ai_voice", e.target.value || null)}
              className="mt-1 w-full rounded-md border border-[#262D3D] bg-[#0E1015] px-3 py-2 text-sm"
            >
              <option value="">Padrão do sistema (pt-BR)</option>
              {ptVoices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label className="text-xs">Velocidade da voz ({settings.ai_voice_rate.toFixed(1)}x)</Label>
            <Input
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={settings.ai_voice_rate}
              onChange={(e) => patch("ai_voice_rate", Number(e.target.value))}
              className="bg-transparent"
            />
          </div>

          <div>
            <Label className="text-xs">
              Tempo de inatividade para avanço automático (segundos)
            </Label>
            <Input
              type="number"
              min={0}
              max={600}
              value={settings.ai_idle_timeout}
              onChange={(e) => patch("ai_idle_timeout", Math.max(0, Number(e.target.value)))}
              className="bg-[#0E1015]"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              0 = desativado. Após a IA terminar de falar, aguarda este tempo e avança.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-[#262D3D] bg-[#0E1015]/60 p-3">
          <div className="flex items-start gap-3">
            <Mic className="mt-0.5 h-5 w-5 text-[#A6193C]" />
            <div>
              <p className="text-sm font-semibold text-white">Modo Perguntas da Plateia</p>
              <p className="text-[11px] text-muted-foreground">
                Habilita um campo no celular dos participantes para enviar dúvidas — a IA responde com base no slide atual.
              </p>
            </div>
          </div>
          <Switch
            checked={settings.ai_questions_enabled}
            onCheckedChange={(v) => patch("ai_questions_enabled", v)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button
            onClick={handleSaveSettings}
            disabled={saving}
            className="bg-gradient-to-r from-[#A6193C] to-[#F26B1F] text-white"
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salvar configurações
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => previewVoice("Olá! Este é um teste do palestrante autônomo do QuizBini.")}
            className="border-[#262D3D]"
          >
            <Volume2 className="mr-2 h-4 w-4" /> Testar voz
          </Button>
        </div>
      </div>

      {/* Gerador de roteiro */}
      <div className="rounded-xl border border-[#262D3D] bg-[#161A23] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">Roteiro Falado por Slide</h2>
            <p className="text-xs text-muted-foreground">
              A IA gera um resumo natural para cada slide. Você pode editar antes da apresentação.
            </p>
          </div>
          <Button
            onClick={handleGenerateScripts}
            disabled={generating}
            className="bg-gradient-to-r from-[#7C3AED] to-[#A6193C] text-white"
          >
            {generating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            {scripts.length > 0 ? "Regenerar Roteiro da IA" : "Gerar Roteiro da IA"}
          </Button>
        </div>

        {scripts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[#262D3D] bg-[#0E1015] p-6 text-center text-sm text-muted-foreground">
            Nenhum roteiro ainda. Clique em "Gerar Roteiro da IA" para que o DeepSeek analise os slides.
          </p>
        ) : (
          <div className="space-y-3">
            {scripts.map((s) => (
              <ScriptCard
                key={s.slide_number}
                slideNumber={s.slide_number}
                initialText={s.script_text}
                onSave={(t) => handleSaveScript(s.slide_number, t)}
                onPreview={(t) => previewVoice(t)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ScriptCard({
  slideNumber,
  initialText,
  onSave,
  onPreview,
}: {
  slideNumber: number;
  initialText: string;
  onSave: (text: string) => void | Promise<void>;
  onPreview: (text: string) => void;
}) {
  const [text, setText] = useState(initialText);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setText(initialText);
    setDirty(false);
  }, [initialText]);

  return (
    <div className="rounded-lg border border-[#262D3D] bg-[#0E1015] p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-[#F68B1F]">Slide {slideNumber}</span>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onPreview(text)}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-white"
          >
            <Volume2 className="mr-1 h-3 w-3" /> Ouvir
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!dirty}
            onClick={async () => {
              await onSave(text);
              setDirty(false);
            }}
            className="h-7 px-2 text-xs"
          >
            <Save className="mr-1 h-3 w-3" /> Salvar
          </Button>
        </div>
      </div>
      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
        rows={4}
        className="bg-[#161A23] text-sm"
      />
    </div>
  );
}