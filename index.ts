import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type QueueItem = {
  id: string;
  broadcast_id: string | null;
  notification_id: string;
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
  message: string | null;
  attempts: number;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function emailMarkup(item: QueueItem, appUrl: string) {
  const name = escapeHtml(item.recipient_name || "miembro ROIS");
  const subject = escapeHtml(item.subject);
  const message = escapeHtml(item.message || "Tienes una nueva alerta pendiente en tu perfil ROIS.")
    .replaceAll("\n", "<br>");
  return `<!doctype html>
  <html lang="es"><body style="margin:0;background:#f4f5f6;font-family:Arial,sans-serif;color:#111">
    <div style="max-width:620px;margin:0 auto;padding:32px 18px">
      <div style="background:#050505;border-radius:26px 26px 0 0;padding:30px;color:#fff">
        <div style="font-size:22px;letter-spacing:.28em">ROIS</div>
        <p style="margin:24px 0 0;color:#aeb5bd;font-size:12px;letter-spacing:.16em;text-transform:uppercase">Alerta de perfil</p>
      </div>
      <div style="background:#fff;border-radius:0 0 26px 26px;padding:32px;border:1px solid #e5e7e9;border-top:0">
        <p style="margin:0 0 12px;color:#68717d">Hola, ${name}.</p>
        <h1 style="font-size:28px;line-height:1.15;margin:0 0 18px">${subject}</h1>
        <p style="font-size:16px;line-height:1.7;color:#3d4650;margin:0 0 26px">${message}</p>
        <a href="${escapeHtml(appUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:14px 22px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Abrir mi perfil ROIS</a>
        <p style="margin:28px 0 0;color:#87909a;font-size:12px;line-height:1.6">Este correo informa que existe una alerta pendiente. La información y las acciones oficiales se consultan dentro de ROIS.</p>
      </div>
    </div>
  </body></html>`;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";
  const emailFrom = Deno.env.get("ROIS_EMAIL_FROM") || "ROIS <notificaciones@roistrade.com>";
  const appUrl = Deno.env.get("ROIS_APP_URL") || "https://roistrade.com";
  const authorization = request.headers.get("Authorization") || "";

  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: "Supabase secrets are not configured" }, 500);
  if (!resendApiKey) return json({ error: "RESEND_API_KEY is not configured; dashboard alerts remain queued" }, 503);
  if (!authorization.startsWith("Bearer ")) return json({ error: "Missing authorization" }, 401);

  try {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser(authorization.slice(7));
    if (userError || !userData.user) return json({ error: "Invalid session" }, 401);

    const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const userEmail = String(userData.user.email || "").trim().toLowerCase();
    const profileLookup = userEmail
      ? `id.eq.${userData.user.id},email.eq.${userEmail}`
      : `id.eq.${userData.user.id}`;
    const { data: profile, error: profileError } = await service
      .from("profiles")
      .select("id,role,status")
      .or(profileLookup)
      .maybeSingle();
    if (profileError || profile?.role !== "admin" || profile?.status !== "approved") {
      return json({ error: "Admin access required" }, 403);
    }

    const payload = await request.json();
    const broadcastId = String(payload?.broadcastId || "").trim();
    const notificationId = String(payload?.notificationId || "").trim();
    if (!broadcastId && !notificationId) return json({ error: "broadcastId or notificationId is required" }, 400);

    let queueQuery = service
      .from("notification_email_queue")
      .select("id,broadcast_id,notification_id,recipient_email,recipient_name,subject,message,attempts")
      .in("status", ["queued", "email_error"])
      .lt("attempts", 3)
      .order("created_at", { ascending: true })
      .limit(250);
    queueQuery = broadcastId ? queueQuery.eq("broadcast_id", broadcastId) : queueQuery.eq("notification_id", notificationId);
    const { data: queue, error: queueError } = await queueQuery;
    if (queueError) throw queueError;

    let sent = 0;
    let failed = 0;
    for (const item of (queue || []) as QueueItem[]) {
      await service.from("notification_email_queue").update({ status: "sending" }).eq("id", item.id);
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `rois-notification-${item.notification_id}`,
          },
          body: JSON.stringify({
            from: emailFrom,
            to: [item.recipient_email],
            subject: `ROIS | ${item.subject}`,
            html: emailMarkup(item, appUrl),
          }),
        });
        if (!response.ok) throw new Error(await response.text());
        const sentAt = new Date().toISOString();
        await Promise.all([
          service.from("notification_email_queue").update({ status: "sent", attempts: item.attempts + 1, last_error: null, sent_at: sentAt }).eq("id", item.id),
          service.from("athlete_notifications").update({ email_status: "sent" }).eq("id", item.notification_id),
        ]);
        sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 1000) : "Email provider error";
        await Promise.all([
          service.from("notification_email_queue").update({ status: "email_error", attempts: item.attempts + 1, last_error: message }).eq("id", item.id),
          service.from("athlete_notifications").update({ email_status: "email_error" }).eq("id", item.notification_id),
        ]);
        failed += 1;
      }
    }

    return json({ processed: (queue || []).length, sent, failed });
  } catch (error) {
    console.error("[ROIS notification email]", error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
