import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type RemoteAction =
  | "NEXT"
  | "PREV"
  | "TOGGLE_FULLSCREEN"
  | "SHOW_PODIUM"
  | "TOGGLE_GIANT_QR"
  | "SHOW_GIANT_QR"
  | "HIDE_GIANT_QR"
  | "TOGGLE_RANKING"
  | "SHOW_RANKING"
  | "HIDE_RANKING"
  | "END_EARLY"
  | "LASER"
  | "LASER_OFF";

export type BridgeStatus = "connecting" | "connected" | "disconnected";

type Role = "remote" | "projector";

type Options = {
  sessionId: string;
  role: Role;
  /** Chamado no projetor quando o celular envia um comando. */
  onAction?: (action: RemoteAction, payload: any) => void;
};

const HEARTBEAT_MS = 5000;
const PARTNER_TIMEOUT_MS = 12000;
const MAX_BACKOFF_MS = 8000;

/**
 * Ponte de tempo real entre o celular (controle remoto) e o computador
 * (projetor). Usa Supabase Broadcast (sem delay de banco) com heartbeat
 * e reconexão automática com backoff exponencial.
 */
export function useRemoteBridge({ sessionId, role, onAction }: Options) {
  const [status, setStatus] = useState<BridgeStatus>("connecting");
  const [partnerOnline, setPartnerOnline] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const onActionRef = useRef(onAction);
  const heartbeatRef = useRef<number | null>(null);
  const partnerTimeoutRef = useRef<number | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    onActionRef.current = onAction;
  }, [onAction]);

  useEffect(() => {
    if (!sessionId) return;
    cancelledRef.current = false;

    function markPartnerOnline() {
      setPartnerOnline(true);
      if (partnerTimeoutRef.current) window.clearTimeout(partnerTimeoutRef.current);
      partnerTimeoutRef.current = window.setTimeout(() => {
        setPartnerOnline(false);
      }, PARTNER_TIMEOUT_MS);
    }

    function clearTimers() {
      if (heartbeatRef.current) {
        window.clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (partnerTimeoutRef.current) {
        window.clearTimeout(partnerTimeoutRef.current);
        partnerTimeoutRef.current = null;
      }
      if (reconnectRef.current) {
        window.clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
    }

    function scheduleReconnect() {
      if (cancelledRef.current) return;
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * Math.pow(2, attemptRef.current));
      attemptRef.current += 1;
      console.log(`[ponte] Reconectando ao projetor em ${delay}ms...`);
      reconnectRef.current = window.setTimeout(() => {
        if (channelRef.current) {
          try {
            supabase.removeChannel(channelRef.current);
          } catch {
            /* ignora */
          }
          channelRef.current = null;
        }
        connect();
      }, delay);
    }

    function connect() {
      if (cancelledRef.current) return;
      setStatus("connecting");

      const channel = supabase.channel(`remote-bridge-${sessionId}`, {
        config: {
          broadcast: { self: false, ack: true },
        },
      });

      channel
        .on("broadcast", { event: "remote-action" }, ({ payload }) => {
          if (role !== "projector") return;
          const action = payload?.action as RemoteAction | undefined;
          if (!action) return;
          console.log("[ponte] Comando recebido do celular:", action);
          onActionRef.current?.(action, payload);
        })
        .on("broadcast", { event: "handshake" }, ({ payload }) => {
          if (payload?.from && payload.from !== role) markPartnerOnline();
        })
        .on("broadcast", { event: "heartbeat" }, ({ payload }) => {
          if (payload?.from && payload.from !== role) markPartnerOnline();
        })
        .subscribe((subStatus) => {
          if (cancelledRef.current) return;
          if (subStatus === "SUBSCRIBED") {
            console.log("[ponte] Conectado ao canal de tempo real.");
            attemptRef.current = 0;
            setStatus("connected");
            // Apresenta-se ao parceiro
            channel
              .send({
                type: "broadcast",
                event: "handshake",
                payload: { from: role, ts: Date.now() },
              })
              .catch(() => {
                /* ignora */
              });
            // Heartbeat
            if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
            heartbeatRef.current = window.setInterval(() => {
              channel
                .send({
                  type: "broadcast",
                  event: "heartbeat",
                  payload: { from: role, ts: Date.now() },
                })
                .catch(() => {
                  /* ignora */
                });
            }, HEARTBEAT_MS);
          } else if (
            subStatus === "CHANNEL_ERROR" ||
            subStatus === "TIMED_OUT" ||
            subStatus === "CLOSED"
          ) {
            console.warn("[ponte] Conexão perdida:", subStatus);
            setStatus("disconnected");
            setPartnerOnline(false);
            if (heartbeatRef.current) {
              window.clearInterval(heartbeatRef.current);
              heartbeatRef.current = null;
            }
            scheduleReconnect();
          }
        });

      channelRef.current = channel;
    }

    connect();

    return () => {
      cancelledRef.current = true;
      clearTimers();
      if (channelRef.current) {
        try {
          supabase.removeChannel(channelRef.current);
        } catch {
          /* ignora */
        }
        channelRef.current = null;
      }
    };
  }, [sessionId, role]);

  async function send(action: RemoteAction, extra?: Record<string, any>) {
    const ch = channelRef.current;
    if (!ch) return false;
    try {
      const res = await ch.send({
        type: "broadcast",
        event: "remote-action",
        payload: { action, from: role, ts: Date.now(), ...(extra ?? {}) },
      });
      return res === "ok";
    } catch (err) {
      console.warn("[ponte] Falha ao enviar comando:", action, err);
      return false;
    }
  }

  return { status, partnerOnline, send };
}