import { create } from "zustand";
import { persist } from "zustand/middleware";

type CockpitState = {
  sessionId: string | null;
  presentationId: string | null;
  currentSlide: number;
  totalSlides: number;
  elapsedSeconds: number;
  isRunning: boolean;
};

type CockpitActions = {
  initSession: (sessionId: string, presentationId: string, totalSlides: number) => void;
  setSlide: (n: number) => void;
  tick: () => void;
  start: () => void;
  pause: () => void;
  reset: () => void;
  clear: () => void;
};

const INITIAL_STATE: CockpitState = {
  sessionId: null,
  presentationId: null,
  currentSlide: 1,
  totalSlides: 0,
  elapsedSeconds: 0,
  isRunning: false,
};

export const useCockpitStore = create<CockpitState & CockpitActions>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,

      initSession: (sessionId, presentationId, totalSlides) =>
        set({
          sessionId,
          presentationId,
          totalSlides,
          currentSlide: 1,
          elapsedSeconds: 0,
          isRunning: false,
        }),

      setSlide: (currentSlide) => set({ currentSlide }),

      tick: () =>
        set((s) => ({
          elapsedSeconds: s.isRunning ? s.elapsedSeconds + 1 : s.elapsedSeconds,
        })),

      start: () => set({ isRunning: true }),
      pause: () => set({ isRunning: false }),
      reset: () => set({ currentSlide: 1, elapsedSeconds: 0, isRunning: false }),
      clear: () => set(INITIAL_STATE),
    }),
    {
      name: "quizbini-cockpit",
      // Only persist recoverable state — omit isRunning so it always starts paused
      partialize: (s) => ({
        sessionId: s.sessionId,
        presentationId: s.presentationId,
        currentSlide: s.currentSlide,
        totalSlides: s.totalSlides,
        elapsedSeconds: s.elapsedSeconds,
      }),
    },
  ),
);

// Derived selectors
export const selectElapsedFormatted = (s: CockpitState): string => {
  const m = Math.floor(s.elapsedSeconds / 60).toString().padStart(2, "0");
  const sec = (s.elapsedSeconds % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
};
