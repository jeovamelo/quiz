import { supabase } from "@/integrations/supabase/client";

/**
 * Camada de helpers para a tabela `session_remotes`. Cada sessão admite
 * UM único controle remoto (slot 1), atribuído por ordem de chegada do
 * QR Code de pareamento.
 */

export type SessionRemote = {
  id: string;
  session_id: string;
  slot: 1;
  operator_name: string;
  device_token: string | null;
  last_seen_at: string;
  created_at: string;
};

function keyFor(sessionId: string) {
  return `quizpulse:remote:${sessionId}`;
}

export type StoredRemote = {
  remoteId: string;
  slot: 1;
  name: string;
  deviceToken: string;
};

export function loadStoredRemote(sessionId: string): StoredRemote | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(keyFor(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.remoteId === "string" &&
      parsed.slot === 1 &&
      typeof parsed.name === "string"
    ) {
      return parsed as StoredRemote;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveStoredRemote(sessionId: string, value: StoredRemote) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(keyFor(sessionId), JSON.stringify(value));
  } catch {
    /* ignora */
  }
}

export function clearStoredRemote(sessionId: string) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(keyFor(sessionId));
  } catch {
    /* ignora */
  }
}

export function getOrCreateDeviceToken(sessionId: string): string {
  const existing = loadStoredRemote(sessionId);
  if (existing?.deviceToken) return existing.deviceToken;
  const token = `dev_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  return token;
}

/**
 * Tenta reivindicar o único slot da sessão. Se o `deviceToken` já ocupa
 * o slot, devolve-o (re-entrada). Retorna null se outro aparelho já
 * estiver conectado a esta sessão.
 */
export async function claimRemoteSlot(
  sessionId: string,
  operatorName: string,
  deviceToken: string,
): Promise<SessionRemote | null> {
  // 1. Reentrada — mesmo aparelho já cadastrado.
  const { data: existing } = await supabase
    .from("session_remotes")
    .select("*")
    .eq("session_id", sessionId)
    .eq("device_token", deviceToken)
    .maybeSingle();
  if (existing) {
    await supabase
      .from("session_remotes")
      .update({ operator_name: operatorName, last_seen_at: new Date().toISOString() })
      .eq("id", (existing as any).id);
    return { ...(existing as any), operator_name: operatorName } as SessionRemote;
  }

  // 2. Apenas 1 controle por sessão. Se o slot 1 já estiver ocupado por
  // outro aparelho, recusa.
  const { data: rows } = await supabase
    .from("session_remotes")
    .select("slot")
    .eq("session_id", sessionId);
  if ((rows ?? []).length > 0) return null;
  const { data: inserted, error } = await supabase
    .from("session_remotes")
    .insert({
      session_id: sessionId,
      slot: 1,
      operator_name: operatorName,
      device_token: deviceToken,
    })
    .select("*")
    .single();
  if (!error && inserted) return inserted as SessionRemote;
  return null;
}

export async function heartbeatRemote(remoteId: string) {
  await supabase
    .from("session_remotes")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", remoteId);
}

export async function releaseRemoteSlot(remoteId: string) {
  await supabase.from("session_remotes").delete().eq("id", remoteId);
}