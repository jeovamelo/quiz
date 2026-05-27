import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

type Role = "desktop" | "mobile";

const PING_MS = 3000;
const TIMEOUT_MS = 6000;
const STORAGE_KEY = "quizpulse:presence-user";

/**
 * Monitor persistente de presença entre o computador (desktop) e o celular
 * (mobile) do mesmo palestrante. Usa Supabase Broadcast num canal único
 * por usuário (`presence_channel_<userId>`) com heartbeat ping/pong de 3s
 * e timeout de 6s para detectar perda imediata de sinal (ex.: celular
 * bloqueado, perda de Wi‑Fi no auditório).
 */
export function usePresenceMonitor(userId: string | undefined, role: Role) {
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastPongRef = useRef<number>(0);
  const pingTimerRef = useRef<number | null>(null);
  const checkTimerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const rebuildRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!userId) return;
    cancelledRef.current = false;

    try {
      window.localStorage.setItem(STORAGE_KEY, userId);
    } catch {
      /* ignora */
    }

    function clearTimers() {
      if (pingTimerRef.current) {
        window.clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      if (checkTimerRef.current) {
        window.clearInterval(checkTimerRef.current);
        checkTimerRef.current = null;
      }
    }

    function teardown() {
      clearTimers();
      if (channelRef.current) {
        try {
          supabase.removeChannel(channelRef.current);
        } catch {
          /* ignora */
        }
        channelRef.current = null;
      }
    }

    function build() {
      if (cancelledRef.current || !userId) return;
      teardown();
      setIsReconnecting(true);
      lastPongRef.current = 0;

      const channel = supabase.channel(`presence_channel_${userId}`, {
        config: { broadcast: { self: false, ack: false } },
      });

      channel
        .on("broadcast", { event: "ping" }, () => {
          // Celular responde imediatamente ao ping do computador
          if (role === "mobile") {
            setIsConnected(true);
            setIsReconnecting(false);
            lastPongRef.current = Date.now();
            channel
              .send({
                type: "broadcast",
                event: "pong",
                payload: { ts: Date.now() },
              })
              .catch(() => {
                /* ignora */
              });
          }
        })
        .on("broadcast", { event: "pong" }, () => {
          if (role === "desktop") {
            lastPongRef.current = Date.now();
            setIsConnected(true);
            setIsReconnecting(false);
          }
        })
        .on("broadcast", { event: "handshake" }, ({ payload }) => {
          if (payload?.from && payload.from !== role) {
            lastPongRef.current = Date.now();
            setIsConnected(true);
            setIsReconnecting(false);
          }
        })
        .subscribe((status) => {
          if (cancelledRef.current) return;
          if (status === "SUBSCRIBED") {
            setIsReconnecting(false);
            // Apresenta-se à outra ponta
            channel
              .send({
                type: "broadcast",
                event: "handshake",
                payload: { from: role, ts: Date.now() },
              })
              .catch(() => {
                /* ignora */
              });

            // Computador envia pings de 3 em 3 segundos
            if (role === "desktop") {
              pingTimerRef.current = window.setInterval(() => {
                channel
                  .send({
                    type: "broadcast",
                    event: "ping",
                    payload: { ts: Date.now() },
                  })
                  .catch(() => {
                    /* ignora */
                  });
              }, PING_MS);

              checkTimerRef.current = window.setInterval(() => {
                if (
                  lastPongRef.current > 0 &&
                  Date.now() - lastPongRef.current > TIMEOUT_MS
                ) {
                  setIsConnected(false);
                }
              }, PING_MS);
            } else {
              // Celular monitora chegada de pings; se ficar 6s sem ping, cai
              checkTimerRef.current = window.setInterval(() => {
                if (
                  lastPongRef.current > 0 &&
                  Date.now() - lastPongRef.current > TIMEOUT_MS
                ) {
                  setIsConnected(false);
                }
              }, PING_MS);
            }
          } else if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            setIsConnected(false);
            setIsReconnecting(true);
            // Tenta reconstruir o canal automaticamente
            window.setTimeout(() => {
              if (!cancelledRef.current) build();
            }, 3000);
          }
        });

      channelRef.current = channel;
    }

    rebuildRef.current = build;
    build();

    return () => {
      cancelledRef.current = true;
      teardown();
      setIsConnected(false);
      setIsReconnecting(false);
    };
  }, [userId, role]);

  const forceConnection = useCallback(() => {
    rebuildRef.current?.();
  }, []);

  return { isConnected, isReconnecting, forceConnection };
}