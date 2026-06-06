import { createFileRoute, Link } from "@tanstack/react-router";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Mic,
  Play,
  RefreshCw,
  Square,
  Star,
  Upload,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRequireSpeaker } from "@/hooks/use-auth.tsx";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

const XI_BASE = "https://api.elevenlabs.io";
const MAX_FILE_BYTES = 10 * 1024 * 1024;

type XIVoice = {
  voice_id: string;
  name: string;
  category: string;
  preview_url: string | null;
  labels: Record<string, string>;
};

export const Route = createFileRoute("/voz")({
  component: VozPage,
});

function VozPage() {
  const { user, loading: authLoading } = useRequireSpeaker();

  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [voiceName, setVoiceName] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [voices, setVoices] = useState<XIVoice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [defaultVoiceId, setDefaultVoiceId] = useState<string | null>(null);
  const [settingDefault, setSettingDefault] = useState<string | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const res = await supabase.auth.getUser();
      const meta = (res.data.user?.user_metadata ?? {}) as Record<string, string>;
      if (meta.elevenlabs_api_key) setApiKey(meta.elevenlabs_api_key);
      if (meta.elevenlabs_voice_id) setDefaultVoiceId(meta.elevenlabs_voice_id);
    })();
  }, [user]);

  async function fetchVoices(key: string) {
    if (!key.trim()) {
      toast.error("Insira sua ElevenLabs API Key primeiro.");
      return;
    }
    setLoadingVoices(true);
    try {
      const res = await fetch(`${XI_BASE}/v1/voices`, {
        headers: { "xi-api-key": key },
      });
      if (!res.ok) throw new Error("API Key inválida ou sem permissão.");
      const data = await res.json();
      const all = (data.voices ?? []) as XIVoice[];
      setVoices(all.filter((v) => v.category === "cloned" || v.category === "generated"));
    } catch (err: any) {
      toast.error(err.message ?? "Erro ao carregar vozes.");
    } finally {
      setLoadingVoices(false);
    }
  }

  async function handleCreate() {
    if (!apiKey.trim()) return toast.error("Insira sua ElevenLabs API Key.");
    if (!voiceName.trim()) return toast.error("Informe um nome para a voz.");
    if (!audioFile) return toast.error("Selecione um arquivo de áudio.");

    setCreating(true);
    try {
      const form = new FormData();
      form.append("name", voiceName.trim());
      form.append("files", audioFile);

      const res = await fetch(`${XI_BASE}/v1/voices/add`, {
        method: "POST",
        headers: { "xi-api-key": apiKey },
        body: form,
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.detail?.message ?? "Erro ao criar voz.");
      }

      const result = await res.json();
      toast.success(`Voz "${voiceName.trim()}" criada com sucesso!`);
      setVoiceName("");
      setAudioFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await fetchVoices(apiKey);

      if (result.voice_id && !defaultVoiceId) {
        await persistDefault(result.voice_id, apiKey);
      }
    } catch (err: any) {
      toast.error(err.message ?? "Erro desconhecido.");
    } finally {
      setCreating(false);
    }
  }

  async function persistDefault(voiceId: string, key: string) {
    const { error } = await supabase.auth.updateUser({
      data: { elevenlabs_voice_id: voiceId, elevenlabs_api_key: key },
    });
    if (error) throw error;
    setDefaultVoiceId(voiceId);
  }

  async function handleSetDefault(voiceId: string) {
    setSettingDefault(voiceId);
    try {
      await persistDefault(voiceId, apiKey);
      toast.success("Voz definida como padrão nas apresentações!");
    } catch {
      toast.error("Erro ao salvar voz padrão.");
    } finally {
      setSettingDefault(null);
    }
  }

  async function handleTestVoice(voice: XIVoice) {
    if (playingVoiceId === voice.voice_id) {
      audioRef.current?.pause();
      setPlayingVoiceId(null);
      return;
    }

    audioRef.current?.pause();

    if (voice.preview_url) {
      const audio = new Audio(voice.preview_url);
      audioRef.current = audio;
      setPlayingVoiceId(voice.voice_id);
      audio.onended = () => setPlayingVoiceId(null);
      audio.onerror = () => {
        setPlayingVoiceId(null);
        toast.error("Erro ao reproduzir prévia.");
      };
      audio.play().catch(() => setPlayingVoiceId(null));
      return;
    }

    if (!apiKey.trim()) {
      toast.error("Informe sua API Key para gerar uma prévia.");
      return;
    }

    setPlayingVoiceId(voice.voice_id);
    try {
      const res = await fetch(`${XI_BASE}/v1/text-to-speech/${voice.voice_id}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "Olá! Esta é a minha voz clonada para apresentações no QuizBini.",
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.5, similarity_boost: 0.8 },
        }),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setPlayingVoiceId(null);
        URL.revokeObjectURL(url);
      };
      audio.play().catch(() => setPlayingVoiceId(null));
    } catch {
      setPlayingVoiceId(null);
      toast.error("Erro ao gerar prévia da voz.");
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const validExt = /\.(mp3|wav)$/i.test(file.name);
    const validMime = ["audio/mpeg", "audio/wav", "audio/mp3", "audio/x-wav"].includes(file.type);
    if (!validExt && !validMime) {
      toast.error("Formato inválido. Use MP3 ou WAV.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error("Arquivo muito grande. Máximo 10MB.");
      return;
    }
    setAudioFile(file);
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  const fileSizePct = audioFile ? Math.min((audioFile.size / MAX_FILE_BYTES) * 100, 100) : 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-card/60 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/dashboard">
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-4" />
              Dashboard
            </Button>
          </Link>
          <Separator orientation="vertical" className="h-5" />
          <Mic className="size-5 text-primary" />
          <span className="font-semibold">Clonar Voz do Apresentador</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Tips */}
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-primary">
              Dicas para uma boa clonagem
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 gap-x-4 text-sm text-muted-foreground">
              {[
                "Grave em ambiente silencioso, sem eco",
                "Fale naturalmente por pelo menos 1 minuto",
                "Use microfone de qualidade (headset ou condensador)",
                "Evite música ou ruído de fundo durante a gravação",
                "Leia um texto em voz alta, sem pausas longas",
                "Envie arquivos MP3 ou WAV de até 10 MB",
              ].map((tip) => (
                <li key={tip} className="flex items-start gap-2">
                  <span className="text-primary mt-px shrink-0">•</span>
                  {tip}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Create voice form */}
        <Card>
          <CardHeader>
            <CardTitle>Criar Nova Voz Clonada</CardTitle>
            <CardDescription>
              Faça upload de uma gravação sua para clonar sua voz via ElevenLabs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* API Key */}
            <div className="space-y-2">
              <Label htmlFor="xi-key">ElevenLabs API Key</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="xi-key"
                    type={showApiKey ? "text" : "password"}
                    placeholder="Sua chave da ElevenLabs"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="pr-10"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    aria-label={showApiKey ? "Ocultar chave" : "Mostrar chave"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setShowApiKey((v) => !v)}
                  >
                    {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => fetchVoices(apiKey)}
                  disabled={!apiKey.trim() || loadingVoices}
                  className="shrink-0"
                >
                  {loadingVoices ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  <span className="ml-1.5 hidden sm:inline">Carregar Vozes</span>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Acesse{" "}
                <span className="text-primary font-medium">elevenlabs.io/app/settings/api-keys</span>{" "}
                para obter sua API Key.
              </p>
            </div>

            <Separator />

            {/* Voice name */}
            <div className="space-y-2">
              <Label htmlFor="voice-name">Nome da Voz</Label>
              <Input
                id="voice-name"
                placeholder="Ex: Minha Voz Profissional"
                value={voiceName}
                onChange={(e) => setVoiceName(e.target.value)}
              />
            </div>

            {/* File upload */}
            <div className="space-y-2">
              <Label>Arquivo de Áudio</Label>
              <div
                role="button"
                tabIndex={0}
                aria-label="Selecionar arquivo de áudio"
                className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30"
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
              >
                <Upload className="size-7 mx-auto mb-2 text-muted-foreground" />
                {audioFile ? (
                  <>
                    <p className="text-sm font-medium text-foreground">{audioFile.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {(audioFile.size / (1024 * 1024)).toFixed(2)} MB
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium">Clique para selecionar</p>
                    <p className="text-xs text-muted-foreground mt-0.5">MP3 ou WAV · Máximo 10 MB</p>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".mp3,.wav,audio/mpeg,audio/wav"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>

              {audioFile && (
                <div className="space-y-1">
                  <div className="w-full h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${fileSizePct}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground text-right">
                    {fileSizePct.toFixed(0)}% do limite
                  </p>
                </div>
              )}
            </div>

            <Button
              className="w-full"
              onClick={handleCreate}
              disabled={creating || !apiKey.trim() || !voiceName.trim() || !audioFile}
            >
              {creating ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Processando com IA…
                </>
              ) : (
                <>
                  <Mic className="size-4 mr-2" />
                  Criar Voz
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Voice list */}
        {(voices.length > 0 || loadingVoices) && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Suas Vozes Clonadas</CardTitle>
                  {voices.length > 0 && (
                    <CardDescription className="mt-0.5">
                      {voices.length} voz{voices.length !== 1 ? "es" : ""} encontrada
                      {voices.length !== 1 ? "s" : ""}
                    </CardDescription>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => fetchVoices(apiKey)}
                  disabled={loadingVoices}
                  className="text-muted-foreground"
                >
                  <RefreshCw className={`size-4 ${loadingVoices ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {loadingVoices && voices.length === 0 && (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="size-5 animate-spin mr-2" />
                  Carregando vozes…
                </div>
              )}

              {voices.map((voice) => (
                <VoiceRow
                  key={voice.voice_id}
                  voice={voice}
                  isDefault={defaultVoiceId === voice.voice_id}
                  isPlaying={playingVoiceId === voice.voice_id}
                  isSetting={settingDefault === voice.voice_id}
                  onTest={() => handleTestVoice(voice)}
                  onSetDefault={() => handleSetDefault(voice.voice_id)}
                />
              ))}
            </CardContent>
          </Card>
        )}

        {voices.length === 0 && !loadingVoices && apiKey.trim() && (
          <p className="text-center text-sm text-muted-foreground py-2">
            Nenhuma voz clonada encontrada. Crie sua primeira voz acima.
          </p>
        )}
      </main>
    </div>
  );
}

