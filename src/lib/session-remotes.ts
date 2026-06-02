import { supabase } from "@/integrations/supabase/client";

/**
 * Camada de helpers para a tabela `session_remotes`. Cada sessão admite
 * UM único controle remoto autorizado por vez. Solicitações entram como
 * `pending` e exigem aprovação explícita do palestrante (Dashboard).
 */

export type SessionRemote = {
  id: string;
  session_id: string;
  presentation_id: string | null;
  slot: 1;
  operator_name: string;
  device_token: string | null;
  user_id: string | null;
  user_email: string | null;
  status: "pending" | "authorized" | "denied";
  authorized_at: string | null;
  denied_at: string | null;
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
 * Solicita autorização para atuar como controle remoto. SEMPRE entra como
 * `pending` e exige aprovação do palestrante. Reentrada do mesmo usuário
 * autenticado devolve o registro existente (preservando status atual).
 * Retorna `null` se já houver outro controle autorizado nesta sessão.
 */
export async function requestRemoteAuthorization(
  sessionId: string,
  operatorName: string,
  deviceToken: string,
  user: { id: string; email: string | null },
): Promise<SessionRemote | null> {
  // Descobre a apresentação ligada à sessão (necessário para RLS)
  const { data: sess } = await supabase
    .from("sessions")
    .select("presentation_id")
    .eq("id", sessionId)
    .maybeSingle();
  const presentationId = (sess as any)?.presentation_id as string | undefined;
  if (!presentationId) return null;

  // 1. Reentrada — mesmo usuário autenticado já solicitou nesta sessão.
  const { data: existing } = await supabase
    .from("session_remotes")
    .select("*")
    .eq("session_id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing) {
    await supabase
      .from("session_remotes")
      .update({
        operator_name: operatorName,
        device_token: deviceToken,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", (existing as any).id);
    return { ...(existing as any), operator_name: operatorName } as SessionRemote;
  }

  // 2. Bloqueia se já houver outro controle AUTORIZADO nesta sessão
  //    (pendências paralelas são permitidas — o palestrante decide).
  const { data: authorizedRows } = await supabase
    .from("session_remotes")
    .select("id")
    .eq("session_id", sessionId)
    .eq("status", "authorized");
  if ((authorizedRows ?? []).length > 0) return null;

  const { data: inserted, error } = await supabase
    .from("session_remotes")
    .insert({
      session_id: sessionId,
      presentation_id: presentationId,
      slot: 1,
      operator_name: operatorName,
      device_token: deviceToken,
      user_id: user.id,
      user_email: user.email,
      status: "pending",
    })
    .select("*")
    .single();
  if (!error && inserted) return inserted as SessionRemote;
  return null;
}

/** Compat: alias antigo redireciona para a nova API. */
export const claimRemoteSlot = requestRemoteAuthorization;

/** Autoriza uma solicitação de controle remoto (somente dono). */
export async function authorizeRemote(remoteId: string) {
  const { error } = await supabase
    .from("session_remotes")
    .update({ status: "authorized", authorized_at: new Date().toISOString(), denied_at: null })
    .eq("id", remoteId);
  if (error) throw error;
}

/** Nega/revoga uma solicitação de controle remoto (somente dono). */
export async function denyRemote(remoteId: string) {
  const { error } = await supabase
    .from("session_remotes")
    .update({ status: "denied", denied_at: new Date().toISOString(), authorized_at: null })
    .eq("id", remoteId);
  if (error) throw error;
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