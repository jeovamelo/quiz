import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Role = "desktop" | "mobile";

/**
 * Pareamento de presença entre o Dashboard (computador) e o Controle
 * Remoto (celular) do mesmo palestrante logado. Cada lado se anuncia no
 * canal `pair-${userId}` via Presence; o outro lado vê quem está online.
 */
export function usePairingPresence(userId: string | undefined, role: Role) {
  const [partnerOnline, setPartnerOnline] = useState(false);
  const [partnerInfo, setPartnerInfo] = useState<{ device?: string } | null>(null);

  useEffect(() => {
    if (!userId) return;
    const key = `${role}-${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase.channel(`pair-${userId}`, {
      config: { presence: { key } },
    });

    function recompute() {
      const state = channel.presenceState() as Record<string, Array<any>>;
      const partners: any[] = [];
      for (const entries of Object.values(state)) {
        for (const e of entries) {
          if (e?.role && e.role !== role) partners.push(e);
        }
      }
      setPartnerOnline(partners.length > 0);
      setPartnerInfo(partners[0] ?? null);
    }

    channel
      .on("presence", { event: "sync" }, recompute)
      .on("presence", { event: "join" }, recompute)
      .on("presence", { event: "leave" }, recompute)
      .subscribe(async (status) => {
        if (status !== "SUBSCRIBED") return;
        const device =
          typeof navigator !== "undefined"
            ? navigator.userAgent.split(")")[0].split("(")[1] || navigator.userAgent
            : "";
        await channel.track({ role, device, ts: Date.now() });
      });

    return () => {
      try {
        channel.untrack();
      } catch {
        /* ignora */
      }
      supabase.removeChannel(channel);
      setPartnerOnline(false);
      setPartnerInfo(null);
    };
  }, [userId, role]);

  return { partnerOnline, partnerInfo };
}