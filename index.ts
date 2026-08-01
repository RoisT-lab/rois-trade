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
  country: string | null;
  preferred_language: string | null;
  advanced_access_months: number | null;
};

type InvitationLanguage = "es" | "en" | "pt";

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

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    const message = candidate.message || candidate.error_description || candidate.error;
    if (message) return String(message);
    try {
      return JSON.stringify(candidate);
    } catch {
      return "Unknown provider error";
    }
  }
  return "Unknown provider error";
}

function normalized(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function invitationLanguage(prospect: Prospect): InvitationLanguage {
  const selected = normalized(prospect.preferred_language);
  if (["es", "spanish", "espanol"].includes(selected)) return "es";
  if (["en", "english", "ingles"].includes(selected)) return "en";
  if (["pt", "portuguese", "portugues"].includes(selected)) return "pt";
  const country = normalized(prospect.country);
  if (["brasil", "brazil", "portugal", "angola", "mozambique"].some(item => country.includes(item))) return "pt";
  if (["united states", "usa", "canada", "united kingdom", "uk", "australia", "ireland", "new zealand", "singapore"].some(item => country.includes(item))) return "en";
  return "es";
}

function invitationContent(prospect: Prospect) {
  const language = invitationLanguage(prospect);
  const hasAdvancedAccess = Number(prospect.advanced_access_months || 0) > 0;
  const copy = {
    es: {
      invitation: "Invitación privada ROIS",
      greeting: "Hola",
      stepsTitle: "Activa tu cuenta en tres pasos",
      steps: ["Crea tu cuenta con este mismo correo.", "Completa tu perfil, capacidades y objetivos.", "Explora herramientas y oportunidades desde tu dashboard."],
      legal: "La cuenta y sus publicaciones están sujetas a las condiciones y revisión de ROIS. Esta invitación fue generada exclusivamente para el correo destinatario.",
      company: {
        personalMessage: "Quise escribirte personalmente porque considero que tu empresa puede encontrar en ROIS una forma práctica de conectar con talento, activar oportunidades y construir nuevas relaciones comerciales.",
        title: "Convierte la red ROIS en un canal de crecimiento para tu empresa",
        description: "Crea un perfil corporativo, publica oportunidades y activa personas compatibles para generar distribución, demanda y resultados medibles.",
        benefits: ["Publica oportunidades, campañas y misiones comerciales.", "Recibe postulaciones y organiza su seguimiento desde un solo lugar.", "Activa códigos Scout globales para atribuir resultados y comisiones.", "Explora deportistas, creadores, eventos e inteligencia agregada.", "Mide actividad, conversiones y rendimiento de cada iniciativa."],
        cta: "Construir perfil empresarial",
        subject: "Una invitación personal para construir nuevas oportunidades",
      },
      creator: {
        personalMessage: "Quise escribirte personalmente porque veo valor en lo que estás construyendo y creo que tu perfil puede generar colaboraciones relevantes con marcas y con otros miembros de la comunidad ROIS.",
        title: "Haz que tu perfil, contenido y comunidad también generen oportunidades",
        description: "ROIS reúne tu propuesta comercial en un perfil preparado para empresas y te conecta con nuevas formas de monetizar tu capacidad creativa.",
        benefits: ["Construye tu Sponsor Deck ROIS con beneficios claros para marcas.", "Accede a oportunidades de contenido, embajadurías, campañas y patrocinio.", "Participa en Impulso Creativo y cotiza colaboraciones pagadas con otros perfiles.", "Publica evidencia, resultados, redes y activos comerciales en un solo perfil.", "Consulta oportunidades empresariales y registra resultados desde tu dashboard."],
        cta: "Crear mi perfil ROIS",
        subject: "Una invitación personal para impulsar tu perfil creativo",
      },
      athlete: {
        personalMessage: "Quise escribirte personalmente porque tu trayectoria merece una estructura comercial que ayude a las empresas a entender tu valor, tus objetivos y las oportunidades que pueden construir contigo.",
        title: "Convierte tu trayectoria deportiva en una propuesta clara para marcas",
        description: "ROIS te ayuda a presentar resultados, calendario, evidencia y activos comerciales para acceder a oportunidades y relaciones de patrocinio.",
        benefits: ["Construye tu Sponsor Deck ROIS para evaluación empresarial.", "Publica evidencia competitiva, fotografías, reels, resultados y calendario.", "Activa tu perfil en el Mercado de fichajes y recibe solicitudes desde ROIS.", "Accede a oportunidades empresariales y colaboraciones de Impulso Creativo.", "Organiza beneficios, ventajas y entregables para potenciales patrocinadores."],
        cta: "Crear mi perfil deportivo",
        subject: "Una invitación personal para impulsar tu trayectoria deportiva",
      },
      offer: "5 meses de acceso avanzado incluidos",
      offerDetail: "Sin tarjeta, cobro inicial ni renovación automática. El beneficio se habilita al crear y validar tu cuenta con este mismo correo.",
      closing: "Me dará mucho gusto darte la bienvenida y conocer lo que podemos construir juntos dentro de ROIS.",
      signoff: "Un abrazo,",
      founderRole: "Fundador de ROIS",
    },
    en: {
      invitation: "Private ROIS invitation",
      greeting: "Hello",
      stepsTitle: "Activate your account in three steps",
      steps: ["Create your account using this email address.", "Complete your profile, capabilities and goals.", "Explore tools and opportunities from your dashboard."],
      legal: "Accounts and publications are subject to ROIS terms and review. This invitation was created exclusively for the recipient email address.",
      company: {
        personalMessage: "I wanted to write to you personally because I believe your company can use ROIS as a practical way to connect with talent, activate opportunities and build new commercial relationships.",
        title: "Turn the ROIS network into a growth channel for your company",
        description: "Build a corporate profile, publish opportunities and activate compatible people to generate distribution, demand and measurable results.",
        benefits: ["Publish opportunities, campaigns and commercial missions.", "Receive applications and manage follow-up in one place.", "Activate global Scout codes to attribute results and commissions.", "Explore athletes, creators, events and aggregated intelligence.", "Measure activity, conversions and performance for every initiative."],
        cta: "Build company profile",
        subject: "A personal invitation to build new opportunities",
      },
      creator: {
        personalMessage: "I wanted to write to you personally because I see value in what you are building, and I believe your profile can create meaningful collaborations with brands and other members of the ROIS community.",
        title: "Turn your profile, content and community into new opportunities",
        description: "ROIS brings your commercial value into one company-ready profile and connects you with new ways to monetize your creative capabilities.",
        benefits: ["Build a ROIS Sponsor Deck with clear brand benefits.", "Access content, ambassador, campaign and sponsorship opportunities.", "Join Creative Boost and price paid collaborations with other profiles.", "Show evidence, results, social channels and commercial assets in one profile.", "Explore company opportunities and register results from your dashboard."],
        cta: "Create my ROIS profile",
        subject: "A personal invitation to grow your creator profile",
      },
      athlete: {
        personalMessage: "I wanted to write to you personally because your journey deserves a commercial structure that helps companies understand your value, your goals and the opportunities they can build with you.",
        title: "Turn your athletic journey into a clear proposal for brands",
        description: "ROIS helps you present results, calendar, evidence and commercial assets to access opportunities and sponsorship relationships.",
        benefits: ["Build your ROIS Sponsor Deck for company evaluation.", "Publish competitive evidence, photos, reels, results and calendar.", "Activate your profile in the athlete marketplace and receive requests through ROIS.", "Access company opportunities and Creative Boost collaborations.", "Organize benefits, advantages and deliverables for potential sponsors."],
        cta: "Create my athlete profile",
        subject: "A personal invitation to advance your athletic journey",
      },
      offer: "5 months of advanced access included",
      offerDetail: "No card, upfront payment or automatic renewal. Access is enabled after creating and validating your account with this email.",
      closing: "I would be delighted to welcome you and learn what we can build together through ROIS.",
      signoff: "Warm regards,",
      founderRole: "Founder of ROIS",
    },
    pt: {
      invitation: "Convite privado ROIS",
      greeting: "Olá",
      stepsTitle: "Ative sua conta em três etapas",
      steps: ["Crie sua conta com este mesmo e-mail.", "Complete seu perfil, capacidades e objetivos.", "Explore ferramentas e oportunidades no seu painel."],
      legal: "A conta e suas publicações estão sujeitas aos termos e à revisão da ROIS. Este convite foi gerado exclusivamente para o e-mail destinatário.",
      company: {
        personalMessage: "Quis escrever pessoalmente porque acredito que sua empresa pode encontrar na ROIS uma forma prática de se conectar com talentos, ativar oportunidades e construir novas relações comerciais.",
        title: "Transforme a rede ROIS em um canal de crescimento para sua empresa",
        description: "Crie um perfil corporativo, publique oportunidades e ative pessoas compatíveis para gerar distribuição, demanda e resultados mensuráveis.",
        benefits: ["Publique oportunidades, campanhas e missões comerciais.", "Receba candidaturas e organize o acompanhamento em um só lugar.", "Ative códigos Scout globais para atribuir resultados e comissões.", "Explore atletas, criadores, eventos e inteligência agregada.", "Meça atividade, conversões e desempenho de cada iniciativa."],
        cta: "Criar perfil empresarial",
        subject: "Um convite pessoal para construir novas oportunidades",
      },
      creator: {
        personalMessage: "Quis escrever pessoalmente porque vejo valor no que você está construindo e acredito que seu perfil pode gerar colaborações relevantes com marcas e outros membros da comunidade ROIS.",
        title: "Faça seu perfil, conteúdo e comunidade gerarem novas oportunidades",
        description: "A ROIS reúne seu valor comercial em um perfil preparado para empresas e conecta você a novas formas de monetizar sua capacidade criativa.",
        benefits: ["Crie seu Sponsor Deck ROIS com benefícios claros para marcas.", "Acesse oportunidades de conteúdo, embaixadoria, campanhas e patrocínio.", "Participe do Impulso Criativo e precifique colaborações pagas.", "Publique evidências, resultados, redes e ativos comerciais em um único perfil.", "Consulte oportunidades empresariais e registre resultados no painel."],
        cta: "Criar meu perfil ROIS",
        subject: "Um convite pessoal para impulsionar seu perfil criativo",
      },
      athlete: {
        personalMessage: "Quis escrever pessoalmente porque sua trajetória merece uma estrutura comercial que ajude as empresas a entender seu valor, seus objetivos e as oportunidades que podem construir com você.",
        title: "Transforme sua trajetória esportiva em uma proposta clara para marcas",
        description: "A ROIS ajuda você a apresentar resultados, calendário, evidências e ativos comerciais para acessar oportunidades e patrocínios.",
        benefits: ["Crie seu Sponsor Deck ROIS para avaliação empresarial.", "Publique evidências competitivas, fotos, reels, resultados e calendário.", "Ative seu perfil no mercado de atletas e receba solicitações pela ROIS.", "Acesse oportunidades empresariais e colaborações do Impulso Criativo.", "Organize benefícios, vantagens e entregas para potenciais patrocinadores."],
        cta: "Criar meu perfil esportivo",
        subject: "Um convite pessoal para impulsionar sua trajetória esportiva",
      },
      offer: "5 meses de acesso avançado incluídos",
      offerDetail: "Sem cartão, pagamento inicial ou renovação automática. O benefício é ativado após criar e validar sua conta com este e-mail.",
      closing: "Será um prazer receber você e conhecer o que podemos construir juntos dentro da ROIS.",
      signoff: "Um abraço,",
      founderRole: "Fundador da ROIS",
    },
  }[language];
  const account = copy[prospect.prospect_type];
  const standardSubjects = {
    es: {
      creator: "Una invitación personal para impulsar tu perfil creativo",
      athlete: "Una invitación personal para impulsar tu trayectoria deportiva",
    },
    en: {
      creator: "A personal invitation to grow your creator profile",
      athlete: "A personal invitation to advance your athletic journey",
    },
    pt: {
      creator: "Um convite pessoal para impulsionar seu perfil criativo",
      athlete: "Um convite pessoal para impulsionar sua trajetória esportiva",
    },
  } as const;
  const subject = !hasAdvancedAccess && prospect.prospect_type !== "company"
    ? standardSubjects[language][prospect.prospect_type]
    : account.subject;
  return {
    language,
    ...copy,
    ...account,
    subject,
    offer: hasAdvancedAccess ? copy.offer : "",
    offerDetail: hasAdvancedAccess ? copy.offerDetail : "",
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
  const activationPath = `<div style="margin:0 0 28px;padding:0;border-top:1px solid #e2e4e7">
        <p style="margin:22px 0 14px;color:#111;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase">${escapeHtml(content.stepsTitle)}</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
          <tr>
            <td width="34" valign="top" style="padding:0 0 14px;color:#111;font-size:13px;font-weight:700">01</td>
            <td valign="top" style="padding:0 0 14px;color:#3f4752;font-size:14px;line-height:1.55">${escapeHtml(content.steps[0])}</td>
          </tr>
          <tr>
            <td width="34" valign="top" style="padding:0 0 14px;color:#111;font-size:13px;font-weight:700">02</td>
            <td valign="top" style="padding:0 0 14px;color:#3f4752;font-size:14px;line-height:1.55">${escapeHtml(content.steps[1])}</td>
          </tr>
          <tr>
            <td width="34" valign="top" style="padding:0;color:#111;font-size:13px;font-weight:700">03</td>
            <td valign="top" style="padding:0;color:#3f4752;font-size:14px;line-height:1.55">${escapeHtml(content.steps[2])}</td>
          </tr>
        </table>
      </div>`;
  return `<!doctype html>
  <html lang="${content.language}"><body style="margin:0;background:#f3f4f5;font-family:Arial,sans-serif;color:#111">
    <div style="max-width:640px;margin:0 auto;padding:34px 18px">
      <div style="background:#050505;border-radius:28px 28px 0 0;padding:32px;color:#fff">
        <img src="${escapeHtml(logoUrl)}" width="176" alt="ROIS" style="display:block;width:176px;max-width:54%;height:auto;border:0;color:#fff;font-size:24px;font-weight:700;letter-spacing:.3em">
        <p style="margin:26px 0 0;color:#aeb5bd;font-size:12px;letter-spacing:.16em;text-transform:uppercase">${escapeHtml(content.invitation)}</p>
      </div>
      <div style="background:#fff;border:1px solid #e2e4e7;border-top:0;border-radius:0 0 28px 28px;padding:34px">
        <p style="margin:0 0 12px;color:#69727e">${escapeHtml(content.greeting)}, ${escapeHtml(prospect.name || "ROIS")}.</p>
        <p style="font-size:16px;line-height:1.7;color:#3f4752;margin:0 0 26px">${escapeHtml(content.personalMessage)}</p>
        <h1 style="font-size:30px;line-height:1.12;margin:0 0 18px">${escapeHtml(content.title)}</h1>
        <p style="font-size:16px;line-height:1.7;color:#3f4752;margin:0 0 22px">${escapeHtml(content.description)}</p>
        ${offer}
        <ul style="padding-left:20px;margin:0 0 28px;color:#3f4752;font-size:15px;line-height:1.6">${benefits}</ul>
        ${activationPath}
        <a href="${escapeHtml(url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:16px 25px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.11em;text-transform:uppercase">${escapeHtml(content.cta)}</a>
        <div style="margin:30px 0 0;padding-top:24px;border-top:1px solid #e2e4e7">
          <p style="margin:0 0 22px;color:#3f4752;font-size:15px;line-height:1.7">${escapeHtml(content.closing)}</p>
          <p style="margin:0 0 5px;color:#69727e;font-size:14px">${escapeHtml(content.signoff)}</p>
          <strong style="display:block;color:#111;font-size:16px">Jafet Said Lira Reyes</strong>
          <span style="display:block;margin-top:4px;color:#69727e;font-size:13px">${escapeHtml(content.founderRole)}</span>
        </div>
        <p style="margin:28px 0 0;color:#87909a;font-size:12px;line-height:1.6">${escapeHtml(content.legal)}</p>
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
      .select("id,name,email,prospect_type,organization,scout_code,invitation_attempts,created_by,country,preferred_language,advanced_access_months")
      .eq("id", prospectId)
      .maybeSingle();
    if (error || !data) return json({ error: "CRM prospect not found" }, 404);
    const prospect = data as Prospect;
    if (!["company", "creator", "athlete"].includes(prospect.prospect_type)) return json({ error: "Invalid prospect type" }, 422);
    if (!prospect.email) return json({ error: "Prospect email is required" }, 422);
    if (String(profile.role) === "scout") {
      if (prospect.prospect_type === "company") return json({ error: "Scout accounts cannot invite companies" }, 403);
      if (prospect.created_by !== userData.user.id) return json({ error: "This referral does not belong to the authenticated Scout" }, 403);
      if (!prospect.scout_code) return json({ error: "A Scout code is required for Scout referrals" }, 422);
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
      let accessGrant = null;
      if (prospect.prospect_type === "company") {
        try {
          accessGrant = await prepareCompanyAccessGrant(service, prospect, userData.user.id);
        } catch (grantError) {
          console.error("[ROIS company access grant]", grantError);
          throw new Error(`No fue posible preparar el acceso empresarial: ${errorMessage(grantError)}`);
        }
      } else if (Number(prospect.advanced_access_months || 0) > 0) {
        const { data: redeemedAccess, error: redeemAccessError } = await service.rpc("rois_redeem_talent_access_grant", {
          p_email: String(prospect.email || "").trim().toLowerCase(),
        });
        if (redeemAccessError) {
          console.error("[ROIS talent promotional access]", redeemAccessError);
        } else {
          accessGrant = { accessMonths: prospect.advanced_access_months, redeemedRecords: redeemedAccess };
        }
      }
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
      if (!response.ok) {
        const providerText = await response.text();
        let providerMessage = providerText;
        try {
          const providerBody = JSON.parse(providerText);
          providerMessage = providerBody?.message || providerBody?.error || providerText;
        } catch {
          // Resend can occasionally return plain text instead of JSON.
        }
        throw new Error(`Resend rechazo el correo (${response.status}): ${providerMessage}`);
      }
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
      if (updateError) {
        throw new Error(`El correo se envio, pero el CRM no pudo actualizarse: ${errorMessage(updateError)}`);
      }
      return json({ sent: true, prospect: updated, accessGrant });
    } catch (emailError) {
      const message = errorMessage(emailError).slice(0, 1000);
      console.error("[ROIS CRM invitation delivery]", emailError);
      await service.from("crm").update({
        invitation_status: "email_error",
        invitation_error: message,
        updated_at: new Date().toISOString(),
      }).eq("id", prospect.id);
      return json({ error: message }, 502);
    }
  } catch (error) {
    console.error("[ROIS CRM invitation]", error);
    return json({ error: errorMessage(error) }, 500);
  }
});
