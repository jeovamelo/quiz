import { useEffect, useState, useRef } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useRequireSpeaker } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Loader2, Mic, Upload, Key, FileText, Check, Play, Volume2, 
  Trash2, AlertTriangle, ArrowLeft, Headphones, Copy, Download,
  Server, Cloud
} from "lucide-react";

export const Route = createFileRoute("/voz")({
  component: VoiceCloningPage,
});

const DEFAULT_SCRIPT = `Olá! Estou gravando esta amostra de áudio para clonar a minha própria voz na plataforma QuizBini. Quero que o meu palestrante digital fale com naturalidade, clareza e bastante entusiasmo. É muito importante manter um tom de voz constante, evitar ruídos de fundo e falar com a mesma energia que uso quando estou apresentando para o meu público. A inteligência artificial agora vai analisar a entonação da minha fala e a minha assinatura vocal para criar uma versão digital perfeita de mim.`;

type ElevenLabsVoice = {
  voice_id: string;
  name: string;
  category: string;
  preview_url?: string;
};

type LocalVoice = {
  voice_id: string;
  name: string;
};

function VoiceCloningPage() {
  const { user, loading: authLoading } = useRequireSpeaker();
  const [profile, setProfile] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  
  // Provider Mode: "elevenlabs" | "local_xtts"
  const [providerMode, setProviderMode] = useState<"elevenlabs" | "local_xtts">("local_xtts");
  
  // ElevenLabs States
  const [apiKey, setApiKey] = useState("");
  const [voiceName, setVoiceName] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [cloning, setCloning] = useState(false);
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [testingVoiceId, setTestingVoiceId] = useState<string | null>(null);
  const [savingApiKey, setSavingApiKey] = useState(false);
  
  // Local XTTS States
  const [localVoices, setLocalVoices] = useState<LocalVoice[]>([]);
  const [loadingLocalVoices, setLoadingLocalVoices] = useState(false);
  const [localServerHealthy, setLocalServerHealthy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);

  // Load profile settings
  useEffect(() => {
    if (user?.id) {
      setProfileLoading(true);
      supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) {
            setProfile(data);
            if (data.elevenlabs_api_key) {
              setApiKey(data.elevenlabs_api_key);
              fetchVoices(data.elevenlabs_api_key);
            }
          }
          setProfileLoading(false);
        });
    }
    checkLocalServerHealth();
    fetchLocalVoices();
  }, [user?.id]);

  // Check local server health
  const checkLocalServerHealth = async () => {
    try {
      const res = await fetch("http://localhost:8000/health");
      if (res.ok) {
        setLocalServerHealthy(true);
      } else {
        setLocalServerHealthy(false);
      }
    } catch {
      setLocalServerHealthy(false);
    }
  };

  // Fetch local voices
  const fetchLocalVoices = async () => {
    setLoadingLocalVoices(true);
    try {
      const res = await fetch("http://localhost:8000/voices");
      if (!res.ok) throw new Error();
      const data = await res.json();
      const formatted = (data.voices || []).map((v: string) => ({
        voice_id: v,
        name: v.replace(".wav", ""),
      }));
      setLocalVoices(formatted);
    } catch {
      setLocalVoices([]);
    } finally {
      setLoadingLocalVoices(false);
    }
  };

  // Fetch voices from ElevenLabs
  const fetchVoices = async (key: string) => {
    if (!key) return;
    setLoadingVoices(true);
    try {
      const res = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: {
          "xi-api-key": key,
        },
      });
      if (!res.ok) throw new Error("Falha ao obter vozes. Verifique sua chave de API.");
      const data = await res.json();
      const cloned = (data.voices || []).filter((v: any) => v.category === "cloned");
      setVoices(cloned);
    } catch (err: any) {
      toast.error(err.message || "Erro ao conectar com ElevenLabs");
    } finally {
      setLoadingVoices(false);
    }
  };

  const handleSaveApiKey = async () => {
    if (!user?.id) return;
    setSavingApiKey(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ elevenlabs_api_key: apiKey })
        .eq("user_id", user.id);
      
      if (error) throw error;
      toast.success("Chave ElevenLabs salva com sucesso!");
      fetchVoices(apiKey);
    } catch (err: any) {
      toast.error("Erro ao salvar chave: " + err.message);
    } finally {
      setSavingApiKey(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error("O arquivo deve ter no máximo 10MB");
        return;
      }
      setAudioFile(file);
    }
  };

  const handleCloneVoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voiceName.trim()) {
      toast.error("Digite o nome da voz.");
      return;
    }
    if (!audioFile) {
      toast.error("Selecione um arquivo de áudio.");
      return;
    }

    if (providerMode === "local_xtts") {
      if (!localServerHealthy) {
        toast.error("O servidor local XTTS v2 não está rodando. Inicie o start_server.bat primeiro.");
        return;
      }
      setCloning(true);
      try {
        const formData = new FormData();
        const safeName = voiceName.trim().toLowerCase().replace(/[^a-z0-9]/g, "_") + ".wav";
        const renamedFile = new File([audioFile], safeName, { type: audioFile.type });
        formData.append("file", renamedFile);

        const res = await fetch("http://localhost:8000/voices/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) throw new Error("Erro ao fazer upload no servidor local.");
        
        toast.success("Voz local adicionada com sucesso!");
        await handleSetDefaultVoice(safeName);
        setVoiceName("");
        setAudioFile(null);
        fetchLocalVoices();
      } catch (err: any) {
        toast.error(err.message || "Erro no upload local");
      } finally {
        setCloning(false);
      }
    } else {
      // ElevenLabs Mode
      if (!apiKey) {
        toast.error("Insira e salve a sua ElevenLabs API Key primeiro.");
        return;
      }
      setCloning(true);
      try {
        const formData = new FormData();
        formData.append("name", voiceName);
        formData.append("files", audioFile);
        formData.append("description", "Voz clonada para o QuizBini");

        const res = await fetch("https://api.elevenlabs.io/v1/voices/add", {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
          },
          body: formData,
        });

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.detail?.message || "Erro ao clonar voz.");
        }

        const data = await res.json();
        toast.success("Voz ElevenLabs clonada com sucesso!");
        await handleSetDefaultVoice(data.voice_id);
        
        setVoiceName("");
        setAudioFile(null);
        fetchVoices(apiKey);
      } catch (err: any) {
        toast.error(err.message || "Falha na clonagem");
      } finally {
        setCloning(false);
      }
    }
  };

  const handleSetDefaultVoice = async (voiceId: string) => {
    if (!user?.id) return;
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ elevenlabs_voice_id: voiceId })
        .eq("user_id", user.id);
      
      if (error) throw error;
      
      setProfile((prev: any) => ({ ...prev, elevenlabs_voice_id: voiceId }));
      toast.success("Voz padrão definida para o seu Palestrante IA!");
    } catch (err: any) {
      toast.error("Erro ao definir voz padrão: " + err.message);
    }
  };

  const handleDeleteVoice = async (voiceId: string) => {
    if (providerMode === "local_xtts") {
      toast.info("A remoção de vozes locais deve ser feita manualmente apagando o arquivo na pasta 'local_tts_server/voices/'.");
      return;
    }

    if (!confirm("Tem certeza que deseja excluir esta voz da sua conta ElevenLabs?")) return;
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
        method: "DELETE",
        headers: {
          "xi-api-key": apiKey,
        },
      });

      if (!res.ok) throw new Error("Erro ao excluir voz");
      
      toast.success("Voz excluída");
      if (profile?.elevenlabs_voice_id === voiceId) {
        handleSetDefaultVoice("");
      }
      fetchVoices(apiKey);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleTestVoice = async (voiceId: string) => {
    setTestingVoiceId(voiceId);
    try {
      if (providerMode === "local_xtts") {
        const res = await fetch("http://localhost:8000/synthesize", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: "Olá! Este é um teste do motor local XTTS executando localmente.",
            voice_name: voiceId,
          }),
        });

        if (!res.ok) throw new Error("Erro ao gerar áudio de teste local");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (audioPreviewRef.current) {
          audioPreviewRef.current.src = url;
          audioPreviewRef.current.play();
        }
      } else {
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: "Olá! Este é um teste da minha nova voz clonada e integrada ao QuizBini.",
            model_id: "eleven_multilingual_v2",
          }),
        });

        if (!res.ok) throw new Error("Erro ao gerar áudio de teste");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (audioPreviewRef.current) {
          audioPreviewRef.current.src = url;
          audioPreviewRef.current.play();
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Erro no teste de voz");
    } finally {
      setTestingVoiceId(null);
    }
  };

  const handleCopyScript = () => {
    navigator.clipboard.writeText(DEFAULT_SCRIPT);
    toast.success("Roteiro copiado para a área de transferência!");
  };

  const handleDownloadScript = () => {
    const element = document.createElement("a");
    const file = new Blob([DEFAULT_SCRIPT], { type: 'text/plain;charset=utf-8' });
    element.href = URL.createObjectURL(file);
    element.download = "roteiro_clonagem_quizbini.txt";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    toast.success("Roteiro baixado!");
  };

  if (authLoading || profileLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0E1015] text-white">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-[#F68B1F]" />
          <p className="text-sm text-[#9CA3AF]">Acessando sua identidade sonora...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0E1015] text-white pb-16">
      {/* Header */}
      <header className="border-b border-[#262D3D] bg-[#0E1015]/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon" className="hover:bg-[#161A23]">
              <Link to="/dashboard">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Mic className="h-5 w-5 text-[#F68B1F]" /> Identidade por Voz
              </h1>
              <p className="text-xs text-[#9CA3AF]">Crie seu palestrante digital com sua própria voz ou vozes locais</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 mt-8">
        {/* Toggle Mode */}
        <div className="mb-6 flex justify-center">
          <Tabs value={providerMode} onValueChange={(val: any) => setProviderMode(val)} className="w-full max-w-md">
            <TabsList className="grid grid-cols-2 bg-[#161A23] p-1">
              <TabsTrigger value="local_xtts" className="data-[state=active]:bg-[#F68B1F] data-[state=active]:text-white">
                <Server className="h-4 w-4 mr-2" /> Motor Local (XTTS v2)
              </TabsTrigger>
              <TabsTrigger value="elevenlabs" className="data-[state=active]:bg-[#F68B1F] data-[state=active]:text-white">
                <Cloud className="h-4 w-4 mr-2" /> Nuvem (ElevenLabs)
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {/* Left Column: Local Health or API Config */}
          <div className="space-y-6 md:col-span-1">
            {providerMode === "local_xtts" ? (
              <Card className="bg-[#161A23] border-[#262D3D] text-white">
                <CardHeader>
                  <CardTitle className="text-md font-bold flex items-center gap-2">
                    <Server className="h-4 w-4 text-[#F68B1F]" /> Status do Motor Local
                  </CardTitle>
                  <CardDescription className="text-[#9CA3AF] text-xs">
                    Síntese nativa rodando na sua máquina.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-[#0E1015] border border-[#262D3D]">
                    <span className="text-xs">Status do Servidor:</span>
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${
                      localServerHealthy ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                    }`}>
                      {localServerHealthy ? "Conectado" : "Desconectado"}
                    </span>
                  </div>

                  {!localServerHealthy && (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 space-y-2">
                      <p><strong>Atenção:</strong> Execute o script de inicialização do servidor local para usar clonagem offline:</p>
                      <code className="block p-1.5 bg-black rounded text-[10px] select-all">
                        local_tts_server\start_server.bat
                      </code>
                    </div>
                  )}
                </CardContent>
                <CardFooter>
                  <Button onClick={checkLocalServerHealth} className="w-full bg-[#1e2330] hover:bg-[#2c3346] border border-[#262D3D]">
                    Recarregar Status
                  </Button>
                </CardFooter>
              </Card>
            ) : (
              <Card className="bg-[#161A23] border-[#262D3D] text-white">
                <CardHeader>
                  <CardTitle className="text-md font-bold flex items-center gap-2">
                    <Key className="h-4 w-4 text-[#F68B1F]" /> ElevenLabs API
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="apiKey" className="text-xs text-[#9CA3AF]">API Key</Label>
                    <Input
                      id="apiKey"
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Insira sua ElevenLabs API Key"
                      className="bg-[#0E1015] border-[#262D3D] text-white text-sm"
                    />
                  </div>
                </CardContent>
                <CardFooter>
                  <Button 
                    onClick={handleSaveApiKey} 
                    disabled={savingApiKey}
                    className="w-full bg-[#1e2330] hover:bg-[#2c3346] text-white border border-[#262D3D]"
                  >
                    {savingApiKey ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                    Salvar Chave
                  </Button>
                </CardFooter>
              </Card>
            )}

            {/* Tips Card */}
            <Card className="bg-[#161A23] border-[#262D3D] text-white">
              <CardHeader>
                <CardTitle className="text-md font-bold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-[#FFCB05]" /> Dicas de Gravação
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-[#9CA3AF] space-y-3">
                <p>Para obter a melhor qualidade de clonagem possível:</p>
                <ul className="list-disc pl-4 space-y-2">
                  <li>Grave em um local completamente silencioso (sem eco, sem ruído de fundo).</li>
                  <li>Fale com clareza e ritmo natural por pelo menos 1 minuto.</li>
                  <li>Utilize o texto sugerido à direita para cobrir os fonemas do português.</li>
                </ul>
              </CardContent>
            </Card>
          </div>

          {/* Center/Right Column: Cloning Form and Voice List */}
          <div className="space-y-6 md:col-span-2">
            {/* Cloning Form */}
            <Card className="bg-[#161A23] border-[#262D3D] text-white">
              <CardHeader>
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  <Volume2 className="h-5 w-5 text-[#F68B1F]" /> 
                  {providerMode === "local_xtts" ? "Adicionar Voz Local" : "Clonar Nova Voz (Nuvem)"}
                </CardTitle>
                <CardDescription className="text-[#9CA3AF] text-xs">
                  {providerMode === "local_xtts" 
                    ? "Envie um arquivo WAV com sua voz para ser usado como referência local."
                    : "Faça o upload do seu áudio de amostra para iniciar a criação na ElevenLabs."
                  }
                </CardDescription>
              </CardHeader>
              <form onSubmit={handleCloneVoice}>
                <CardContent className="space-y-4">
                  {/* Voice Name */}
                  <div className="space-y-1.5">
                    <Label htmlFor="voiceName" className="text-xs">Nome da Voz</Label>
                    <Input
                      id="voiceName"
                      value={voiceName}
                      onChange={(e) => setVoiceName(e.target.value)}
                      placeholder={providerMode === "local_xtts" ? "Ex: voz_jeova" : "Ex: Minha Voz Oficial"}
                      className="bg-[#0E1015] border-[#262D3D] text-white"
                    />
                  </div>

                  {/* Upload Zone */}
                  <div className="space-y-2">
                    <Label className="text-xs">Amostra de Áudio (WAV {providerMode === "elevenlabs" && "/ MP3"}, máx 10MB)</Label>
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-[#262D3D] hover:border-[#F68B1F] rounded-xl p-6 text-center cursor-pointer bg-[#0E1015] transition"
                    >
                      <Upload className="h-8 w-8 text-[#9CA3AF] mx-auto mb-2" />
                      {audioFile ? (
                        <span className="text-sm font-semibold text-[#07A684]">
                          {audioFile.name} ({(audioFile.size / (1024 * 1024)).toFixed(2)} MB)
                        </span>
                      ) : (
                        <span className="text-xs text-[#9CA3AF]">
                          Arraste ou clique para selecionar o arquivo de áudio
                        </span>
                      )}
                      <input 
                        type="file" 
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept={providerMode === "local_xtts" ? "audio/wav" : "audio/mp3,audio/wav,audio/mpeg"} 
                        className="hidden" 
                      />
                    </div>
                  </div>

                  {/* Script Box */}
                  <div className="bg-[#0E1015] border border-[#262D3D] rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#F68B1F] flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5" /> Texto Sugerido para Gravação
                      </span>
                      <div className="flex gap-2">
                        <Button type="button" variant="ghost" size="icon" onClick={handleCopyScript} className="h-7 w-7 text-[#9CA3AF] hover:text-white">
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" onClick={handleDownloadScript} className="h-7 w-7 text-[#9CA3AF] hover:text-white">
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-[#9CA3AF] italic leading-relaxed">
                      "{DEFAULT_SCRIPT}"
                    </p>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button 
                    type="submit" 
                    disabled={cloning || (providerMode === "elevenlabs" && !apiKey) || (providerMode === "local_xtts" && !localServerHealthy)}
                    className="w-full bg-gradient-to-r from-[#A6193C] to-[#F68B1F] text-white font-bold"
                  >
                    {cloning ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Processando...
                      </>
                    ) : (
                      <>
                        <Mic className="h-4 w-4 mr-2" />
                        {providerMode === "local_xtts" ? "Salvar Amostra Localmente" : "Clonar Voz Instantaneamente"}
                      </>
                    )}
                  </Button>
                </CardFooter>
              </form>
            </Card>

            {/* Voices List */}
            <Card className="bg-[#161A23] border-[#262D3D] text-white">
              <CardHeader>
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  <Headphones className="h-5 w-5 text-[#F68B1F]" /> 
                  {providerMode === "local_xtts" ? "Amostras de Voz Locais" : "Minhas Vozes Clonadas (Nuvem)"}
                </CardTitle>
                <CardDescription className="text-[#9CA3AF] text-xs">
                  {providerMode === "local_xtts"
                    ? "Arquivos .wav de referência no seu hardware."
                    : "Gerencie suas vozes clonadas no ElevenLabs."
                  }
                </CardDescription>
              </CardHeader>
              <CardContent>
                {providerMode === "local_xtts" ? (
                  loadingLocalVoices ? (
                    <div className="text-center py-6 text-[#9CA3AF] flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-[#F68B1F]" /> Carregando vozes locais...
                    </div>
                  ) : localVoices.length === 0 ? (
                    <div className="text-center py-6 text-[#6B7280] text-xs">
                      Nenhum arquivo local .wav encontrado. Faça upload do primeiro áudio!
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {localVoices.map((v) => {
                        const isDefault = profile?.elevenlabs_voice_id === v.voice_id;
                        return (
                          <div 
                            key={v.voice_id} 
                            className={`flex items-center justify-between p-4 rounded-xl border transition ${
                              isDefault ? "border-[#F68B1F] bg-[#F68B1F]/5" : "border-[#262D3D] bg-[#0E1015]"
                            }`}
                          >
                            <div>
                              <p className="font-bold text-sm">{v.name}</p>
                              <p className="text-[10px] text-[#9CA3AF] font-mono mt-0.5">{v.voice_id}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              {isDefault ? (
                                <span className="text-xs bg-[#F68B1F] text-white px-2 py-0.5 rounded-full font-bold">
                                  Padrão
                                </span>
                              ) : (
                                <Button 
                                  onClick={() => handleSetDefaultVoice(v.voice_id)}
                                  variant="outline" 
                                  size="sm"
                                  className="text-xs border-[#262D3D] hover:bg-[#161A23] text-[#F68B1F]"
                                >
                                  Definir Padrão
                                </Button>
                              )}
                              <Button 
                                onClick={() => handleTestVoice(v.voice_id)}
                                disabled={testingVoiceId !== null}
                                size="icon" 
                                variant="ghost" 
                                title="Testar Voz"
                                className="text-[#9CA3AF] hover:text-white"
                              >
                                {testingVoiceId === v.voice_id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Play className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : (
                  loadingVoices ? (
                    <div className="text-center py-6 text-[#9CA3AF] flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-[#F68B1F]" /> Carregando lista...
                    </div>
                  ) : voices.length === 0 ? (
                    <div className="text-center py-6 text-[#6B7280] text-xs">
                      Nenhuma voz clonada encontrada.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {voices.map((v) => {
                        const isDefault = profile?.elevenlabs_voice_id === v.voice_id;
                        return (
                          <div 
                            key={v.voice_id} 
                            className={`flex items-center justify-between p-4 rounded-xl border transition ${
                              isDefault ? "border-[#F68B1F] bg-[#F68B1F]/5" : "border-[#262D3D] bg-[#0E1015]"
                            }`}
                          >
                            <div>
                              <p className="font-bold text-sm">{v.name}</p>
                              <p className="text-[10px] text-[#9CA3AF] font-mono mt-0.5">{v.voice_id}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              {isDefault ? (
                                <span className="text-xs bg-[#F68B1F] text-white px-2 py-0.5 rounded-full font-bold">
                                  Padrão
                                </span>
                              ) : (
                                <Button 
                                  onClick={() => handleSetDefaultVoice(v.voice_id)}
                                  variant="outline" 
                                  size="sm"
                                  className="text-xs border-[#262D3D] hover:bg-[#161A23] text-[#F68B1F]"
                                >
                                  Definir Padrão
                                </Button>
                              )}
                              <Button 
                                onClick={() => handleTestVoice(v.voice_id)}
                                disabled={testingVoiceId !== null}
                                size="icon" 
                                variant="ghost" 
                                title="Testar Voz"
                                className="text-[#9CA3AF] hover:text-white"
                              >
                                {testingVoiceId === v.voice_id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Play className="h-4 w-4" />
                                )}
                              </Button>
                              <Button 
                                onClick={() => handleDeleteVoice(v.voice_id)}
                                size="icon" 
                                variant="ghost" 
                                title="Excluir Voz"
                                className="text-[#9CA3AF] hover:text-red-500"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Hidden audio element for previewing */}
      <audio ref={audioPreviewRef} className="hidden" />
    </div>
  );
}
