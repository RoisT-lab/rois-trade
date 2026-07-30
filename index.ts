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
  created_by: string | null;
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
      title: "Construye la presencia comercial de tu empresa en ROIS",
      description: "Tu empresa fue invitada a crear un perfil corporativo y utilizar ROIS como canal de distribucion, atraccion de perfiles y generacion de oportunidades. Tendras cinco meses de acceso avanzado incluidos para configurar tu operacion y comprobar el valor de la red.",
      benefits: [
        "Presenta capacidades, sectores, territorios y objetivos en un perfil empresarial estructurado.",
        "Publica oportunidades y misiones para activar usuarios con perfiles compatibles.",
        "Recibe postulaciones, organiza seguimiento y valida resultados desde tu dashboard.",
        "Explora perfiles, eventos e inteligencia agregada para tomar mejores decisiones.",
        "Sin tarjeta, cobro inicial ni renovacion automatica durante el periodo incluido.",
      ],
      offer: "5 meses para construir y validar tu canal ROIS",
      offerDetail: "El acceso avanzado comienza cuando creas la cuenta empresarial con este mismo correo.",
      cta: "Construir perfil empresarial",
      subject: "Activa el perfil y la red comercial de tu empresa",
    };
  }
  if (prospect.prospect_type === "creator") {
    return {
      account: "creador",
      title: "Tu perfil creativo fue invitado a ROIS",
      description: "Crea tu perfil para presentar tu audiencia, contenido, resultados y beneficios a marcas mediante un Sponsor Deck ROIS.",
      benefits: [
        "Construye una propuesta comercial clara para marcas.",
        "Accede a oportunidades de contenido, embajadurias y patrocinio.",
        "Activa tu red Scout y da seguimiento a tus referidos.",
      ],
      offer: "",
      offerDetail: "",
      cta: "Crear cuenta creador",
      subject: "Tu perfil creativo fue invitado a ROIS",
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
    offer: "",
    offerDetail: "",
    cta: "Crear cuenta deportista",
    subject: "Tu perfil deportivo fue invitado a ROIS",
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
  const logoUrl = new URL("/assets/rois-logo.png", appUrl).toString();
  const benefits = content.benefits.map(item => `<li style="margin:0 0 10px">${escapeHtml(item)}</li>`).join("");
  const offer = content.offer
    ? `<div style="margin:0 0 24px;padding:18px 20px;border-radius:18px;background:#f1f3f5">
        <strong style="display:block;font-size:17px">${escapeHtml(content.offer)}</strong>
        <span style="display:block;margin-top:6px;color:#69727e;font-size:13px">${escapeHtml(content.offerDetail)}</span>
      </div>`
    : "";
  const companyPath = prospect.prospect_type === "company"
    ? `<div style="margin:0 0 28px;padding:0;border-top:1px solid #e2e4e7">
        <p style="margin:22px 0 14px;color:#111;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase">Tu activacion en tres pasos</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
          <tr>
            <td width="34" valign="top" style="padding:0 0 14px;color:#111;font-size:13px;font-weight:700">01</td>
            <td valign="top" style="padding:0 0 14px;color:#3f4752;font-size:14px;line-height:1.55">Completa el perfil y los objetivos comerciales de tu empresa.</td>
          </tr>
          <tr>
            <td width="34" valign="top" style="padding:0 0 14px;color:#111;font-size:13px;font-weight:700">02</td>
            <td valign="top" style="padding:0 0 14px;color:#3f4752;font-size:14px;line-height:1.55">Configura una oportunidad o mision para la red ROIS.</td>
          </tr>
          <tr>
            <td width="34" valign="top" style="padding:0;color:#111;font-size:13px;font-weight:700">03</td>
            <td valign="top" style="padding:0;color:#3f4752;font-size:14px;line-height:1.55">ROIS revisa la publicacion y tu equipo comienza a recibir actividad medible.</td>
          </tr>
        </table>
      </div>`
    : "";
  return `<!doctype html>
  <html lang="es"><body style="margin:0;background:#f3f4f5;font-family:Arial,sans-serif;color:#111">
    <div style="max-width:640px;margin:0 auto;padding:34px 18px">
      <div style="background:#050505;border-radius:28px 28px 0 0;padding:32px;color:#fff">
        <img src="${escapeHtml(logoUrl)}" width="176" alt="ROIS" style="display:block;width:176px;max-width:54%;height:auto;border:0;color:#fff;font-size:24px;font-weight:700;letter-spacing:.3em">
        <p style="margin:26px 0 0;color:#aeb5bd;font-size:12px;letter-spacing:.16em;text-transform:uppercase">Invitacion empresarial</p>
      </div>
      <div style="background:#fff;border:1px solid #e2e4e7;border-top:0;border-radius:0 0 28px 28px;padding:34px">
        <p style="margin:0 0 12px;color:#69727e">Hola, ${escapeHtml(prospect.name || "equipo")}.</p>
        <h1 style="font-size:30px;line-height:1.12;margin:0 0 18px">${escapeHtml(content.title)}</h1>
        <p style="font-size:16px;line-height:1.7;color:#3f4752;margin:0 0 22px">${escapeHtml(content.description)}</p>
        ${offer}
        <ul style="padding-left:20px;margin:0 0 28px;color:#3f4752;font-size:15px;line-height:1.6">${benefits}</ul>
        ${companyPath}
        <a href="${escapeHtml(url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:16px 25px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.11em;text-transform:uppercase">${escapeHtml(content.cta)}</a>
        <p style="margin:28px 0 0;color:#87909a;font-size:12px;line-height:1.6">La cuenta y sus publicaciones estan sujetas a las condiciones y revision de ROIS. Esta invitacion fue generada exclusivamente para el correo destinatario.</p>
      </div>
    </div>
  </body></html>`;
}

async function prepareCompanyAccessGrant(
  service: ReturnType<typeof createClient>,
  prospect: Prospect,
  invitedBy: string,
) {
  const email = String(prospect.email || "").trim().toLowerCase();
  const { data: existing, error: lookupError } = await service
    .from("company_access_grants")
    .select("*")
    .eq("email", email)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing?.status === "redeemed") return existing;

  const record = {
    email,
    grant_type: "advanced_5_months",
    status: "pending",
    access_months: 5,
    source_crm_id: prospect.id,
    invited_by: invitedBy,
    offer_expires_at: null,
    metadata: { source: "commercial_invitation", auto_renew: false },
    updated_at: new Date().toISOString(),
  };
  const operation = existing
    ? service.from("company_access_grants").update(record).eq("id", existing.id)
    : service.from("company_access_grants").insert(record);
  const { data: grant, error: grantError } = await operation.select().single();
  if (grantError) throw grantError;

  const { error: redeemError } = await service.rpc("rois_redeem_company_access_grant", {
    p_email: email,
  });
  if (redeemError) throw redeemError;
  const { data: resolvedGrant, error: resolvedGrantError } = await service
    .from("company_access_grants")
    .select("*")
    .eq("id", grant.id)
    .single();
  if (resolvedGrantError) throw resolvedGrantError;
  return resolvedGrant;
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
      .select("id,email,role,status")
      .or(profileLookup)
      .maybeSingle();
    if (profileError || !["admin", "scout", "commercial"].includes(String(profile?.role)) || profile?.status !== "approved") {
      return json({ error: "Commercial, Scout or admin access required" }, 403);
    }

    const payload = await request.json();
    const prospectId = String(payload?.prospectId || "").trim();
    if (!prospectId) return json({ error: "prospectId is required" }, 400);
    const { data, error } = await service
      .from("crm")
      .select("id,name,email,prospect_type,organization,scout_code,invitation_attempts,created_by")
      .eq("id", prospectId)
      .maybeSingle();
    if (error || !data) return json({ error: "CRM prospect not found" }, 404);
    const prospect = data as Prospect;
    if (!["company", "creator", "athlete"].includes(prospect.prospect_type)) return json({ error: "Invalid prospect type" }, 422);
    if (!prospect.email) return json({ error: "Prospect email is required" }, 422);
    if (prospect.prospect_type !== "company" && !prospect.scout_code) {
      return json({ error: "A Scout code is required for creator and athlete invitations" }, 422);
    }

    if (String(profile.role) === "scout") {
      if (prospect.prospect_type === "company") return json({ error: "Scout accounts cannot invite companies" }, 403);
      if (prospect.created_by !== userData.user.id) return json({ error: "This referral does not belong to the authenticated Scout" }, 403);
      const { data: scout, error: scoutError } = await service
        .from("scouts")
        .select("scout_code,status")
        .or(`profile_id.eq.${profile.id},email.eq.${userEmail}`)
        .maybeSingle();
      const normalizeCode = (value: string | null | undefined) =>
        String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (scoutError || scout?.status !== "approved" || !normalizeCode(scout?.scout_code)) {
        return json({ error: "The Scout account is not active" }, 403);
      }
      if (normalizeCode(prospect.scout_code) !== normalizeCode(scout.scout_code)) {
        return json({ error: "The referral must use the authenticated Scout code" }, 403);
      }
    }

    const attempts = Number(prospect.invitation_attempts || 0) + 1;
    await service.from("crm").update({
      invitation_status: "sending",
      invitation_attempts: attempts,
      invitation_error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", prospect.id);

    try {
      const accessGrant = prospect.prospect_type === "company"
        ? await prepareCompanyAccessGrant(service, prospect, userData.user.id)
        : null;
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
          subject: `ROIS | ${content.subject}`,
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
      return json({ sent: true, prospect: updated, companyAccessGrant: accessGrant });
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
