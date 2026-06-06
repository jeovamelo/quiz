import { useState } from "react";
import { Mic, Square, Volume2 } from "lucide-react";
import { useTTS } from "@/hooks/use-tts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DEMO_TEXT =
  "Olá! Seja bem-vindo a esta apresentação no QuizBini. Hoje vamos explorar novos conhecimentos juntos.";

export function Speaker() {
  const {
    voices,
    selectedVoice,
    setSelectedVoice,
    rate,
    setRate,
    pitch,
    setPitch,
    speaking,
    speak,
    stop,
    supported,
  } = useTTS();

  const [text, setText] = useState(DEMO_TEXT);

  if (!supported) {
    return (
      <Card className="bg-[#161A23] border-[#262D3D] text-white">
        <CardContent className="py-8 text-center text-sm text-[#9CA3AF]">
          Síntese de voz não suportada neste navegador.
          Use Chrome ou Edge para a melhor experiência.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-[#161A23] border-[#262D3D] text-white">
      <CardHeader className="pb-3">
        <CardTitle className="text-md font-bold flex items-center gap-2">
          <Mic className="h-4 w-4 text-[#F68B1F]" />
          Voz Nativa do Navegador
        </CardTitle>
        <CardDescription className="text-[#9CA3AF] text-xs">
          Motor de síntese de voz embutido no browser — sem custo, sem internet.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Voice selector */}
        <div className="space-y-1.5">
          <Label className="text-xs text-[#9CA3AF]">Voz (pt-BR preferencial)</Label>
          <Select
            value={selectedVoice?.name ?? ""}
            onValueChange={(name) =>
              setSelectedVoice(voices.find((v) => v.name === name) ?? null)
            }
          >
            <SelectTrigger className="bg-[#0E1015] border-[#262D3D] text-white text-sm">
              <SelectValue placeholder="Selecionar voz…" />
            </SelectTrigger>
            <SelectContent className="bg-[#161A23] border-[#262D3D] text-white">
              {voices.map((v) => (
                <SelectItem key={v.name} value={v.name} className="text-sm focus:bg-[#262D3D]">
                  {v.name}
                  <span className="ml-2 text-[10px] text-[#6B7280]">{v.lang}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Rate */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <Label className="text-xs text-[#9CA3AF]">Velocidade</Label>
            <span className="text-xs text-[#F68B1F] font-mono">{rate.toFixed(1)}×</span>
          </div>
          <Slider
            min={0.5}
            max={2.0}
            step={0.1}
            value={[rate]}
            onValueChange={([v]) => setRate(v)}
            className="[&_[role=slider]]:bg-[#F68B1F]"
          />
          <div className="flex justify-between text-[10px] text-[#6B7280]">
            <span>0.5× lento</span>
            <span>2.0× rápido</span>
          </div>
        </div>

        {/* Pitch */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <Label className="text-xs text-[#9CA3AF]">Tom (pitch)</Label>
            <span className="text-xs text-[#F68B1F] font-mono">{pitch.toFixed(1)}</span>
          </div>
          <Slider
            min={0.0}
            max={2.0}
            step={0.1}
            value={[pitch]}
            onValueChange={([v]) => setPitch(v)}
            className="[&_[role=slider]]:bg-[#F68B1F]"
          />
          <div className="flex justify-between text-[10px] text-[#6B7280]">
            <span>0.0 grave</span>
            <span>2.0 agudo</span>
          </div>
        </div>

        {/* Test text */}
        <div className="space-y-1.5">
          <Label className="text-xs text-[#9CA3AF]">Texto de teste</Label>
          <Textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Digite um texto para testar a voz…"
            className="bg-[#0E1015] border-[#262D3D] text-white text-sm resize-none"
          />
        </div>

        {/* Controls */}
        <div className="flex gap-2">
          <Button
            className="flex-1 gap-2 bg-[#F68B1F] hover:bg-[#F26B1F] text-white"
            onClick={() => speak(text)}
            disabled={speaking || !selectedVoice || !text.trim()}
          >
            <Volume2 className="size-4" />
            {speaking ? "Falando…" : "Falar Texto"}
          </Button>
          {speaking && (
            <Button
              variant="outline"
              onClick={stop}
              className="gap-2 border-[#262D3D] hover:bg-[#161A23] text-white"
            >
              <Square className="size-3.5 fill-current" />
              Parar
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