type VoiceRowProps = {
  voice: XIVoice;
  isDefault: boolean;
  isPlaying: boolean;
  isSetting: boolean;
  onTest: () => void;
  onSetDefault: () => void;
};

function VoiceRow({ voice, isDefault, isPlaying, isSetting, onTest, onSetDefault }: VoiceRowProps) {
  return (
    <div className="flex items-center gap-3 p-3.5 rounded-lg bg-secondary/40 border border-border hover:bg-secondary/60 transition-colors">
      <div className="size-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
        <Mic className="size-4 text-primary" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{voice.name}</span>
          {isDefault && (
            <Badge
              variant="outline"
              className="text-xs text-primary border-primary/30 bg-primary/10 shrink-0"
            >
              Padrão
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">{voice.voice_id}</p>
      </div>

      <div className="flex gap-2 shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={onTest}
          className="gap-1.5 min-w-[80px]"
        >
          {isPlaying ? (
            <>
              <Square className="size-3 fill-current" />
              Parar
            </>
          ) : (
            <>
              <Play className="size-3.5" />
              Testar
            </>
          )}
        </Button>

        <Button
          variant={isDefault ? "secondary" : "outline"}
          size="sm"
          onClick={onSetDefault}
          disabled={isSetting || isDefault}
          className="gap-1.5 min-w-[110px]"
        >
          {isSetting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : isDefault ? (
            <>
              <Check className="size-3.5" />
              Padrão
            </>
          ) : (
            <>
              <Star className="size-3.5" />
              Definir Padrão
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
