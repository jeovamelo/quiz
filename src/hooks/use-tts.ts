import { useCallback, useEffect, useRef, useState } from "react";

export type TTSVoice = SpeechSynthesisVoice;

export type UseTTSReturn = {
  voices: TTSVoice[];
  selectedVoice: TTSVoice | null;
  setSelectedVoice: (v: TTSVoice | null) => void;
  rate: number;
  setRate: (r: number) => void;
  pitch: number;
  setPitch: (p: number) => void;
  speaking: boolean;
  speak: (text: string) => void;
  stop: () => void;
  supported: boolean;
};

const QUALITY_KEYWORDS = ["neural", "studio", "premium", "enhanced", "natural", "google"];

function sortVoicesByQuality(list: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return [...list].sort((a, b) => {
    const aQ = QUALITY_KEYWORDS.some(k => a.name.toLowerCase().includes(k)) ? 0 : 1;
    const bQ = QUALITY_KEYWORDS.some(k => b.name.toLowerCase().includes(k)) ? 0 : 1;
    return aQ - bQ;
  });
}

export function useTTS(): UseTTSReturn {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  const [voices, setVoices] = useState<TTSVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<TTSVoice | null>(null);
  const [rate, setRate] = useState(1.0);
  const [pitch, setPitch] = useState(1.0);
  const [speaking, setSpeaking] = useState(false);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;

    function loadVoices() {
      const all = synth.getVoices();
      const pt = all.filter(v => v.lang.toLowerCase().startsWith("pt"));
      const pool = pt.length > 0 ? sortVoicesByQuality(pt) : sortVoicesByQuality(all);
      setVoices(pool);
      setSelectedVoice(prev => prev ?? pool[0] ?? null);
    }

    loadVoices();
    synth.addEventListener("voiceschanged", loadVoices);
    return () => synth.removeEventListener("voiceschanged", loadVoices);
  }, [supported]);

  const speak = useCallback(
    (text: string) => {
      if (!supported || !text.trim()) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (selectedVoice) u.voice = selectedVoice;
      u.rate = rate;
      u.pitch = pitch;
      u.lang = selectedVoice?.lang ?? "pt-BR";
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      utterRef.current = u;
      window.speechSynthesis.speak(u);
    },
    [supported, selectedVoice, rate, pitch],
  );

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  return {
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
  };
}
