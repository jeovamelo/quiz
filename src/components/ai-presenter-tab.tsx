import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Clock, Loader2, Mic, RotateCcw, Save, Sparkles, Volume2, Wand2, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { expandSlideScripts, generateSlideScripts, revertSlideScripts } from "@/lib/ai-script.functions";
import { extractPdfText } from "@/lib/pdf-extract";

type Settings = {
  presenter_mode: "human" | "ai";
  ai_voice: string | null;
  ai_voice_rate: number;
  ai_voice_pitch: number;
  ai_idle_timeout: number;
  ai_questions_enabled: boolean;
  total_duration_minutes: number;
  ai_max_answer_seconds: number;
  ai_personality_instructions: string | null;
  ai_pro_tts_provider: "openai" | "elevenlabs" | "google" | null;
  ai_pro_tts_api_key: string | null;
  ai_pro_tts_voice_id: string | null;
};

type ScriptRow = {
  slide_number: number;
  script_text: string;
  script_text_original?: string | null;
};

type DetailLevel = "concise" | "standard" | "extensive";

export function AiPresenterTab({ presentationId }: { presentationId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [detailLevel, setDetailLevel] = useState<DetailLevel>("standard");
  const [fileUrl, setFileUrl] = useState<string>("");
  const [aiContext, setAiContext] = useState<string>("");
  const [settings, setSettings] = useState<Settings>({
    presenter_mode: "human",
    ai_voice: null,
    ai_voice_rate: 1.0,
    ai_voice_pitch: 0.0,
    ai_idle_timeout: 0,
    ai_questions_enabled: false,
    total_duration_minutes: 0,
    ai_max_answer_seconds: 30,
    ai_personality_instructions: null,
    ai_pro_tts_provider: null,
    ai_pro_tts_api_key: null,
    ai_pro_tts_voice_id: null,
  });
  const [scripts, setScripts] = useState<ScriptRow[]>([]);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const previewRef = useRef<SpeechSynthesisUtterance | null>(null);

  const generateFn = useServerFn(generateSlideScripts);
  const expandFn = useServerFn(expandSlideScripts);
  const revertFn = useServerFn(revertSlideScripts);

  // Load presentation + scripts
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: pres } = await (supabase.from("presentations") as any)
        .select(
          "file_url, ai_context, presenter_mode, ai_voice, ai_voice_rate, ai_voice_pitch, ai_idle_timeout, ai_questions_enabled, total_duration_minutes, ai_max_answer_seconds, ai_personality_instructions, ai_pro_tts_provider, ai_pro_tts_api_key, ai_pro_tts_voice_id",
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
          ai_voice_pitch: Number(pres.ai_voice_pitch ?? 0),
          ai_idle_timeout: Number(pres.ai_idle_timeout ?? 0),
          ai_questions_enabled: !!pres.ai_questions_enabled,
          total_duration_minutes: Number(pres.total_duration_minutes ?? 0),
          ai_max_answer_seconds: Number(pres.ai_max_answer_seconds ?? 30),
          ai_personality_instructions: pres.ai_personality_instructions ?? null,
          ai_pro_tts_provider: (pres.ai_pro_tts_provider as any) ?? null,
          ai_pro_tts_api_key: pres.ai_pro_tts_api_key ?? null,
          ai_pro_tts_voice_id: pres.ai_pro_tts_voice_id ?? null,
        });
      }
      const { data: sc } = await (supabase.from("slide_scripts") as any)
        .select("slide_number, script_text, script_text_original")
        .eq("presentation_id", presentationId)
        .order("slide_number");
      setScripts((sc as ScriptRow[]) ?? []);
      setLoading(false);
    })();
  }, [presentationId]);

  // Load TTS voices (filtra pt-BR, escuta onvoiceschanged, com retry e log de diagnóstico)
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    let cancelled = false;
    let attempts = 0;
    const synth = window.speechSynthesis;

    const update = () => {
      if (cancelled) return;
      const all = synth.getVoices();
      // Log de diagnóstico — confirma no F12 que o SO entregou as vozes
      // eslint-disable-next-line no-console
      console.log(
        "[Palestrante IA] Vozes detectadas:",
        all.length,
        all.map((v) => `${v.name} (${v.lang})`),
      );
      const pt = all.filter((v) => v.lang.toLowerCase().startsWith("pt"));
      // Fallback seguro: se não houver pt-BR, mostra todas para o usuário escolher
      setVoices(pt.length > 0 ? pt : all);

      // Algumas plataformas (Chrome no Windows) retornam [] no 1º tick.
      // Re-tenta algumas vezes até o onvoiceschanged disparar.
      if (all.length === 0 && attempts < 20) {
        attempts += 1;
        setTimeout(update, 250);
      }
    };

    update();
    synth.addEventListener?.("voiceschanged", update);
    // Fallback p/ browsers antigos sem addEventListener no synth
    const prev = synth.onvoiceschanged;
    synth.onvoiceschanged = update;

    return () => {
      cancelled = true;
      synth.removeEventListener?.("voiceschanged", update);
      synth.onvoiceschanged = prev ?? null;
    };
  }, []);

  const ptVoices = useMemo(() => voices, [voices]);

  // === Cálculo de tempo de leitura estimado a partir dos roteiros ===
  // ~150 palavras por minuto em pt-BR, ajustado pela velocidade da voz.
  const estimatedReadingSeconds = useMemo(() => {
    const words = scripts.reduce(
      (acc, s) => acc + (s.script_text?.trim().split(/\s+/).filter(Boolean).length ?? 0),
      0,
    );
    const rate = settings.ai_voice_rate > 0 ? settings.ai_voice_rate : 1;
    const minutes = words / (150 * rate);
    return Math.round(minutes * 60);
  }, [scripts, settings.ai_voice_rate]);

  const totalSeconds = settings.total_duration_minutes * 60;
  const questionsSeconds = totalSeconds - estimatedReadingSeconds;
  const overBudget = totalSeconds > 0 && estimatedReadingSeconds > totalSeconds;

  function formatDuration(totalSec: number) {
    if (totalSec <= 0) return "0 min";
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (m === 0) return `${s}s`;
    if (s === 0) return `${m} min`;
    return `${m} min ${s}s`;
  }

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
        .select("slide_number, script_text, script_text_original")
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

  async function reloadScripts() {
    const { data: sc } = await (supabase.from("slide_scripts") as any)
      .select("slide_number, script_text, script_text_original")
      .eq("presentation_id", presentationId)
      .order("slide_number");
    setScripts((sc as ScriptRow[]) ?? []);
  }

  async function handleExpandScripts() {
    if (scripts.length === 0) {
      toast.error("Gere o roteiro antes de expandir.");
      return;
    }
    setExpanding(true);
    try {
      const result = await expandFn({ data: { presentationId, level: detailLevel } });
      await reloadScripts();
      toast.success(`Roteiro expandido em ${result.count} slide(s)!`);
    } catch (e: any) {
      toast.error(e?.message || "Falha ao expandir roteiro");
    } finally {
      setExpanding(false);
    }
  }

  async function handleRevertScripts() {
    setReverting(true);
    try {
      const result = await revertFn({ data: { presentationId } });
      await reloadScripts();
      toast.success(`Roteiro revertido em ${result.count} slide(s).`);
    } catch (e: any) {
      toast.error(e?.message || "Falha ao reverter");
    } finally {
      setReverting(false);
    }
  }

  const hasOriginalBackup = useMemo(
    () => scripts.some((s) => !!s.script_text_original),
    [scripts],
  );

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
            <Label className="text-xs">Voz (TTS)</Label>
            <select
              value={settings.ai_pro_tts_provider ? "pro" : (settings.ai_voice ?? "")}
              onChange={(e) => {
                const val = e.target.value;
                if (val === "pro") {
                  patch("ai_pro_tts_provider", "openai");
                } else {
                  patch("ai_pro_tts_provider", null);
                  patch("ai_voice", val || null);
                }
              }}
              className="mt-1 w-full rounded-md border border-[#262D3D] bg-[#0E1015] px-3 py-2 text-sm"
            >
              <option value="">Padrão do sistema (pt-BR)</option>
              <option value="pro">Voz IA Pro (OpenAI / ElevenLabs)</option>
              {ptVoices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </div>

          {settings.ai_pro_tts_provider && (
            <div className="col-span-full grid gap-4 rounded-lg border border-[#F68B1F]/30 bg-[#F68B1F]/5 p-4 md:grid-cols-3">
              <div className="col-span-full flex items-center gap-2 mb-2">
                <Zap className="h-4 w-4 text-[#F68B1F]" />
                <span className="text-sm font-bold text-white">Configurações Voz IA Pro</span>
              </div>
              <div>
                <Label className="text-xs">Provedor</Label>
                <select
                  value={settings.ai_pro_tts_provider}
                  onChange={(e) => patch("ai_pro_tts_provider", e.target.value as any)}
                  className="mt-1 w-full rounded-md border border-[#262D3D] bg-[#0E1015] px-3 py-2 text-sm"
                >
                  <option value="openai">OpenAI (TTS-1)</option>
                  <option value="elevenlabs">ElevenLabs</option>
                  <option value="google">Google Cloud (Neural2 / Studio)</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">API Key</Label>
                <Input
                  type="password"
                  placeholder="sk-..."
                  value={settings.ai_pro_tts_api_key ?? ""}
                  onChange={(e) => patch("ai_pro_tts_api_key", e.target.value)}
                  className="mt-1 bg-[#0E1015]"
                />
              </div>
              <div>
                <Label className="text-xs">Voice ID / Model</Label>
                <Input
                  placeholder={settings.ai_pro_tts_provider === "openai" ? "alloy, echo, fable, onyx, nova, shimmer" : settings.ai_pro_tts_provider === "google" ? "Nome da voz (ex: pt-BR-Studio-A)" : "ID da voz no ElevenLabs"}
                  value={settings.ai_pro_tts_voice_id ?? ""}
                  onChange={(e) => patch("ai_pro_tts_voice_id", e.target.value)}
                  className="mt-1 bg-[#0E1015]"
                />
              </div>
              <p className="col-span-full text-[10px] text-muted-foreground">
                As vozes profissionais geram áudio com entonação natural. Deixe em branco para usar fallbacks padrão.
              </p>
            </div>
          )}

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
              <Label className="text-xs">Tom (Pitch: {settings.ai_voice_pitch.toFixed(1)})</Label>
              <Input
                type="range"
                min={-20}
                max={20}
                step={0.5}
                value={settings.ai_voice_pitch}
                onChange={(e) => patch("ai_voice_pitch", Number(e.target.value))}
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

        <div className="space-y-4">
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

          <div className="space-y-2">
            <Label className="text-xs flex items-center gap-2">
              <Sparkles className="h-3 w-3 text-[#F68B1F]" />
              Instruções de Personalidade (System Prompt)
            </Label>
            <Textarea
              placeholder="Ex: Você é um facilitador de inovação do HUBINE. Responda de forma entusiasta, clara, usando analogias do setor financeiro..."
              value={settings.ai_personality_instructions ?? ""}
              onChange={(e) => patch("ai_personality_instructions", e.target.value)}
              className="min-h-[100px] border-[#262D3D] bg-[#0E1015] text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              Define o tom de voz e o comportamento da IA ao responder perguntas e ler o roteiro.
            </p>
          </div>
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

      {/* Gestão de Tempo do Evento */}
      <div className="rounded-xl border border-[#262D3D] bg-[#161A23] p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-[#A78BFA]" />
          <h2 className="text-lg font-bold text-white">Gestão de Tempo do Evento</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          A IA usa estes parâmetros para se auto-regular: prioriza respostas mais
          curtas ou reduz o número de perguntas para não ultrapassar o tempo total.
        </p>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-[#262D3D] bg-[#0E1015] p-3">
            <p className="text-[10px] uppercase tracking-widest text-[#9CA3AF]">
              Tempo estimado de leitura
            </p>
            <p className="mt-1 text-xl font-extrabold text-white">
              {formatDuration(estimatedReadingSeconds)}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {scripts.length} slide(s) · {settings.ai_voice_rate.toFixed(1)}x
            </p>
          </div>

          <div>
            <Label className="text-xs">
              Tempo total da apresentação (minutos) *
            </Label>
            <Input
              type="number"
              min={0}
              max={600}
              value={settings.total_duration_minutes}
              onChange={(e) =>
                patch("total_duration_minutes", Math.max(0, Number(e.target.value)))
              }
              className="bg-[#0E1015]"
              required
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Inclui exposição + perguntas da plateia.
            </p>
          </div>

          <div className="rounded-lg border border-[#07A684]/40 bg-[#07A684]/10 p-3">
            <p className="text-[10px] uppercase tracking-widest text-[#34D399]">
              Tempo disponível para perguntas
            </p>
            <p className="mt-1 text-xl font-extrabold text-white">
              {settings.total_duration_minutes > 0
                ? formatDuration(Math.max(0, questionsSeconds))
                : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Calculado automaticamente.
            </p>
          </div>
        </div>

        {overBudget && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/60 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>Atenção:</strong> O roteiro excede o tempo total da apresentação.
              Encurte os scripts dos slides ou aumente o tempo total.
            </span>
          </div>
        )}

        <div>
          <Label className="text-xs">Tempo máximo por resposta da IA (segundos)</Label>
          <Input
            type="number"
            min={5}
            max={300}
            value={settings.ai_max_answer_seconds}
            onChange={(e) =>
              patch("ai_max_answer_seconds", Math.max(5, Number(e.target.value)))
            }
            className="bg-[#0E1015] md:max-w-xs"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Limita cada intervenção da IA durante o bloco de perguntas.
          </p>
        </div>

        <Button
          onClick={handleSaveSettings}
          disabled={saving}
          className="bg-gradient-to-r from-[#7C3AED] to-[#A78BFA] text-white"
        >
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Salvar tempo do evento
        </Button>
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

        {/* Expandir roteiro para preencher tempo */}
        <div className="rounded-lg border border-[#262D3D] bg-[#0E1015]/60 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-[#F68B1F]" />
            <p className="text-sm font-semibold text-white">
              Expandir roteiro para preencher tempo
            </p>
          </div>
          <p className="text-[11px] text-muted-foreground">
            A IA reescreve cada slide adicionando analogias práticas, casos de uso,
            aprofundamento técnico e frases de conexão entre slides.
          </p>
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
            <div>
              <Label className="text-xs">Nível de Detalhamento / Duração</Label>
              <select
                value={detailLevel}
                onChange={(e) => setDetailLevel(e.target.value as DetailLevel)}
                className="mt-1 w-full rounded-md border border-[#262D3D] bg-[#0E1015] px-3 py-2 text-sm"
              >
                <option value="concise">Conciso (~100 palavras/slide)</option>
                <option value="standard">Padrão (~175 palavras/slide)</option>
                <option value="extensive">Extenso (~260 palavras/slide)</option>
              </select>
            </div>
            <Button
              onClick={handleExpandScripts}
              disabled={expanding || scripts.length === 0}
              className="bg-gradient-to-r from-[#F68B1F] to-[#A6193C] text-white"
            >
              {expanding ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="mr-2 h-4 w-4" />
              )}
              Expandir para ocupar tempo
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleRevertScripts}
              disabled={reverting || !hasOriginalBackup}
              className="border-[#262D3D]"
              title={hasOriginalBackup ? "Restaurar o roteiro anterior à expansão" : "Sem backup do original"}
            >
              {reverting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="mr-2 h-4 w-4" />
              )}
              Reverter para original
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Novo tempo estimado:{" "}
            <span className="font-semibold text-white">
              {formatDuration(estimatedReadingSeconds)}
            </span>{" "}
            — recalculado automaticamente após a expansão.
          </p>
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