import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Authorize a desktop QR login session.
 *
 * Rather than sharing the mobile user's own access/refresh tokens (which
 * causes Supabase to revoke the session due to refresh-token reuse between
 * two clients), we generate a fresh magic-link token for the same user and
 * hand only that token_hash to the desktop. The desktop then exchanges it
 * via `supabase.auth.verifyOtp({ type: 'magiclink', token_hash })`, which
 * creates a brand-new, independent session for that browser.
 */
export const authorizeQrLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      qrSessionId: z.string().uuid(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;
    const email = (claims?.email as string | undefined) ?? null;
    if (!email) {
      throw new Error("Sua conta não possui e-mail associado.");
    }

    // Validate the QR session is still pending and not expired.
    const { data: qr, error: qrErr } = await supabaseAdmin
      .from("qr_login_sessions")
      .select("id, status, expires_at")
      .eq("id", data.qrSessionId)
      .maybeSingle();

    if (qrErr) throw new Error(qrErr.message);
    if (!qr) throw new Error("QR Code não encontrado.");
    if (qr.status !== "pending") throw new Error("Este QR Code já foi utilizado.");
    if (new Date(qr.expires_at).getTime() < Date.now()) {
      throw new Error("Este QR Code expirou.");
    }

    // Look up the user's display name from the profile (best effort).
    let userName: string | null = null;
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, username")
      .eq("user_id", userId)
      .maybeSingle();
    if (profile) {
      userName = profile.full_name ?? profile.username ?? null;
    }

    // Generate a magic-link token tied to this user. We do not send the email
    // — we only use the returned hashed_token for verifyOtp on the desktop.
    const { data: link, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr || !link?.properties?.hashed_token) {
      throw new Error(linkErr?.message ?? "Falha ao gerar token de login.");
    }

    const tokenHash = link.properties.hashed_token;

    // Persist the token hash so the desktop (subscribed via Realtime) can
    // pick it up. We reuse the existing `access_token` column to avoid a
    // schema change; `refresh_token` is left null.
    const { error: updErr } = await supabaseAdmin
      .from("qr_login_sessions")
      .update({
        status: "authorized",
        access_token: tokenHash,
        refresh_token: null,
        authorized_user_id: userId,
        user_email: email,
        user_name: userName ?? email,
        authorized_at: new Date().toISOString(),
      })
      .eq("id", data.qrSessionId)
      .eq("status", "pending");

    if (updErr) throw new Error(updErr.message);

    return { ok: true as const };
  });