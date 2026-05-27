import { useCallback, useEffect, useRef, useState } from "react";

type SuspenseLevel = 0 | 1 | 2 | 3;

export function useAudioSynthesizer() {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);

  // Loops de fundo
  const heartbeatTimerRef = useRef<number | null>(null);
  const drumLoopTimerRef = useRef<number | null>(null);
  const fanfareLoopTimerRef = useRef<number | null>(null);

  const heartbeatIntervalRef = useRef<number>(1000);
  const drumIntensityRef = useRef<number>(0.25);

  const [enabled, setEnabled] = useState(false);

  // -------- Inicialização (regra do gesto do usuário) --------
  const enable = useCallback(async () => {
    if (ctxRef.current) {
      try {
        await ctxRef.current.resume();
      } catch {
        /* noop */
      }
      setEnabled(true);
      return ctxRef.current;
    }
    try {
      const Ctx =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return null;
      const ctx: AudioContext = new Ctx();
      const master = ctx.createGain();
      master.gain.value = 0.85;
      master.connect(ctx.destination);
      ctxRef.current = ctx;
      masterRef.current = master;
      try {
        await ctx.resume();
      } catch {
        /* noop */
      }
      setEnabled(true);
      return ctx;
    } catch {
      return null;
    }
  }, []);

  const getCtx = () => ctxRef.current;
  const getMaster = () => masterRef.current ?? ctxRef.current?.destination ?? null;

  // -------- A. Batida de coração --------
  const playHeartbeatPulse = useCallback(() => {
    const ctx = getCtx();
    const out = getMaster();
    if (!ctx || !out) return;
    const now = ctx.currentTime;
    const pulse = (offset: number, freq: number, gain: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(freq, now + offset);
      o.frequency.exponentialRampToValueAtTime(
        Math.max(20, freq * 0.45),
        now + offset + 0.18,
      );
      g.gain.setValueAtTime(0.0001, now + offset);
      g.gain.exponentialRampToValueAtTime(gain, now + offset + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.2);
      o.connect(g).connect(out);
      o.start(now + offset);
      o.stop(now + offset + 0.22);
    };
    pulse(0, 62, 0.42);
    pulse(0.14, 55, 0.34);
  }, []);

  const startHeartbeat = useCallback(
    (intervalMs = 1000) => {
      heartbeatIntervalRef.current = intervalMs;
      if (heartbeatTimerRef.current) {
        window.clearInterval(heartbeatTimerRef.current);
      }
      playHeartbeatPulse();
      heartbeatTimerRef.current = window.setInterval(() => {
        playHeartbeatPulse();
      }, intervalMs) as unknown as number;
    },
    [playHeartbeatPulse],
  );

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  // -------- B. Rufar de tambores --------
  const playDrumRoll = useCallback(
    (durationMs: number, intensity: number) => {
      const ctx = getCtx();
      const out = getMaster();
      if (!ctx || !out) return;
      const seconds = durationMs / 1000;
      const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * seconds));
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      // Ruído branco modulado por LFO de ~15Hz (tremor de baquetas)
      for (let i = 0; i < bufferSize; i++) {
        const t = i / ctx.sampleRate;
        const tremor = 0.55 + 0.45 * Math.sin(2 * Math.PI * 15 * t);
        data[i] = (Math.random() * 2 - 1) * tremor;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 220;
      const gain = ctx.createGain();
      const peak = Math.min(0.55, 0.12 + intensity * 0.14);
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + seconds * 0.7);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
      src.connect(filter).connect(gain).connect(out);
      src.start();
      src.stop(now + seconds);
    },
    [],
  );

  // Loop de tambor de fundo (baixo, contínuo)
  const startDrumLoop = useCallback(
    (intensity = 0.25) => {
      drumIntensityRef.current = intensity;
      if (drumLoopTimerRef.current) {
        window.clearInterval(drumLoopTimerRef.current);
      }
      const tick = () => playDrumRoll(900, drumIntensityRef.current);
      tick();
      drumLoopTimerRef.current = window.setInterval(
        tick,
        850,
      ) as unknown as number;
    },
    [playDrumRoll],
  );

  const setDrumLoopIntensity = useCallback((intensity: number) => {
    drumIntensityRef.current = intensity;
  }, []);

  const stopDrumLoop = useCallback(() => {
    if (drumLoopTimerRef.current) {
      window.clearInterval(drumLoopTimerRef.current);
      drumLoopTimerRef.current = null;
    }
  }, []);

  // -------- C. Fogos de artifício --------
  const playFireworks = useCallback(() => {
    const ctx = getCtx();
    const out = getMaster();
    if (!ctx || !out) return;
    const now = ctx.currentTime;

    // 1) Silvado ascendente
    const whistle = ctx.createOscillator();
    const wg = ctx.createGain();
    whistle.type = "triangle";
    whistle.frequency.setValueAtTime(200, now);
    whistle.frequency.exponentialRampToValueAtTime(1200, now + 0.55);
    wg.gain.setValueAtTime(0.0001, now);
    wg.gain.exponentialRampToValueAtTime(0.08, now + 0.1);
    wg.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
    whistle.connect(wg).connect(out);
    whistle.start(now);
    whistle.stop(now + 0.6);

    // 2) Explosão (pulso de ruído branco com decaimento exponencial)
    const boomStart = now + 0.55;
    const boomDur = 0.65;
    const bufferSize = Math.floor(ctx.sampleRate * boomDur);
    const buf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) d[i] = Math.random() * 2 - 1;
    const boom = ctx.createBufferSource();
    boom.buffer = buf;
    const boomFilter = ctx.createBiquadFilter();
    boomFilter.type = "lowpass";
    boomFilter.frequency.value = 600;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.7, boomStart);
    bg.gain.exponentialRampToValueAtTime(0.001, boomStart + boomDur);
    boom.connect(boomFilter).connect(bg).connect(out);
    boom.start(boomStart);
    boom.stop(boomStart + boomDur);

    // 3) Estalos estéreo (sparkles)
    const merger = ctx.createChannelMerger(2);
    merger.connect(out);
    const sparkleStart = boomStart + 0.08;
    for (let i = 0; i < 22; i++) {
      const t = sparkleStart + Math.random() * 0.9;
      const freq = 2200 + Math.random() * 3800;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      const pan = i % 2 === 0 ? 0 : 1;
      o.connect(g).connect(merger, 0, pan);
      o.start(t);
      o.stop(t + 0.09);
    }
  }, []);

  // -------- D. Fanfarra triunfal --------
  const playVictoryFanfare = useCallback(() => {
    const ctx = getCtx();
    const out = getMaster();
    if (!ctx || !out) return;
    const now = ctx.currentTime;

    // Filtro brilhante para os "metais"
    const brass = ctx.createBiquadFilter();
    brass.type = "lowpass";
    brass.frequency.value = 2600;
    brass.Q.value = 0.7;
    brass.connect(out);

    // Melodia ascendente: C4 E4 G4 C5 (curtas) -> acorde C maior sustentado
    const melody: Array<{ freq: number; dur: number }> = [
      { freq: 261.63, dur: 0.2 },
      { freq: 329.63, dur: 0.2 },
      { freq: 392.0, dur: 0.2 },
      { freq: 523.25, dur: 1.6 },
    ];

    let offset = 0;
    melody.forEach(({ freq, dur }, idx) => {
      // Dois osciladores dente de serra levemente desafinados = brilho de trompete
      [-8, +8].forEach((detune) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(freq, now + offset);
        o.detune.value = detune;
        const start = now + offset;
        g.gain.setValueAtTime(0.0001, start);
        g.gain.linearRampToValueAtTime(0.18, start + 0.04);
        g.gain.exponentialRampToValueAtTime(0.001, start + dur);
        o.connect(g).connect(brass);
        o.start(start);
        o.stop(start + dur + 0.02);
      });
      offset += idx === melody.length - 1 ? 0 : 0.18;
    });

    // Acorde C maior sustentado (C5 E5 G5 C6) acompanhando os confetes
    const chordStart = now + offset + 0.05;
    const chordDur = 1.8;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq) => {
      [-6, +6].forEach((detune) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sawtooth";
        o.frequency.value = freq;
        o.detune.value = detune;
        g.gain.setValueAtTime(0.0001, chordStart);
        g.gain.linearRampToValueAtTime(0.1, chordStart + 0.06);
        g.gain.exponentialRampToValueAtTime(0.001, chordStart + chordDur);
        o.connect(g).connect(brass);
        o.start(chordStart);
        o.stop(chordStart + chordDur + 0.05);
      });
    });
  }, []);

  // Loop festivo da fanfarra
  const startFanfareLoop = useCallback(() => {
    if (fanfareLoopTimerRef.current) return;
    playVictoryFanfare();
    fanfareLoopTimerRef.current = window.setInterval(() => {
      playVictoryFanfare();
    }, 4200) as unknown as number;
  }, [playVictoryFanfare]);

  const stopFanfareLoop = useCallback(() => {
    if (fanfareLoopTimerRef.current) {
      window.clearInterval(fanfareLoopTimerRef.current);
      fanfareLoopTimerRef.current = null;
    }
  }, []);

  // -------- Conveniência: ajustar nível de suspense --------
  const setSuspenseLevel = useCallback(
    (level: SuspenseLevel) => {
      const beat = level >= 3 ? 380 : level === 2 ? 520 : level === 1 ? 700 : 1000;
      const drumIntensity =
        level >= 3 ? 1.4 : level === 2 ? 1.0 : level === 1 ? 0.65 : 0.3;
      startHeartbeat(beat);
      setDrumLoopIntensity(drumIntensity);
    },
    [startHeartbeat, setDrumLoopIntensity],
  );

  // -------- Cleanup --------
  useEffect(() => {
    return () => {
      stopHeartbeat();
      stopDrumLoop();
      stopFanfareLoop();
      try {
        ctxRef.current?.close();
      } catch {
        /* noop */
      }
      ctxRef.current = null;
      masterRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    enabled,
    enable,
    startHeartbeat,
    stopHeartbeat,
    startDrumLoop,
    stopDrumLoop,
    setDrumLoopIntensity,
    playDrumRoll,
    playFireworks,
    playVictoryFanfare,
    startFanfareLoop,
    stopFanfareLoop,
    setSuspenseLevel,
  };
}