import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Túnel WebRTC P2P entre celular e projetor.
 *
 * Estratégia: o computador (host) aguarda o celular (guest) anunciar
 * presença no canal de sinalização do Supabase Realtime. Em seguida o host
 * gera uma SDP Offer, recebe a Answer e troca candidatos ICE.
 *
 * Se em até 8s o RTCDataChannel não atingir o estado "open", marcamos
 * `transport = 'fallback'` para que o chamador sinalize ao usuário que
 * o controle remoto seguirá pela nuvem (com possível lentidão).
 */

export type TunnelTransport = "connecting" | "p2p" | "fallback";

type Role = "host" | "guest";

type Options = {
  sessionId: string;
  slot: 1 | 2;
  role: Role;
  /** Mensagens recebidas pelo DataChannel local. */
  onMessage?: (msg: any) => void;
  /** Se false, desabilita o túnel (ex.: navegador sem suporte). */
  enabled?: boolean;
};

const HANDSHAKE_TIMEOUT_MS = 8000;
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

export function useWebRTCTunnel({ sessionId, slot, role, onMessage, enabled = true }: Options) {
  const [transport, setTransport] = useState<TunnelTransport>("connecting");
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const onMessageRef = useRef(onMessage);
  const cancelledRef = useRef(false);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!enabled || !sessionId) return;
    if (typeof window === "undefined" || typeof window.RTCPeerConnection === "undefined") {
      setTransport("fallback");
      return;
    }
    cancelledRef.current = false;
    setTransport("connecting");

    let timeoutId: number | null = null;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    // Auditoria de candidatos ICE: se virmos pelo menos um par host<->host
    // confirmado pela pc.getStats(), classificamos a conexão como LAN
    // (mesmo roteador). Caso contrário, mesmo com DataChannel aberto via
    // srflx/relay, consideramos modo de contingência (nuvem/WAN).
    let sawLocalHostCandidate = false;
    let lanConfirmed = false;

    const signalingTopic = `webrtc-${sessionId}-${slot}`;
    const channel = supabase.channel(signalingTopic, {
      config: { broadcast: { self: false, ack: false } },
    });
    channelRef.current = channel;

    function sendSignal(event: string, payload: any) {
      try {
        channel.send({ type: "broadcast", event, payload: { ...payload, from: role } });
      } catch {
        /* ignora */
      }
    }

    function attachDataChannel(dc: RTCDataChannel) {
      dcRef.current = dc;
      dc.onopen = () => {
        if (cancelledRef.current) return;
        console.log(`[webrtc:${role}:slot${slot}] DataChannel aberto — P2P ativo.`);
        setTransport("p2p");
        if (timeoutId) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }
      };
      dc.onclose = () => {
        if (cancelledRef.current) return;
        console.warn(`[webrtc:${role}:slot${slot}] DataChannel fechado.`);
        setTransport((prev) => (prev === "p2p" ? "fallback" : prev));
      };
      dc.onerror = () => {
        if (cancelledRef.current) return;
        setTransport((prev) => (prev === "p2p" ? "fallback" : prev));
      };
      dc.onmessage = (ev) => {
        try {
          const msg = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
          onMessageRef.current?.(msg);
        } catch {
          onMessageRef.current?.(ev.data);
        }
      };
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        const cand = e.candidate.candidate || "";
        if (cand.includes("typ host")) {
          sawLocalHostCandidate = true;
          console.log(`[auditoria-rede:${role}:slot${slot}] candidato local 'typ host' gerado.`);
        }
        sendSignal("ice", { candidate: e.candidate.toJSON() });
      }
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "failed" || s === "disconnected" || s === "closed") {
        if (cancelledRef.current) return;
        setTransport((prev) => (prev === "p2p" ? "fallback" : prev));
        return;
      }
      if (s === "connected") {
        // Pequeno atraso para o par candidato nomeado aparecer nas stats.
        window.setTimeout(() => {
          if (cancelledRef.current) return;
          inspectSelectedCandidatePair(pc).then((result) => {
            if (cancelledRef.current) return;
            if (result === "lan") {
              lanConfirmed = true;
              console.log(
                `[auditoria-rede:${role}:slot${slot}] Conexão local direta (LAN) confirmada — par host<->host.`,
              );
              setTransport("p2p");
            } else if (result === "wan") {
              console.log(
                `[auditoria-rede:${role}:slot${slot}] Conexão externa/reflexiva detectada — operando via WAN (nuvem).`,
              );
              setTransport("fallback");
            } else if (!lanConfirmed && !sawLocalHostCandidate) {
              setTransport("fallback");
            }
          });
        }, 600);
      }
    };

    // Host cria DataChannel já no momento da oferta.
    if (role === "host") {
      const dc = pc.createDataChannel("control-channel", { ordered: true });
      attachDataChannel(dc);
    } else {
      pc.ondatachannel = (ev) => attachDataChannel(ev.channel);
    }

    async function createAndSendOffer() {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal("offer", { sdp: offer });
      } catch (err) {
        console.warn(`[webrtc:${role}:slot${slot}] erro ao criar offer`, err);
        setTransport("fallback");
      }
    }

    channel
      .on("broadcast", { event: "ready" }, ({ payload }) => {
        if (payload?.from === role) return;
        if (role === "host" && pc.signalingState === "stable" && !pc.currentRemoteDescription) {
          createAndSendOffer();
        }
      })
      .on("broadcast", { event: "offer" }, async ({ payload }) => {
        if (role !== "guest" || !payload?.sdp) return;
        try {
          await pc.setRemoteDescription(payload.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal("answer", { sdp: answer });
        } catch (err) {
          console.warn(`[webrtc:guest:slot${slot}] erro ao responder offer`, err);
          setTransport("fallback");
        }
      })
      .on("broadcast", { event: "answer" }, async ({ payload }) => {
        if (role !== "host" || !payload?.sdp) return;
        try {
          await pc.setRemoteDescription(payload.sdp);
        } catch (err) {
          console.warn(`[webrtc:host:slot${slot}] erro ao aplicar answer`, err);
          setTransport("fallback");
        }
      })
      .on("broadcast", { event: "ice" }, async ({ payload }) => {
        if (!payload?.candidate) return;
        try {
          await pc.addIceCandidate(payload.candidate);
        } catch {
          /* ignora candidatos tardios */
        }
      })
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        // Anuncia presença para iniciar/retomar handshake.
        sendSignal("ready", {});
      });

    // Timeout de consolidação: 8s.
    timeoutId = window.setTimeout(() => {
      if (cancelledRef.current) return;
      if (dcRef.current?.readyState !== "open") {
        console.warn(`[webrtc:${role}:slot${slot}] timeout — fallback para nuvem.`);
        setTransport("fallback");
      }
    }, HANDSHAKE_TIMEOUT_MS);

    return () => {
      cancelledRef.current = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      try {
        dcRef.current?.close();
      } catch {
        /* ignora */
      }
      dcRef.current = null;
      try {
        pc.close();
      } catch {
        /* ignora */
      }
      pcRef.current = null;
      try {
        supabase.removeChannel(channel);
      } catch {
        /* ignora */
      }
      channelRef.current = null;
    };
  }, [sessionId, slot, role, enabled]);

  const send = useCallback((msg: any) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return false;
    try {
      dc.send(typeof msg === "string" ? msg : JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }, []);

  return { transport, send };
}