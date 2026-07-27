import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Prospect = {
  id: string;
  name: string;
  email: string;
  prospect_type: "company" | "creator" | "athlete";
  organization: string | null;
  scout_code: string | null;
  invitation_attempts: number | null;
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

function invitationContent(prospect: Prospect) {
  if (prospect.prospect_type === "company") {
    return {
      account: "empresa",
      title: "Tu empresa fue invitada a ROIS",
      description: "Crea tu cuenta empresarial para evaluar deportistas, creadores, eventos y oportunidades comerciales con información estructurada.",
      benefits: [
        "Consulta perfiles y Sponsor Decks preparados para evaluación.",
        "Envía solicitudes de patrocinio y colaboración desde ROIS.",
        "Explora eventos y oportunidades comerciales sujetas a revisión.",
      ],
    };
  }
  if (prospect.prospect_type === "creator") {
    return {
      account: "creador",
      title: "Tu perfil creativo fue invitado a ROIS",
      description: "Crea tu perfil para presentar tu audiencia, contenido, resultados y beneficios a marcas mediante un Sponsor Deck ROIS.",
      benefits: [
        "Construye una propuesta comercial clara para marcas.",
        "Accede a oportunidades de contenido, embajadurías y patrocinio.",
        "Activa tu red Scout y da seguimiento a tus referidos.",
      ],
    };
  }
  return {
    account: "deportista",
    title: "Tu perfil deportivo fue invitado a ROIS",
    description: "Crea tu perfil para presentar trayectoria, resultados, calendario y beneficios para patrocinadores dentro de ROIS.",
    benefits: [
      "Construye tu Sponsor Deck desde el dashboard.",
      "Presenta evidencia y activos comerciales a empresas.",
      "Activa tu red Scout y da seguimiento a tus referidos.",
    ],
  };
}

function registrationUrl(prospect: Prospect, appUrl: string) {
  const url = new URL(appUrl);
  url.searchParams.set("register", prospect.prospect_type);
  if (prospect.prospect_type !== "company" && prospect.scout_code) {
    url.searchParams.set("scout", prospect.scout_code);
  }
  return url.toString();
}

function emailMarkup(prospect: Prospect, appUrl: string) {
  const content = invitationContent(prospect);
  const url = registrationUrl(prospect, appUrl);
  const benefits = content.benefits.map(item => `<li style="margin:0 0 10px">${escapeHtml(item)}</li>`).join("");
  return `<!doctype html>
  <html lang="es"><body style="margin:0;background:#f3f4f5;font-family:Arial,sans-serif;color:#111">
    <div style="max-width:640px;margin:0 auto;padding:34px 18px">
      <div style="background:#050505;border-radius:28px 28px 0 0;padding:32px;color:#fff">
        <div style="font-size:24px;letter-spacing:.3em">ROIS</div>
        <p style="margin:24px 0 0;color:#aeb5bd;font-size:12px;letter-spacing:.16em;text-transform:uppercase">Invitación privada</p>
      </div>
      <div style="background:#fff;border:1px solid #e2e4e7;border-top:0;border-radius:0 0 28px 28px;padding:34px">
        <p style="margin:0 0 12px;color:#69727e">Hola, ${escapeHtml(prospect.name || "talento ROIS")}.</p>
        <h1 style="font-size:30px;line-height:1.12;margin:0 0 18px">${escapeHtml(content.title)}</h1>
        <p style="font-size:16px;line-height:1.7;color:#3f4752;margin:0 0 22px">${escapeHtml(content.description)}</p>
        <ul style="padding-left:20px;margin:0 0 28px;color:#3f4752;font-size:15px;line-height:1.6">${benefits}</ul>
        <a href="${escapeHtml(url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:15px 24px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Crear cuenta ${escapeHtml(content.account)}</a>
        <p style="margin:28px 0 0;color:#87909a;font-size:12px;line-height:1.6">El registro está sujeto a las condiciones y revisión de ROIS. Este enlace fue generado para el correo destinatario.</p>
      </div>
    </div>
  </body></html>`;
}

Deno.serve(async request => {
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
  if (!resendApiKey) return json({ error: "RESEND_API_KEY is not configured" }, 503);
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
    if (profileError || !["admin", "commercial"].includes(String(profile?.role)) || profile?.status !== "approved") {
      return json({ error: "Commercial or admin access required" }, 403);
    }

    const payload = await request.json();
    const prospectId = String(payload?.prospectId || "").trim();
    if (!prospectId) return json({ error: "prospectId is required" }, 400);

    const { data, error } = await service
      .from("crm")
      .select("id,name,email,prospect_type,organization,scout_code,invitation_attempts")
      .eq("id", prospectId)
      .maybeSingle();
    if (error || !data) return json({ error: "CRM prospect not found" }, 404);
    const prospect = data as Prospect;
    if (!["company", "creator", "athlete"].includes(prospect.prospect_type)) return json({ error: "Invalid prospect type" }, 422);
    if (!prospect.email) return json({ error: "Prospect email is required" }, 422);
    if (prospect.prospect_type !== "company" && !prospect.scout_code) {
      return json({ error: "A Scout code is required for creator and athlete invitations" }, 422);
    }

    const attempts = Number(prospect.invitation_attempts || 0) + 1;
    await service.from("crm").update({
      invitation_status: "sending",
      invitation_attempts: attempts,
      invitation_error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", prospect.id);

    try {
      const content = invitationContent(prospect);
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `rois-crm-${prospect.id}-${attempts}`,
        },
        body: JSON.stringify({
          from: emailFrom,
          to: [prospect.email],
          subject: `ROIS | ${content.title}`,
          html: emailMarkup(prospect, appUrl),
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const sentAt = new Date().toISOString();
      const { data: updated, error: updateError } = await service
        .from("crm")
        .update({
          status: "Invitado",
          invitation_status: "sent",
          invitation_sent_at: sentAt,
          invitation_error: null,
          last_contact_at: sentAt,
          updated_at: sentAt,
        })
        .eq("id", prospect.id)
        .select()
        .single();
      if (updateError) throw updateError;
      return json({ sent: true, prospect: updated });
    } catch (emailError) {
      const message = emailError instanceof Error ? emailError.message.slice(0, 1000) : "Email provider error";
      await service.from("crm").update({
        invitation_status: "email_error",
        invitation_error: message,
        updated_at: new Date().toISOString(),
      }).eq("id", prospect.id);
      return json({ error: message }, 502);
    }
  } catch (error) {
    console.error("[ROIS CRM invitation]", error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
