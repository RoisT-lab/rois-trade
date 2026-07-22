const config = window.ROIS_CONFIG || {};
const roisBuild = "20260630-entrepreneur-speed-v77";
const roisLegalEntity = "IntelliQuant S.A.P.I. de C.V.";
const athleteAnnualExemptEmails = [];
const athleteAnnualFeeAmount = 2500;
const scoutCommissionAmount = 500;
const demoMode = config.demoMode !== false || !config.supabaseUrl || !config.supabaseAnonKey;
const storeKey = "rois_demo_data_v2";
const sessionKey = "rois_session_v2";
const configuredDemoAdmin = config.demoAdminEmail && config.demoAdminPassword;
const adminEmail = (config.adminEmail || config.demoAdminEmail || "").toLowerCase();
const fixedLogoPath = config.logoDataUrl || "./assets/rois-logo.png";
const dataCacheKey = "rois_runtime_data_cache_v2";
const dashboardFreshnessMs = 15000;
const profileMediaBucket = "profile-media";
const companyMediaBucket = "company-media";
const operationTimeoutMs = 15000;
const profileImageFallback = "./assets/rois-logo.png";
const runtimeCacheRowsPerTable = 120;
const sponsorDeckFunctionName = "generate-sponsor-deck";
const roisIAEnabled = config.roisIAEnabled === true;

const state = {
  session: readSession(),
  pendingSession: null,
  registrationType: null,
  data: null
};

let coverCarouselTimers = [];
const coverCacheKey = "rois_cover_cache_v1";
let adminDataHydrated = false;
let dashboardHydrationPromise = null;
let dashboardHydrationRole = null;
const hydratedRoles = new Set();
const lastHydratedAtByRole = new Map();
const dashboardPanelLoads = new Map();
const dashboardPanelPromises = new Map();
const dashboardPanelPageSizes = { client: 24, admin: 75 };
const dashboardPanelFreshnessMs = 30000;
let adminGrowthSnapshot = null;
let adminGrowthSnapshotPromise = null;
let adminGrowthSnapshotLoadedAt = 0;

const companyPlanCatalog = {
  free: {
    key: "free",
    name: "Explorador",
    price: 0,
    listingLimit: 0,
    eventLimitMonthly: 0,
    seatsLimit: 1,
    features: []
  },
  pro: {
    key: "pro",
    name: "PRO",
    price: 2500,
    listingLimit: 25,
    eventLimitMonthly: 2,
    seatsLimit: 1,
    features: ["publish_listings", "publish_events"]
  },
  business: {
    key: "business",
    name: "Business",
    price: 7500,
    listingLimit: 100,
    eventLimitMonthly: 10,
    seatsLimit: 5,
    features: ["publish_listings", "publish_events", "featured_listings", "team_seats"]
  }
};

const creatorTypeCatalog = {
  artist: "Artista",
  influencer: "Influencer",
  musician: "Musico / Musica",
  actor: "Actor / Actriz",
  model: "Modelo",
  streamer: "Streamer / Gamer",
  communicator: "Comunicador / Host",
  founder: "Founder / Emprendedor",
  other: "Otro creador"
};

function creatorTypeLabel(value = "founder") {
  return creatorTypeCatalog[String(value || "founder").toLowerCase()] || creatorTypeCatalog.other;
}

function creatorTypeOptionsMarkup(selected = "founder") {
  return Object.entries(creatorTypeCatalog)
    .map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`)
    .join("");
}

function creatorAudienceLabel(profile = {}) {
  const audience = Number(profile.audience_size || 0);
  if (!audience) return "Por documentar";
  return new Intl.NumberFormat("es-MX", { notation: audience >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(audience);
}

function creatorEngagementLabel(profile = {}) {
  const engagement = Number(profile.engagement_rate || 0);
  return engagement > 0 ? `${engagement.toLocaleString("es-MX", { maximumFractionDigits: 2 })}%` : "Por documentar";
}

const seed = {
  profiles: configuredDemoAdmin ? [
    { id: "u-admin", email: config.demoAdminEmail, password: config.demoAdminPassword, role: "admin", name: "Administrador ROIS", status: "approved", mustChangePassword: true }
  ] : [],
  companies: [],
  athletes: [],
  founders: [],
  events: [],
  requests: [],
  sponsorships: [],
  news: [],
  partnerships: [],
  site_settings: [],
  crm: [],
  payments: [],
  uploads: [],
  athlete_posts: [],
  athlete_results: [],
  athlete_expenses: [],
  athlete_deposits: [],
  athlete_notifications: [],
  terms_acceptances: [],
  company_subscriptions: [],
  company_listings: [],
  company_listing_media: [],
  marketplace_leads: []
};

const api = withCachedLoadAll(demoMode ? demoApi() : supabaseApi());

init();

function normalizeLoadedData(data = {}) {
  const base = structuredClone(seed);
  return Object.keys(base).reduce((acc, key) => {
    acc[key] = Array.isArray(data[key]) ? data[key] : base[key];
    return acc;
  }, { ...base, ...data });
}

function dataCacheStorageKey(session = state.session) {
  const role = String(session?.role || "public").toLowerCase();
  const email = String(session?.email || "anonymous").trim().toLowerCase();
  return `${dataCacheKey}:${role}:${email}`;
}

function readDataCache(session = state.session) {
  try {
    const cached = sessionStorage.getItem(dataCacheStorageKey(session));
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    return normalizeLoadedData(parsed?.data || parsed);
  } catch (error) {
    return null;
  }
}

function writeDataCache(data, session = state.session) {
  try {
    sessionStorage.setItem(dataCacheStorageKey(session), JSON.stringify({
      savedAt: Date.now(),
      data: cacheSafeData(data)
    }));
  } catch (error) {
    // Large media payloads can exceed browser storage. The app should keep working without cache.
  }
}

function cacheSafeRecord(record = {}) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => {
    if (typeof value === "string" && value.startsWith("data:")) return [key, ""];
    if (key === "sponsor_logos" && typeof value === "string" && value.includes("data:image")) return [key, ""];
    return [key, value];
  }));
}

function cacheSafeData(data) {
  const normalized = normalizeLoadedData(data);
  const safe = Object.fromEntries(Object.entries(normalized).map(([key, rows]) => [
    key,
    Array.isArray(rows) ? rows.slice(0, runtimeCacheRowsPerTable).map(cacheSafeRecord) : rows
  ]));
  return {
    ...safe,
    site_settings: (normalized.site_settings || []).map(item => ({
      id: item.id,
      value: item.value,
      created_at: item.created_at,
      updated_at: item.updated_at
    })),
    uploads: (normalized.uploads || []).map(item => ({
      id: item.id,
      type: item.type,
      status: item.status,
      title: item.title,
      name: item.name,
      created_at: item.created_at,
      updated_at: item.updated_at
    }))
  };
}

function runtimeDataSignature(data) {
  const normalized = normalizeLoadedData(data);
  return Object.keys(seed).map(key => {
    const rows = Array.isArray(normalized[key]) ? normalized[key] : [];
    const version = rows.slice(0, 40).map(item => [
      item.id,
      item.updated_at,
      item.created_at,
      item.status,
      item.visual_status,
      item.name,
      item.title
    ].filter(Boolean).join(":")).join("|");
    return `${key}:${rows.length}:${version}`;
  }).join(";");
}

function withCachedLoadAll(sourceApi) {
  const originalLoadAll = sourceApi.loadAll.bind(sourceApi);
  return {
    ...sourceApi,
    async loadAll(options = {}) {
      try {
        const data = normalizeLoadedData(await originalLoadAll(options));
        writeDataCache(data);
        return data;
      } catch (error) {
        const fallback = state.data || readDataCache();
        if (fallback) return normalizeLoadedData(fallback);
        throw error;
      }
    }
  };
}

function normalizedRole(email, role) {
  if (role === "founder") return "founder";
  if (role === "athlete") return "athlete";
  if (role !== "admin") return "client";
  if (!demoMode) return "admin";
  return adminEmail && email?.toLowerCase() === adminEmail ? "admin" : "client";
}

function dashboardViewForRole(role) {
  return role === "admin" ? "admin" : role === "athlete" || role === "founder" ? "athlete" : "client";
}

function readSession() {
  localStorage.removeItem(sessionKey);
  return JSON.parse(sessionStorage.getItem(sessionKey) || "null");
}

function saveSession(session) {
  localStorage.removeItem(sessionKey);
  if (session) sessionStorage.setItem(sessionKey, JSON.stringify(session));
}

function clearSession() {
  sessionStorage.removeItem(sessionKey);
  localStorage.removeItem(sessionKey);
}

function authParamsFromUrl() {
  const combined = new URLSearchParams();
  [window.location.search, window.location.hash].forEach(source => {
    const normalized = String(source || "").replace(/^[#?]/, "");
    if (!normalized) return;
    const partial = new URLSearchParams(normalized);
    partial.forEach((value, key) => combined.set(key, value));
  });
  return combined;
}

async function recoverySessionFromUrl() {
  const params = authParamsFromUrl();
  const isRecovery = params.get("type") === "recovery";
  const token = params.get("access_token");
  const tokenHash = params.get("token_hash") || params.get("token");
  if (!isRecovery || (!token && !tokenHash)) return null;
  try {
    const session = token
      ? await api.recoverySession(token)
      : await api.recoverySessionFromTokenHash(tokenHash);
    history.replaceState(null, document.title, window.location.pathname);
    return session;
  } catch (error) {
    notify("Recuperaci\u00f3n", "Enlace no v\u00e1lido", "Solicita un nuevo enlace para cambiar tu contrase\u00f1a.");
    return null;
  }
}

function normalizeSession(session) {
  if (!session) return null;
  return { ...session, role: normalizedRole(session.email, session.role) };
}

function enforceCompanyClientSession() {
  if (!state.session || !state.data?.companies) return;
  const email = state.session.email?.toLowerCase();
  const isCompany = state.data.companies.some(company => (company.contact || "").toLowerCase() === email);
  if (isCompany && !["athlete", "founder"].includes(state.session.role)) {
    state.session = { ...state.session, role: "client" };
  }
}

function enforceMemberSessionRole() {
  if (!state.session || !state.data?.profiles) return;
  const email = String(state.session.email || "").trim().toLowerCase();
  const profile = state.data.profiles.find(item =>
    item.id === state.session.authId ||
    item.id === state.session.id ||
    String(item.email || "").trim().toLowerCase() === email
  );
  if (!["athlete", "founder"].includes(profile?.role)) return;
  if (state.session.role !== profile.role) {
    state.session = { ...state.session, role: profile.role };
  }
}

function currentCompany() {
  if (!state.session || !state.data?.companies) return null;
  const email = state.session.email?.toLowerCase();
  return state.data.companies.find(company => (company.contact || "").toLowerCase() === email) || null;
}

function currentCompanySubscription(company = currentCompany()) {
  if (!company) return null;
  return (state.data?.company_subscriptions || []).find(subscription => subscription.company_id === company.id) || null;
}

function companySubscriptionIsActive(subscription) {
  if (!subscription || !["active", "trialing"].includes(String(subscription.status || "").toLowerCase())) return false;
  if (!subscription.current_period_end) return true;
  return new Date(subscription.current_period_end).getTime() > Date.now();
}

function currentCompanyPlan(company = currentCompany()) {
  const subscription = currentCompanySubscription(company);
  const key = companySubscriptionIsActive(subscription) ? String(subscription.plan || "free").toLowerCase() : "free";
  return companyPlanCatalog[key] || companyPlanCatalog.free;
}

function companyCan(feature, company = currentCompany()) {
  return currentCompanyPlan(company).features.includes(feature);
}

function companyPlanLabel(company = currentCompany()) {
  const plan = currentCompanyPlan(company);
  const subscription = currentCompanySubscription(company);
  return companySubscriptionIsActive(subscription) ? plan.name : companyPlanCatalog.free.name;
}

function companyPlanCard(planKey, options = {}) {
  const plan = companyPlanCatalog[planKey] || companyPlanCatalog.free;
  const active = currentCompanyPlan().key === plan.key;
  const features = plan.key === "pro"
    ? ["25 publicaciones activas", "2 eventos mensuales", "Leads comerciales", "Revisión editorial ROIS"]
    : ["100 publicaciones activas", "10 eventos mensuales", "Hasta 5 usuarios", "Inventario destacado y analítica"];
  return `
    <article class="company-plan-card${active ? " active" : ""}">
      <div>
        <p class="eyebrow">Plan ${escapeHtml(plan.name)}</p>
        <h3>$${plan.price.toLocaleString("es-MX")} <small>MXN + IVA / mes</small></h3>
        <p>${plan.key === "business" ? "Para portafolios amplios y operación comercial continua." : "Para publicar inventario y activar oportunidades empresariales."}</p>
      </div>
      <ul>${features.map(feature => `<li>${escapeHtml(feature)}</li>`).join("")}</ul>
      ${active
        ? `<span class="pill">Plan activo</span>`
        : `<button class="btn${options.primary ? " primary" : ""}" type="button" data-company-plan-request="${plan.key}">Solicitar activación</button>`}
    </article>
  `;
}

function companyPlanGateMarkup(featureLabel) {
  return `
    <div class="company-plan-gate">
      <p class="eyebrow">Funcionalidad PRO</p>
      <h3>${escapeHtml(featureLabel)}</h3>
      <p>Activa PRO o Business para publicar inventario corporativo y eventos sujetos a revisión ROIS.</p>
      <div class="company-plan-grid">
        ${companyPlanCard("pro", { primary: true })}
        ${companyPlanCard("business")}
      </div>
      <p class="hint">La activación se confirma por administración o mediante la futura verificación de suscripción Stripe. Una solicitud no concede acceso automáticamente.</p>
    </div>
  `;
}

function sessionLogoPath() {
  return currentCompany()?.logo_url || currentFounder()?.image_url || currentAthlete()?.image_url || profileImageFallback;
}

function currentFounder() {
  if (!state.session || !state.data?.founders) return null;
  const email = String(state.session.email || "").toLowerCase();
  const sessionId = state.session.authId || state.session.id;
  const founder = state.data.founders.find(item => String(item.email || "").toLowerCase() === email)
    || state.data.founders.find(item => item.profile_id && item.profile_id === sessionId)
    || null;
  if (founder) return { ...founder, role: "founder" };
  if (state.session.role !== "founder") return null;
  return {
    id: sessionId || email || "founder-session",
    profile_id: sessionId,
    email: state.session.email,
    name: state.session.name || email.split("@")[0] || "Creador ROIS",
    venture_name: "",
    industry: "Contenido y entretenimiento",
    stage: "En desarrollo",
    city: "Por definir",
    stats: "Completa tu perfil, audiencia y propuesta comercial para activar tu ficha de creador dentro de ROIS.",
    creator_type: "founder",
    public_name: state.session.name || "",
    primary_platform: "",
    audience_size: 0,
    engagement_rate: 0,
    availability: "available",
    monthly: 2500,
    max_sponsors: 10,
    status: "approved",
    visual_status: "approved",
    scout_active: false,
    role: "founder",
    is_virtual: true
  };
}

function mergeLoadedData(nextData = {}) {
  const current = normalizeLoadedData(state.data || {});
  Object.entries(nextData).forEach(([table, rows]) => {
    current[table] = rows;
  });
  state.data = current;
  state.dataSignature = runtimeDataSignature(state.data);
  writeDataCache(state.data);
  return state.data;
}

function mergePageRecords(table, records = []) {
  if (!table || !Array.isArray(records) || !records.length) return;
  state.data = normalizeLoadedData(state.data || {});
  const current = Array.isArray(state.data[table]) ? state.data[table] : [];
  const byKey = new Map();
  const keyFor = (record, index) => {
    const email = String(record?.email || record?.contact || "").trim().toLowerCase();
    return record?.id || (record?.profile_id ? `profile:${record.profile_id}` : "") || (email ? `email:${email}` : `row:${index}`);
  };
  current.forEach((record, index) => byKey.set(keyFor(record, index), record));
  records.forEach((record, index) => {
    const key = keyFor(record, current.length + index);
    byKey.set(key, byKey.has(key) ? { ...byKey.get(key), ...record } : record);
  });
  state.data[table] = [...byKey.values()];
}

function resetDashboardPanelState() {
  dashboardPanelLoads.clear();
  dashboardPanelPromises.clear();
  adminGrowthSnapshot = null;
  adminGrowthSnapshotPromise = null;
  adminGrowthSnapshotLoadedAt = 0;
}

function markBootstrapPanelLoaded(role, data = {}) {
  if (role !== "admin") return;
  const targetId = "admin-users";
  const pageSize = dashboardPanelPageSizes.admin;
  const tables = dashboardPanelQueries(targetId).map(item => item.table);
  dashboardPanelLoads.set(targetId, {
    loaded: true,
    loading: false,
    offset: pageSize,
    hasMore: tables.some(table => (data[table] || []).length === pageSize),
    lastLoadedAt: Date.now()
  });
}

function activeDashboardPanelId(view = dashboardViewForRole(state.session?.role)) {
  return document.querySelector(`[data-dashboard="${view}"] [data-dashboard-panel].active`)?.dataset.dashboardPanel || null;
}

function dashboardPanelQueries(targetId) {
  const athleteColumns = "id,profile_id,email,contact,name,sport,category,location,ranking,stats,monthly,max_sponsors,image_url,sponsor_deck_status,sponsor_deck_score,sponsor_deck_updated_at,instagram_url,tiktok_url,facebook_url,linkedin_url,sponsor_payment_url,sponsor_terms,status,visual_status,scout_code,scout_active,invited_by_scout_code,annual_fee_required,annual_fee_paid,annual_payment_status,scout_validation_status,scout_commission_status,created_at";
  const founderColumns = "id,profile_id,email,name,venture_name,industry,stage,city,ranking,stats,creator_type,public_name,content_categories,primary_platform,audience_size,engagement_rate,audience_location,audience_demographics,brand_categories,past_collaborations,deliverables,availability,monthly,max_sponsors,image_url,sponsor_deck_status,sponsor_deck_score,sponsor_deck_updated_at,instagram_url,tiktok_url,facebook_url,linkedin_url,sponsor_payment_url,sponsor_terms,status,visual_status,scout_code,scout_active,invited_by_scout_code,scout_validation_status,scout_commission_status,created_at";
  const companyName = currentCompany()?.name || state.session?.name || "";
  const companyId = currentCompany()?.id || "";
  const encodedCompany = encodeURIComponent(companyName);
  const encodedCompanyId = encodeURIComponent(companyId);
  const client = {
    "client-events": [
      { table: "events", query: "select=id,name,category,venue,date,image_url,event_scope,sponsor_levels,status,visual_status,created_at&status=eq.approved&visual_status=eq.approved&order=created_at.desc" }
    ],
    "client-feed": [
      { table: "athlete_posts", query: "select=id,athlete_id,athlete_email,athlete_name,title,caption,image_url,video_url,status,created_at&status=eq.approved&order=created_at.desc" }
    ],
    "client-sponsors": [
      { table: "partnerships", query: "select=id,name,type,tier,description,image_url,url,status,visual_status,created_at&status=eq.approved&visual_status=eq.approved&order=created_at.desc" },
      { table: "company_listings", query: "select=id,company_id,profile_id,company_name,listing_type,category,subcategory,title,summary,description,price,currency,price_label,location,inventory_count,availability,contact_email,website_url,primary_image_url,plan_required,featured,featured_until,status,visual_status,expires_at,created_at,updated_at&order=featured.desc,created_at.desc" },
      { table: "company_subscriptions", query: "select=id,company_id,profile_id,plan,status,current_period_end,listing_limit,event_limit_monthly,seats_limit,created_at,updated_at" }
    ],
    "client-marketplace": [
      { table: "athletes", query: `select=${athleteColumns}&status=eq.approved&visual_status=eq.approved&order=created_at.desc` }
    ],
    "client-founders": [
      { table: "founders", query: `select=${founderColumns}&status=eq.approved&visual_status=eq.approved&order=created_at.desc` }
    ],
    "client-payments": companyName ? [
      { table: "payments", query: `select=id,concept,amount,company,status,product_key,created_at&company=eq.${encodedCompany}&order=created_at.desc` },
      { table: "requests", query: `select=id,type,title,owner,details,priority,status,created_at&owner=eq.${encodedCompany}&order=created_at.desc` }
    ] : [],
    "client-register": [
      { table: "company_subscriptions", query: "select=id,company_id,profile_id,plan,status,current_period_end,listing_limit,event_limit_monthly,seats_limit,created_at,updated_at" },
      ...(companyId ? [{ table: "events", query: `select=id,company_id,profile_id,name,status,created_at&company_id=eq.${encodedCompanyId}&order=created_at.desc` }] : [])
    ]
  };
  const admin = {
    "admin-users": [
      { table: "profiles", query: "select=id,email,role,name,status,must_change_password,created_at&order=created_at.desc" },
      { table: "companies", query: "select=id,name,contact,owner,interest,website,description,logo_url,status,created_at&order=created_at.desc" },
      { table: "athletes", query: `select=${athleteColumns}&order=created_at.desc` },
      { table: "founders", query: `select=${founderColumns}&order=created_at.desc` }
    ],
    "admin-athletes": [{ table: "athletes", query: `select=${athleteColumns}&order=created_at.desc` }],
    "admin-founders": [{ table: "founders", query: `select=${founderColumns}&order=created_at.desc` }],
    "admin-payment-links": [
      { table: "athletes", query: `select=${athleteColumns}&order=created_at.desc` },
      { table: "founders", query: `select=${founderColumns}&order=created_at.desc` }
    ],
    "admin-athlete-notifications": [
      { table: "athletes", query: `select=${athleteColumns}&order=created_at.desc` },
      { table: "founders", query: `select=${founderColumns}&order=created_at.desc` },
      { table: "athlete_notifications", query: "select=id,athlete_id,athlete_email,athlete_name,title,message,category,priority,status,email_status,sent_by,read_at,created_at&order=created_at.desc" }
    ],
    "admin-events": [
      { table: "events", query: "select=id,company_id,profile_id,name,category,venue,date,image_url,image_path,brochure_url,brochure_name,event_scope,sponsor_levels,success_fee_level,success_fee_rate,visual_status,visual_notes,status,created_at,updated_at&order=created_at.desc" },
      { table: "companies", query: "select=id,profile_id,name,contact,status,created_at&order=created_at.desc" }
    ],
    "admin-news": [{ table: "news", query: "select=id,title,summary,image_url,visual_status,visual_notes,status,created_at&order=created_at.desc" }],
    "admin-partners": [{ table: "partnerships", query: "select=id,name,type,tier,description,image_url,url,visual_status,visual_notes,status,created_at&order=created_at.desc" }],
    "admin-corporate-market": [
      { table: "company_listings", query: "select=id,company_id,profile_id,company_name,listing_type,category,subcategory,title,summary,description,price,currency,price_label,location,inventory_count,availability,contact_email,website_url,primary_image_url,plan_required,featured,featured_until,status,visual_status,visual_notes,expires_at,created_at,updated_at&order=created_at.desc" },
      { table: "company_subscriptions", query: "select=id,company_id,profile_id,plan,status,stripe_customer_id,stripe_subscription_id,current_period_end,listing_limit,event_limit_monthly,seats_limit,created_at,updated_at&order=created_at.desc" },
      { table: "companies", query: "select=id,profile_id,name,contact,owner,interest,website,description,logo_url,status,created_at&order=created_at.desc" },
      { table: "marketplace_leads", query: "select=id,listing_id,seller_company_id,buyer_company_id,requester_email,requester_name,requester_company,message,status,created_at,updated_at&order=created_at.desc" },
      { table: "requests", query: "select=id,type,title,owner,details,priority,status,created_at&type=eq.Plan%20empresarial&order=created_at.desc" }
    ],
    "admin-crm": [{ table: "crm", query: "select=id,name,volume,status,created_at&order=created_at.desc" }],
    "admin-revenue": [
      { table: "payments", query: "select=id,concept,amount,company,status,product_key,created_at&order=created_at.desc" },
      { table: "athletes", query: `select=${athleteColumns}&order=created_at.desc` }
    ],
    "admin-payments": [
      { table: "payments", query: "select=id,concept,amount,company,status,product_key,created_at&order=created_at.desc" },
      { table: "athlete_deposits", query: "select=id,athlete_id,athlete_email,athlete_name,month,amount,company,proof_url,status,created_at&order=created_at.desc" },
      { table: "athletes", query: `select=${athleteColumns}&order=created_at.desc` },
      { table: "founders", query: `select=${founderColumns}&order=created_at.desc` }
    ],
    "admin-uploads": [{ table: "uploads", query: "select=id,type,status,name,size,image_url,visual_status,visual_notes,created_at&order=created_at.desc" }],
    "admin-launch": [
      { table: "profiles", query: "select=id,email,role,name,status,created_at&order=created_at.desc" },
      { table: "companies", query: "select=id,name,contact,status,created_at&order=created_at.desc" },
      { table: "athletes", query: `select=${athleteColumns}&order=created_at.desc` },
      { table: "founders", query: `select=${founderColumns}&order=created_at.desc` }
    ],
    "admin-stats": [
      { table: "profiles", query: "select=id,email,role,name,status,created_at&order=created_at.desc" },
      { table: "companies", query: "select=id,name,contact,status,created_at&order=created_at.desc" },
      { table: "athletes", query: `select=${athleteColumns}&order=created_at.desc` },
      { table: "founders", query: `select=${founderColumns}&order=created_at.desc` },
      { table: "sponsorships", query: "select=id,athlete,athlete_email,amount,company,details,status,created_at&order=created_at.desc" },
      { table: "requests", query: "select=id,type,title,owner,details,priority,status,created_at&order=created_at.desc" }
    ]
  };
  return client[targetId] || admin[targetId] || [];
}

function dashboardPanelPageSize(targetId) {
  return targetId.startsWith("admin-") ? dashboardPanelPageSizes.admin : dashboardPanelPageSizes.client;
}

async function ensureDashboardPanelData(targetId, options = {}) {
  if (targetId === "admin-control") {
    await loadAdminGrowthSnapshot({ force: options.refresh === true });
    dashboardPanelLoads.set(targetId, {
      loaded: true,
      loading: false,
      offset: 0,
      hasMore: false,
      lastLoadedAt: Date.now()
    });
    if (document.querySelector('[data-dashboard-panel="admin-control"]')?.classList.contains("active")) renderAdminControl();
    return true;
  }
  const queries = dashboardPanelQueries(targetId);
  if (!queries.length || !api.loadTablePage) return false;
  const existing = dashboardPanelLoads.get(targetId) || {
    loaded: false,
    loading: false,
    offset: 0,
    hasMore: true,
    lastLoadedAt: 0
  };
  const loadMore = options.loadMore === true;
  const refresh = options.refresh === true || (existing.loaded && Date.now() - existing.lastLoadedAt > (options.maxAgeMs || dashboardPanelFreshnessMs));
  if (existing.loading) return dashboardPanelPromises.get(targetId) || false;
  if (existing.loaded && !loadMore && !refresh) return true;
  if (loadMore && !existing.hasMore) return true;
  const pageSize = dashboardPanelPageSize(targetId);
  const offset = loadMore ? existing.offset : 0;
  const status = { ...existing, loading: true };
  dashboardPanelLoads.set(targetId, status);
  decoratePanelPagination(targetId);
  const promise = (async () => {
    const snapshotPromise = targetId === "admin-control"
      ? loadAdminGrowthSnapshot({ force: refresh })
      : Promise.resolve(null);
    const pages = await Promise.all(queries.map(async spec => {
      try {
        const rows = await api.loadTablePage(spec.table, spec.query, { offset, limit: pageSize });
        return { table: spec.table, rows: Array.isArray(rows) ? rows : [] };
      } catch (error) {
        console.warn("[ROIS panel data]", targetId, spec.table, humanError(error));
        return { table: spec.table, rows: [] };
      }
    }));
    await snapshotPromise;
    pages.forEach(({ table, rows }) => mergePageRecords(table, rows));
    const hasMore = pages.some(({ rows }) => rows.length === pageSize);
    dashboardPanelLoads.set(targetId, {
      loaded: true,
      loading: false,
      offset: offset + pageSize,
      hasMore,
      lastLoadedAt: Date.now()
    });
    state.dataSignature = runtimeDataSignature(state.data);
    writeDataCache(state.data);
    if (targetId.startsWith("client-")) renderClientKpis();
    if (document.querySelector(`[data-dashboard-panel="${targetId}"]`)?.classList.contains("active")) {
      renderDashboardPanelById(targetId);
      optimizeRenderedMedia(document.querySelector(`[data-dashboard-panel="${targetId}"]`));
    }
    return true;
  })().finally(() => dashboardPanelPromises.delete(targetId));
  dashboardPanelPromises.set(targetId, promise);
  return promise;
}

function decoratePanelPagination(targetId) {
  const status = dashboardPanelLoads.get(targetId);
  const host = document.querySelector(`[data-dashboard-panel="${targetId}"] .panel`);
  if (!host || !status) return;
  host.querySelector("[data-panel-pagination]")?.remove();
  if (!status.loading && (!status.loaded || !status.hasMore)) return;
  const controls = document.createElement("div");
  controls.className = "panel-body";
  controls.dataset.panelPagination = targetId;
  controls.innerHTML = status.loading
    ? `<button class="btn" type="button" disabled>Cargando registros...</button>`
    : `<button class="btn" type="button" data-load-more-panel="${escapeAttr(targetId)}">Cargar mas registros</button>`;
  host.appendChild(controls);
}

function replaceRecordInState(table, updatedRecord) {
  if (!table || !updatedRecord) return updatedRecord;
  state.data = normalizeLoadedData(state.data || {});
  const rows = Array.isArray(state.data[table]) ? state.data[table] : [];
  const normalizedEmail = String(updatedRecord.email || updatedRecord.contact || "").trim().toLowerCase();
  const index = rows.findIndex(item =>
    (updatedRecord.id && item.id === updatedRecord.id) ||
    (updatedRecord.profile_id && item.profile_id === updatedRecord.profile_id) ||
    (normalizedEmail && String(item.email || item.contact || "").trim().toLowerCase() === normalizedEmail)
  );
  state.data[table] = index >= 0
    ? rows.map((item, itemIndex) => itemIndex === index ? { ...item, ...updatedRecord } : item)
    : [updatedRecord, ...rows];
  state.dataSignature = runtimeDataSignature(state.data);
  writeDataCache(state.data);
  return updatedRecord;
}

function removeRecordFromState(table, id) {
  state.data = normalizeLoadedData(state.data || {});
  state.data[table] = (state.data[table] || []).filter(item => item.id !== id);
  state.dataSignature = runtimeDataSignature(state.data);
  writeDataCache(state.data);
}

function withTimeout(promise, timeoutMs = operationTimeoutMs, message = "La red esta tardando demasiado.") {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]);
}

function founderAsAthleteProfile(founder) {
  if (!founder) return null;
  return {
    ...founder,
    role: "founder",
    sport: founder.industry || founder.sport || "Contenido y entretenimiento",
    category: founder.stage || founder.category || creatorTypeLabel(founder.creator_type),
    location: founder.city || founder.location || "Por definir",
    ranking: founder.ranking || "",
    contact: founder.email,
    terms_accepted: founder.terms_accepted ?? false,
    annual_fee_required: false,
    annual_fee_paid: true
  };
}

function currentAthlete() {
  if (state.session?.role === "founder") {
    return founderAsAthleteProfile(currentFounder());
  }
  if (!state.session || !state.data?.athletes) return null;
  const email = String(state.session.email || "").toLowerCase();
  const sessionId = state.session.authId || state.session.id;
  const profile = (state.data.profiles || []).find(item => item.id === sessionId || String(item.email || "").toLowerCase() === email);
  const athlete = state.data.athletes.find(athlete => (athlete.email || athlete.contact || "").toLowerCase() === email)
    || state.data.athletes.find(athlete => athlete.profile_id && athlete.profile_id === sessionId)
    || state.data.athletes.find(athlete => profile?.id && athlete.profile_id === profile.id)
    || null;
  if (athlete) return athlete;
  if (state.session.role !== "athlete") return null;
  return {
    id: sessionId || email || "athlete-session",
    profile_id: sessionId,
    email: state.session.email,
    contact: state.session.email,
    name: state.session.name || email.split("@")[0] || "Perfil ROIS",
    sport: "Por definir",
    category: "Por definir",
    location: "Ciudad por definir",
    ranking: "Por definir",
    stats: "Completa tu perfil para activar tu ficha ROIS.",
    monthly: 5000,
    max_sponsors: 10,
    status: "approved",
    visual_status: "approved",
    annual_fee_required: false,
    annual_fee_paid: false,
    scout_status: "pending",
    is_virtual: true
  };
}

function getCurrentProfileContext() {
  const role = state.session?.role;
  if (!["athlete", "founder"].includes(role)) return null;
  const table = role === "founder" ? "founders" : "athletes";
  const record = role === "founder" ? currentFounder() : currentAthlete();
  return {
    role,
    table,
    sessionId: state.session?.authId || state.session?.id || null,
    email: String(state.session?.email || "").trim().toLowerCase(),
    record,
    isVirtual: Boolean(record?.is_virtual),
    profileId: state.session?.authId || record?.profile_id || state.session?.id || null
  };
}

function baseProfileRecord(context) {
  const name = state.session?.name || context.email.split("@")[0] || "Perfil ROIS";
  if (context.role === "founder") {
    return {
      profile_id: context.sessionId,
      email: context.email,
      name,
      venture_name: "",
      industry: "Contenido y entretenimiento",
      stage: "En desarrollo",
      city: "Por definir",
      stats: "",
      creator_type: "founder",
      public_name: name,
      primary_platform: "",
      audience_size: 0,
      engagement_rate: 0,
      availability: "available",
      monthly: 2500,
      max_sponsors: 10,
      status: "approved",
      visual_status: "approved"
    };
  }
  return {
    profile_id: context.sessionId,
    email: context.email,
    contact: context.email,
    name,
    sport: "Por definir",
    category: "Por definir",
    location: "Ciudad por definir",
    ranking: "",
    stats: "",
    monthly: 5000,
    max_sponsors: 10,
    status: "approved",
    visual_status: "approved",
    terms_accepted: false
  };
}

async function resolveRealProfileRecord(context = getCurrentProfileContext()) {
  if (!context) throw new Error("No encontramos el contexto autenticado del perfil.");
  const rows = state.data?.[context.table] || [];
  let record = rows.find(item => item.profile_id && item.profile_id === context.sessionId)
    || rows.find(item => String(item.email || "").trim().toLowerCase() === context.email)
    || (context.table === "athletes"
      ? rows.find(item => String(item.contact || "").trim().toLowerCase() === context.email)
      : null);
  if (record?.id && !record.is_virtual) {
    if (context.sessionId && record.profile_id !== context.sessionId) {
      try {
        const corrected = await api.update(context.table, record.id, { profile_id: context.sessionId });
        if (corrected?.id) {
          record = corrected;
          console.info("[ROIS profile] profile_id corregido", {
            table: context.table,
            id: corrected.id,
            profileId: context.sessionId
          });
        }
      } catch (error) {
        console.warn("[ROIS profile] No fue posible corregir profile_id", humanError(error));
      }
    }
    return record;
  }
  if (!context.sessionId || !context.email) throw new Error("No encontramos el registro real del perfil.");
  const persisted = await withTimeout(
    api.upsertByEmail(context.table, baseProfileRecord(context)),
    operationTimeoutMs,
    "La red esta tardando demasiado al crear el perfil."
  );
  if (!persisted?.id) throw new Error("No encontramos el registro real del perfil.");
  replaceRecordInState(context.table, persisted);
  console.info("[ROIS profile] Registro real creado", { table: context.table, id: persisted.id, email: context.email });
  return persisted;
}

function profilePatchForTable(context, patch) {
  if (context.table !== "founders") return patch;
  const founderPatch = { ...patch };
  if ("sport" in founderPatch) {
    founderPatch.industry = founderPatch.sport;
    delete founderPatch.sport;
  }
  if ("category" in founderPatch) {
    founderPatch.stage = founderPatch.category;
    delete founderPatch.category;
  }
  if ("location" in founderPatch) {
    founderPatch.city = founderPatch.location;
    delete founderPatch.location;
  }
  if ("ranking" in founderPatch) {
    founderPatch.ranking = founderPatch.ranking;
  }
  if (!String(founderPatch.venture_name || "").trim()) {
    delete founderPatch.venture_name;
  }
  return founderPatch;
}

function updateProfileInLocalState(table, updatedRecord) {
  return replaceRecordInState(table, updatedRecord);
}

async function saveProfileRecord(patch, context = getCurrentProfileContext()) {
  const record = await resolveRealProfileRecord(context);
  const persistedPatch = profilePatchForTable(context, patch);
  let updated;
  try {
    updated = await withTimeout(
      api.update(context.table, record.id, persistedPatch),
      operationTimeoutMs,
      "La red esta tardando demasiado al guardar el perfil."
    );
  } catch (error) {
    const message = String(error?.message || "");
    if (!/PGRST204|schema cache|image_path|proposal_path|image_mime|proposal_mime|image_name|instagram_url|tiktok_url|facebook_url|linkedin_url|creator_type|public_name|content_categories|primary_platform|audience_size|engagement_rate|audience_location|audience_demographics|brand_categories|past_collaborations|deliverables|availability/i.test(message)) throw error;
    const compatiblePatch = Object.fromEntries(Object.entries(persistedPatch).filter(([key]) =>
      ![
        "image_path",
        "image_name",
        "image_mime",
        "proposal_path",
        "proposal_mime",
        "instagram_url",
        "tiktok_url",
        "facebook_url",
        "linkedin_url",
        "creator_type",
        "public_name",
        "content_categories",
        "primary_platform",
        "audience_size",
        "engagement_rate",
        "audience_location",
        "audience_demographics",
        "brand_categories",
        "past_collaborations",
        "deliverables",
        "availability"
      ].includes(key)
    ));
    console.warn("[ROIS profile] Guardado compatible sin columnas nuevas; ejecuta la migracion SQL de Creadores.");
    updated = await withTimeout(
      api.update(context.table, record.id, compatiblePatch),
      operationTimeoutMs,
      "La red esta tardando demasiado al guardar el perfil."
    );
  }
  if (!updated?.id) throw new Error("El perfil no devolvio un registro persistido.");
  updateProfileInLocalState(context.table, updated);
  return updated;
}

function refreshProfileViews(role = state.session?.role, updatedRecord = null) {
  if (updatedRecord && role === "founder") replaceRecordInState("founders", updatedRecord);
  if (updatedRecord && role === "athlete") replaceRecordInState("athletes", updatedRecord);
  renderSession();
  if (document.querySelector('[data-view="athlete"].active')) {
    renderAthleteHeader();
    renderAthleteKpis();
    renderAthleteProfile();
  }
  if (document.querySelector('[data-view="client"].active')) {
    renderClientMarketplace();
    renderClientFounders();
  }
  if (document.querySelector('[data-view="admin"].active')) {
    renderAdminAthletes();
    renderAdminFounders();
  }
  const profileModal = document.getElementById("actionModal");
  if (
    updatedRecord &&
    profileModal?.classList.contains("active") &&
    profileModal.classList.contains("profile-modal") &&
    profileModal.dataset.profileRecordId === String(updatedRecord.id)
  ) {
    openAthleteProfileView(role === "founder" ? founderAsAthleteProfile(updatedRecord) : updatedRecord);
  }
  applySessionBranding();
  optimizeRenderedMedia();
}

function renderProfileViewsForRole(role = state.session?.role) {
  refreshProfileViews(role);
}

function athleteAnnualFeeExempt(email = state.session?.email, athleteRecord = null) {
  const normalizedEmail = String(email || "").toLowerCase();
  const athlete = athleteRecord || state.data?.athletes?.find(item => String(item.email || item.contact || "").toLowerCase() === normalizedEmail);
  if (athlete?.annual_fee_required === false) return true;
  return athleteAnnualExemptEmails.includes(normalizedEmail);
}

function athleteAnnualFeeRequired(athlete) {
  if (!athlete) return false;
  return athlete.annual_fee_required === true && !athleteAnnualExemptEmails.includes(String(athlete.email || athlete.contact || state.session?.email || "").toLowerCase());
}

function normalizeScoutCode(value = "") {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function scoutCodeKey(value = "") {
  return normalizeScoutCode(value).replace(/[^A-Z0-9]/g, "");
}

function scoutCodeLooksValid(value = "") {
  return /^ROIS[A-Z0-9]{6}$/.test(scoutCodeKey(value));
}

function makeScoutCode(name = "", email = "") {
  const source = `${name}|${email}`.toUpperCase();
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash + source.charCodeAt(index)) >>> 0;
  }
  return `ROIS-${hash.toString(36).toUpperCase().padStart(6, "0").slice(-6)}`;
}

function scoutCodeForAthlete(athlete = currentAthlete()) {
  return normalizeScoutCode(athlete?.scout_code || makeScoutCode(athlete?.name || state.session?.name || "ROIS", athlete?.email || state.session?.email || ""));
}

function activeScoutAthletes() {
  return [
    ...(state.data?.athletes || []),
    ...(state.data?.founders || []).map(founder => ({ ...founder, role: "founder", _profile_table: "founders" }))
  ].filter(profile => profile.scout_active && scoutCodeForAthlete(profile));
}

function adminAthleteRecords() {
  return (state.data?.athletes || []).filter(item => !isFounderProfile(item));
}

function founderProfileRecordsWithoutAthlete() {
  return [];
}

async function ensureCriticalFounderRecords() {
  return true;
}

function adminFounderRecords() {
  return state.data?.founders || [];
}

function scoutCanInvite(athlete) {
  if (!athlete) return false;
  if (["blocked", "deleted", "rejected"].includes(athlete.status)) return false;
  return athlete.scout_active === true || athlete.status === "approved";
}

function findScoutCandidateByCode(code) {
  const normalized = scoutCodeKey(code);
  if (!normalized) return null;
  const candidates = [
    ...(state.data?.athletes || []),
    ...(state.data?.founders || []).map(founder => ({ ...founder, role: "founder", _profile_table: "founders" }))
  ];
  return candidates.find(profile => scoutCodeKey(scoutCodeForAthlete(profile)) === normalized) || null;
}

function findScoutByCode(code) {
  const candidate = findScoutCandidateByCode(code);
  return scoutCanInvite(candidate) ? candidate : null;
}

function scoutCodeRequestActions() {
  return `<button class="btn primary full" type="button" data-request-scout-code>Solicitar asignacion de Scout ROIS</button>`;
}

function athleteProfileCompleteForScout(athlete) {
  if (!athlete) return false;
  return Boolean(
    athlete.image_url &&
    athlete.sport &&
    athlete.sport !== "Por definir" &&
    athlete.location &&
    athlete.category &&
    athlete.stats &&
    athlete.registration_terms_accepted
  );
}

function athleteAnnualFeePaid(athlete) {
  return Boolean(athlete?.annual_fee_paid || athlete?.annual_payment_status === "paid");
}

function creatorProfileCompleteForScout(creator) {
  if (!creator) return false;
  return Boolean(
    creator.image_url &&
    creator.industry &&
    creator.city &&
    creator.creator_type &&
    creator.stats
  );
}

function scoutReferralStatus(record) {
  const creator = record?._profile_table === "founders" || record?.role === "founder" || Boolean(record?.creator_type);
  const paid = creator ? record?.scout_commission_status === "approved" : athleteAnnualFeePaid(record);
  const profile = creator ? creatorProfileCompleteForScout(record) : athleteProfileCompleteForScout(record);
  const validated = record?.scout_validation_status === "validated" || record?.scout_commission_status === "approved";
  const eligible = Boolean(record?.invited_by_scout_code && paid && profile && validated && !["blocked", "deleted", "rejected"].includes(record.status));
  return { paid, profile, validated, eligible };
}

function currentWeekStart() {
  const date = new Date();
  const day = date.getDay() || 7;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - day + 1);
  return date;
}

function calculateAge(dateValue) {
  if (!dateValue) return null;
  const birthDate = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age -= 1;
  return age;
}

function athleteIsMinor(dateValue) {
  const age = calculateAge(dateValue);
  return age !== null && age < 18;
}

function normalizedBirthDate(value) {
  const parsed = String(value || "").trim();
  return parsed || null;
}

function setupAthleteAgeGate() {
  const form = document.getElementById("registrationForm");
  if (!form || state.registrationType !== "athlete") return;
  const birthInput = form.birth_date;
  const panel = form.querySelector("[data-minor-consent]");
  if (!birthInput || !panel) return;
  const guardianFields = Array.from(panel.querySelectorAll("input, select"));
  const updateMinorState = () => {
    const age = calculateAge(birthInput.value);
    const isMinor = age !== null && age < 18;
    const isInvalidFuture = age !== null && age < 0;
    panel.hidden = !isMinor;
    guardianFields.forEach(field => {
      field.disabled = !isMinor;
      field.required = isMinor;
    });
    birthInput.setCustomValidity(isInvalidFuture ? "Ingresa una fecha de nacimiento valida." : "");
  };
  birthInput.addEventListener("input", updateMinorState);
  updateMinorState();
}

async function init() {
  state.session = normalizeSession(state.session);
  renderPublicShell();
  const needsPublicRuntimeData = Boolean(document.querySelector("#publicHomeCover, #publicNews, [data-home-visual]"));
  const cachedData = state.session || needsPublicRuntimeData ? readDataCache() : null;
  state.data = cachedData || normalizeLoadedData({});
  state.dataSignature = runtimeDataSignature(state.data);
  if (state.session && !cachedData && sessionIsBlocked()) {
    state.session = null;
    clearSession();
  }
  const recoverySession = await recoverySessionFromUrl();
  if (recoverySession) {
    state.pendingSession = recoverySession;
    state.session = null;
    clearSession();
  }
  enforceMemberSessionRole();
  enforceCompanyClientSession();
  if (state.session) saveSession(state.session);
  document.body.dataset.activeView = state.session ? dashboardViewForRole(state.session.role) : "home";
  applyBranding();
  handleMissingImages();
  bindGlobalEvents();
  bindDashboardFreshnessEvents();
  renderPublic();
  renderSession();
  optimizeRenderedMedia();
  if (state.pendingSession) {
    showView("home");
    document.getElementById("passwordModal").classList.add("active");
    return;
  }
  if (state.session) showView(dashboardViewForRole(state.session.role));
  if (cachedData || needsPublicRuntimeData) refreshDataInBackground();
}

async function ensureDashboardHydrated(role = state.session?.role, options = {}) {
  if (!role || !state.session) return false;
  const force = options.force === true;
  const maxAgeMs = Number(options.maxAgeMs ?? dashboardFreshnessMs);
  const lastHydratedAt = lastHydratedAtByRole.get(role) || 0;
  if (!force && hydratedRoles.has(role) && Date.now() - lastHydratedAt < maxAgeMs) return true;
  if (dashboardHydrationPromise && dashboardHydrationRole === role) return dashboardHydrationPromise;
  if (dashboardHydrationPromise) {
    await dashboardHydrationPromise;
    return ensureDashboardHydrated(role, options);
  }
  dashboardHydrationRole = role;
  dashboardHydrationPromise = (async () => {
    try {
      const data = api.loadRoleData
        ? await api.loadRoleData(role, state.session)
        : await api.loadAll({ lightweight: role !== "admin", admin: role === "admin" });
      mergeLoadedData(data);
      markBootstrapPanelLoaded(role, data);
      if (sessionIsBlocked()) {
        notify("Acceso", "Cuenta no disponible", "La cuenta fue bloqueada o dada de baja por ROIS.");
        logout();
        return false;
      }
      hydratedRoles.add(role);
      lastHydratedAtByRole.set(role, Date.now());
      renderSession();
      const view = dashboardViewForRole(role);
      if (view === "client") renderClient();
      if (view === "athlete") renderAthlete();
      if (view === "admin") renderAdmin();
      optimizeRenderedMedia();
      return true;
    } catch (error) {
      console.warn("[ROIS hydration]", humanError(error));
      return false;
    } finally {
      dashboardHydrationPromise = null;
      dashboardHydrationRole = null;
    }
  })();
  return dashboardHydrationPromise;
}

async function hydrateDashboardData(forceFull = false) {
  return ensureDashboardHydrated(state.session?.role, { force: forceFull });
}

async function refreshDataInBackground() {
  try {
    if (state.session) {
      await ensureDashboardHydrated(state.session.role, { force: true });
      return;
    }
    const nextData = normalizeLoadedData(api.loadPublicData
      ? await api.loadPublicData()
      : await api.loadAll({ lightweight: true, background: true }));
    const nextSignature = runtimeDataSignature(nextData);
    if (nextSignature === state.dataSignature) return;
    mergeLoadedData(nextData);
    renderPublic();
    optimizeRenderedMedia();
  } catch (error) {
    console.warn("[ROIS background refresh]", humanError(error));
  }
}

function refreshActiveDashboardIfStale() {
  if (!state.session || document.visibilityState === "hidden") return;
  if (state.session.role === "admin") {
    const adminPanelId = activeDashboardPanelId("admin");
    if (adminPanelId) ensureDashboardPanelData(adminPanelId, { maxAgeMs: dashboardPanelFreshnessMs });
    return;
  }
  ensureDashboardHydrated(state.session.role, { maxAgeMs: dashboardFreshnessMs }).then(() => {
    const panelId = activeDashboardPanelId();
    if (panelId) ensureDashboardPanelData(panelId, { maxAgeMs: dashboardPanelFreshnessMs });
  });
}

function bindDashboardFreshnessEvents() {
  window.addEventListener("focus", refreshActiveDashboardIfStale);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshActiveDashboardIfStale();
  });
}

function sessionIsBlocked() {
  const email = String(state.session?.email || "").toLowerCase();
  const profile = state.data?.profiles?.find(item => String(item.email || "").toLowerCase() === email || item.id === state.session?.id);
  const company = state.data?.companies?.find(item => String(item.contact || "").toLowerCase() === email);
  const athlete = state.data?.athletes?.find(item => String(item.email || item.contact || "").toLowerCase() === email);
  const founder = state.data?.founders?.find(item => String(item.email || "").toLowerCase() === email);
  if (!profile && (company || athlete || founder)) return true;
  return [profile, company, athlete, founder].some(item => ["blocked", "deleted", "rejected"].includes(item?.status));
}

function applyBranding() {
  document.querySelectorAll(".brand-logo, .side-logo").forEach(logo => {
    logo.hidden = false;
    logo.closest(".brand, .sidebar")?.classList.remove("logo-fallback");
  });
  applySessionBranding();
  document.body.classList.add("rois-brand-ready");
}

function applySessionBranding() {
  const logo = sessionLogoPath();
  document.querySelectorAll(".mobile-avatar").forEach(button => {
    button.classList.toggle("company-avatar", !!currentCompany()?.logo_url || !!currentAthlete()?.image_url);
    button.classList.remove("avatar-fallback");
  });
  document.querySelectorAll(".mobile-avatar img").forEach(image => {
    image.dataset.fallback = profileImageFallback;
    image.src = profileImageUrl(logo);
    image.hidden = false;
  });
}

function handleMissingImages() {
  document.querySelectorAll("img.brand-logo, img.side-logo").forEach(image => {
    image.addEventListener("error", () => {
      image.hidden = true;
      image.closest(".brand, .sidebar")?.classList.add("logo-fallback");
    }, { once: true });
  });
  document.querySelectorAll(".mobile-avatar img").forEach(image => {
    image.addEventListener("error", () => {
      image.hidden = true;
      image.closest(".mobile-avatar")?.classList.add("avatar-fallback");
    });
  });
  document.querySelectorAll(".company-session-logo").forEach(image => {
    image.addEventListener("error", () => {
      image.hidden = true;
    });
  });
}

function optimizeRenderedMedia(root = document) {
  root.querySelectorAll("img").forEach(image => {
    if (!image.hasAttribute("loading")) image.loading = "lazy";
    image.decoding = "async";
  });
  root.querySelectorAll("[data-profile-image], .athlete-card img, .athlete-profile-photo img, .mobile-avatar img, .sponsor-bubble img").forEach(image => {
    if (image.dataset.fallbackBound === "true") return;
    image.dataset.fallbackBound = "true";
    image.addEventListener("error", () => {
      const brokenUrl = image.currentSrc || image.src;
      console.warn("[ROIS media] Imagen no disponible", brokenUrl);
      image.onerror = null;
      image.src = image.dataset.fallback || profileImageFallback;
    });
  });
  root.querySelectorAll("video").forEach(video => {
    if (!video.hasAttribute("preload")) video.preload = "metadata";
    video.playsInline = true;
  });
}

function demoApi() {
  function normalizeData(data) {
    return {
      ...structuredClone(seed),
      ...data,
      profiles: data.profiles || [],
      companies: data.companies || [],
      athletes: data.athletes || [],
      founders: data.founders || [],
      events: data.events || [],
      requests: data.requests || [],
      sponsorships: data.sponsorships || [],
      news: data.news || [],
      partnerships: data.partnerships || [],
      site_settings: data.site_settings || [],
      crm: data.crm || [],
      payments: data.payments || [],
      uploads: data.uploads || [],
      athlete_posts: data.athlete_posts || [],
      athlete_results: data.athlete_results || [],
      athlete_expenses: data.athlete_expenses || [],
      athlete_deposits: data.athlete_deposits || [],
      athlete_notifications: data.athlete_notifications || [],
      terms_acceptances: data.terms_acceptances || []
    };
  }
  function read() {
    const stored = localStorage.getItem(storeKey);
    if (stored) {
      const data = normalizeData(JSON.parse(stored));
      localStorage.setItem(storeKey, JSON.stringify(data));
      return data;
    }
    localStorage.setItem(storeKey, JSON.stringify(seed));
    return structuredClone(seed);
  }
  function write(data) {
    localStorage.setItem(storeKey, JSON.stringify(data));
  }
  return {
    async loadAll() { return read(); },
    async loadPublicData() { return read(); },
    async loadRoleData() { return read(); },
    async loadTablePage(table, query, options = {}) {
      const rows = read()[table] || [];
      const offset = Math.max(0, Number(options.offset || 0));
      const limit = Math.max(1, Number(options.limit || 50));
      return rows.slice(offset, offset + limit);
    },
    async loadAdminGrowthSnapshot() {
      return adminGrowthSnapshotFromState();
    },
    async validateScoutCode(code) {
      const data = read();
      const normalized = scoutCodeKey(code);
      const candidate = data.athletes.find(athlete => scoutCodeKey(scoutCodeForAthlete(athlete)) === normalized);
      const activeCandidate = Boolean(candidate && scoutCanInvite(candidate));
      return {
        valid: activeCandidate || scoutCodeLooksValid(code),
        exists: Boolean(candidate),
        pendingValidation: !activeCandidate && scoutCodeLooksValid(code)
      };
    },
    async login(email, password) {
      const data = read();
      const user = data.profiles.find(item => item.email.toLowerCase() === email.toLowerCase() && item.password === password);
      if (!user) throw new Error("Credenciales inv\u00e1lidas.");
      if (user.status !== "approved") throw new Error("Este usuario a\u00fan no est\u00e1 aprobado.");
      return { id: user.id, email: user.email, role: normalizedRole(user.email, user.role), name: user.name, token: "demo", mustChangePassword: !!user.mustChangePassword };
    },
    async signupCompany({ company, email, contact, interest, password }) {
      const data = read();
      if (data.profiles.some(item => item.email.toLowerCase() === email.toLowerCase())) {
        throw new Error("Ya existe una cuenta con ese correo.");
      }
      const id = crypto.randomUUID();
      const profile = { id, email, password, role: "client", name: company, status: "approved", mustChangePassword: false };
      data.profiles.unshift(profile);
      const companyId = crypto.randomUUID();
      data.companies.unshift({ id: companyId, profile_id: id, name: company, contact: email, owner: contact, interest, status: "approved" });
      data.company_subscriptions.unshift({ id: crypto.randomUUID(), company_id: companyId, profile_id: id, company_name: company, plan: "free", status: "inactive", listing_limit: 0, event_limit_monthly: 0, seats_limit: 1 });
      write(data);
      state.data = data;
      return {
        confirmed: true,
        session: { id, email, role: "client", name: company, token: "demo", mustChangePassword: false }
      };
    },
    async signupAthlete(payload) {
      const data = read();
      if (data.profiles.some(item => item.email.toLowerCase() === payload.email.toLowerCase())) {
        throw new Error("Ya existe una cuenta con ese correo.");
      }
      const birthDate = normalizedBirthDate(payload.birthDate);
      const id = crypto.randomUUID();
      const profile = { id, email: payload.email, password: payload.password, role: "athlete", name: payload.name, status: "approved", mustChangePassword: false };
      data.profiles.unshift(profile);
      data.athletes.unshift({
        id: crypto.randomUUID(),
        profile_id: id,
        email: payload.email,
        name: payload.name,
        sport: payload.sport || "Por definir",
        category: payload.category || "",
        location: payload.location || "",
        ranking: "",
        stats: payload.stats || "",
        annual: athleteAnnualFeeAmount,
        annual_fee_required: false,
        monthly: 5000,
        max_sponsors: 10,
        scout_code: makeScoutCode(payload.name, payload.email),
        scout_active: false,
        invited_by_scout_code: payload.scoutCode,
        scout_terms_accepted: false,
        annual_fee_paid: false,
        scout_validation_status: "pending",
        scout_commission_status: "pending",
        birth_date: birthDate,
        age_status: payload.isMinor ? "minor" : "adult",
        guardian_name: payload.isMinor ? payload.guardianName : "",
        guardian_email: payload.isMinor ? payload.guardianEmail : "",
        guardian_phone: payload.isMinor ? payload.guardianPhone : "",
        guardian_relationship: payload.isMinor ? payload.guardianRelationship : "",
        guardian_consent: Boolean(payload.guardianConsent),
        legal_status: payload.isMinor ? "minor_guardian_review" : "adult_self_registered",
        registration_terms_accepted: Boolean(payload.termsAccepted),
        terms_accepted: false,
        status: "approved",
        visual_status: "approved"
      });
      write(data);
      state.data = data;
      return {
        confirmed: true,
        session: { id, email: payload.email, role: "athlete", name: payload.name, token: "demo", mustChangePassword: false }
      };
    },
    async signupFounder(payload) {
      const data = read();
      const normalizedEmail = String(payload.email || "").trim().toLowerCase();
      if (data.profiles.some(item => item.email.toLowerCase() === normalizedEmail)) {
        throw new Error("Ya existe una cuenta con ese correo.");
      }
      const id = crypto.randomUUID();
      const profile = { id, email: normalizedEmail, password: payload.password, role: "founder", name: payload.name, status: "approved", mustChangePassword: false };
      data.profiles.unshift(profile);
      data.founders.unshift({
        id: crypto.randomUUID(),
        profile_id: id,
        email: normalizedEmail,
        name: payload.name,
        venture_name: payload.ventureName || "",
        industry: payload.industry || "Contenido y entretenimiento",
        stage: payload.stage || "En desarrollo",
        city: payload.city || "Por definir",
        stats: payload.stats || "",
        creator_type: payload.creatorType || "founder",
        public_name: payload.publicName || payload.name,
        content_categories: payload.contentCategories || "",
        primary_platform: payload.primaryPlatform || "",
        audience_size: Number(payload.audienceSize || 0),
        engagement_rate: Number(payload.engagementRate || 0),
        audience_location: payload.audienceLocation || "",
        brand_categories: payload.brandCategories || "",
        availability: "available",
        monthly: 2500,
        max_sponsors: 10,
        scout_code: makeScoutCode(payload.name, normalizedEmail),
        scout_active: false,
        invited_by_scout_code: normalizeScoutCode(payload.scoutCode),
        scout_validation_status: "pending",
        scout_commission_status: "pending",
        status: "approved",
        visual_status: "approved"
      });
      write(data);
      state.data = data;
      return {
        confirmed: true,
        session: { id, email: normalizedEmail, role: "founder", name: payload.name, token: "demo", mustChangePassword: false }
      };
    },
    async resendSignup(email) {
      return { email };
    },
    async recoverPassword(email) {
      return { email };
    },
    async recoverySession(accessToken) {
      const data = read();
      const user = data.profiles[0] || { id: crypto.randomUUID(), email: "demo@rois.trade", role: "client", name: "Cuenta ROIS" };
      return { id: user.id, email: user.email, role: normalizedRole(user.email, user.role), name: user.name, token: accessToken || "demo", mustChangePassword: true };
    },
    async insert(table, record) {
      const data = read();
      const item = { id: crypto.randomUUID(), ...record };
      data[table].unshift(item);
      write(data);
      state.data = data;
      return item;
    },
    async update(table, id, patch) {
      const data = read();
      data[table] = data[table].map(item => item.id === id ? { ...item, ...patch } : item);
      write(data);
      state.data = data;
      return data[table].find(item => item.id === id);
    },
    async remove(table, id) {
      const data = read();
      data[table] = data[table].filter(item => item.id !== id);
      write(data);
      state.data = data;
      return true;
    },
    async upsert(table, record) {
      const data = read();
      const id = record.id || crypto.randomUUID();
      const exists = data[table].some(item => item.id === id);
      data[table] = exists ? data[table].map(item => item.id === id ? { ...item, ...record, id } : item) : [{ ...record, id }, ...data[table]];
      write(data);
      state.data = data;
      return data[table].find(item => item.id === id);
    },
    async upsertByEmail(table, record) {
      const data = read();
      const email = String(record.email || record.contact || "").trim().toLowerCase();
      const existing = data[table].find(item => String(item.email || item.contact || "").trim().toLowerCase() === email);
      const item = existing
        ? { ...existing, ...record }
        : { id: crypto.randomUUID(), ...record };
      data[table] = existing
        ? data[table].map(row => row.id === existing.id ? item : row)
        : [item, ...data[table]];
      write(data);
      replaceRecordInState(table, item);
      return item;
    },
    async changePassword(session, password) {
      const data = read();
      data.profiles = data.profiles.map(user => user.id === session.id ? { ...user, password, mustChangePassword: false } : user);
      write(data);
      state.data = data;
      return { ...session, mustChangePassword: false };
    }
  };
}

function supabaseApi() {
  const headers = token => ({
    apikey: config.supabaseAnonKey,
    Authorization: `Bearer ${token || state.session?.token || config.supabaseAnonKey}`,
    "Content-Type": "application/json"
  });
  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), options.timeoutMs || operationTimeoutMs);
    try {
      const response = await fetch(`${config.supabaseUrl}${path}`, { ...options, signal: options.signal || controller.signal });
      if (!response.ok) throw new Error(await response.text());
      if (response.status === 204) return null;
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("La red esta tardando demasiado.");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    async loadTablePage(table, query = "", options = {}) {
      const offset = Math.max(0, Number(options.offset || 0));
      const limit = Math.max(1, Math.min(250, Number(options.limit || 50)));
      const separator = query ? "&" : "";
      return request(`/rest/v1/${table}?${query}${separator}offset=${offset}&limit=${limit}`, {
        headers: headers(options.token)
      });
    },
    async loadAdminGrowthSnapshot() {
      return request("/rest/v1/rpc/admin_growth_snapshot", {
        method: "POST",
        headers: headers(),
        body: "{}"
      });
    },
    async loadPublicData() {
      const fallback = normalizeLoadedData(state.data || readDataCache() || {});
      const publicQueries = {
        athletes: "select=id,profile_id,email,name,sport,category,location,ranking,stats,monthly,max_sponsors,image_url,sponsor_deck_status,sponsor_deck_score,sponsor_deck_updated_at,instagram_url,tiktok_url,facebook_url,linkedin_url,status,visual_status&status=eq.approved&visual_status=eq.approved&order=created_at.desc&limit=24",
        founders: "select=id,profile_id,email,name,venture_name,industry,stage,city,ranking,stats,creator_type,public_name,content_categories,primary_platform,audience_size,engagement_rate,audience_location,audience_demographics,brand_categories,past_collaborations,deliverables,availability,monthly,max_sponsors,image_url,sponsor_deck_status,sponsor_deck_score,sponsor_deck_updated_at,instagram_url,tiktok_url,facebook_url,linkedin_url,sponsor_payment_url,sponsor_terms,status,visual_status&status=eq.approved&visual_status=eq.approved&order=created_at.desc&limit=24",
        events: "select=id,name,category,venue,date,image_url,event_scope,sponsor_levels,status,visual_status&status=eq.approved&order=created_at.desc&limit=24",
        news: "select=id,title,summary,image_url,status,visual_status,created_at&status=eq.published&order=created_at.desc&limit=12",
        partnerships: "select=id,name,type,tier,description,image_url,url,status,visual_status,created_at&status=eq.approved&order=created_at.desc&limit=24",
        site_settings: "select=id,value,created_at&limit=40",
        uploads: "select=id,type,status,name,size,image_url,visual_status,created_at&order=created_at.desc&limit=20"
      };
      const result = {};
      await Promise.all(Object.entries(publicQueries).map(async ([table, query]) => {
        try {
          result[table] = await request(`/rest/v1/${table}?${query}`, { headers: headers() });
        } catch (error) {
          result[table] = fallback[table] || [];
        }
      }));
      return result;
    },
    async loadAll(options = {}) {
      const lightweight = options.lightweight !== false;
      const adminMode = options.admin === true || state.session?.role === "admin";
      const mainLimit = adminMode ? 1000 : 180;
      const mediumLimit = adminMode ? 500 : 120;
      const smallLimit = adminMode ? 300 : 80;
      const tableQueries = {
        profiles: `select=id,email,role,name,status,must_change_password,created_at&order=created_at.desc&limit=${mainLimit}`,
        companies: `select=id,profile_id,name,contact,owner,interest,website,description,logo_url,status,created_at&order=created_at.desc&limit=${mainLimit}`,
        athletes: `select=id,profile_id,email,contact,name,sport,stats,monthly,annual,category,location,ranking,video_url,instagram_url,tiktok_url,facebook_url,linkedin_url,image_url,image_path,visual_status,visual_notes,terms_accepted,scout_code,scout_active,scout_terms_accepted,invited_by_scout_code,annual_fee_required,annual_fee_paid,annual_payment_status,scout_validation_status,scout_commission_status,max_sponsors,sponsor_deck_status,sponsor_deck_score,sponsor_deck_updated_at,sponsor_payment_url,sponsor_terms,sponsor_logos,birth_date,age_status,guardian_name,guardian_email,guardian_phone,guardian_relationship,guardian_consent,status,created_at&order=created_at.desc&limit=${mainLimit}`,
        founders: `select=id,profile_id,email,name,venture_name,industry,stage,city,ranking,stats,creator_type,public_name,content_categories,primary_platform,audience_size,engagement_rate,audience_location,audience_demographics,brand_categories,past_collaborations,deliverables,availability,monthly,max_sponsors,scout_code,scout_active,invited_by_scout_code,scout_validation_status,scout_commission_status,image_url,image_path,sponsor_deck_status,sponsor_deck_score,sponsor_deck_updated_at,video_url,instagram_url,tiktok_url,facebook_url,linkedin_url,sponsor_payment_url,sponsor_terms,sponsor_logos,terms_accepted,status,visual_status,created_at,updated_at&order=created_at.desc&limit=${mainLimit}`,
        events: `select=id,company_id,profile_id,name,category,venue,date,image_url,image_path,brochure_url,brochure_name,event_scope,sponsor_levels,success_fee_level,success_fee_rate,visual_status,visual_notes,status,created_at,updated_at&order=created_at.desc&limit=${mediumLimit}`,
        requests: `select=id,type,title,owner,details,priority,status,created_at&order=created_at.desc&limit=${mediumLimit}`,
        sponsorships: `select=id,athlete,athlete_email,amount,company,details,status,created_at&order=created_at.desc&limit=${mediumLimit}`,
        news: `select=id,title,summary,image_url,visual_status,visual_notes,status,created_at&order=created_at.desc&limit=${smallLimit}`,
        partnerships: `select=id,name,type,tier,description,image_url,url,visual_status,visual_notes,status,created_at&order=created_at.desc&limit=${smallLimit}`,
        site_settings: `select=id,value,created_at&limit=${Math.min(smallLimit, 80)}`,
        crm: `select=id,name,volume,status,created_at&order=created_at.desc&limit=${mediumLimit}`,
        payments: `select=id,concept,amount,company,status,product_key,created_at&order=created_at.desc&limit=${mediumLimit}`,
        uploads: `select=id,type,status,name,size,image_url,visual_status,visual_notes,created_at&order=created_at.desc&limit=${lightweight ? Math.min(smallLimit, 80) : mediumLimit}`,
        athlete_posts: `select=id,athlete_id,athlete_email,athlete_name,title,caption,video_url,image_url,visual_status,visual_notes,status,created_at&order=created_at.desc&limit=${mediumLimit}`,
        athlete_results: `select=id,athlete_id,athlete_email,athlete_name,month,event,summary,proof_url,status,created_at&order=created_at.desc&limit=${mediumLimit}`,
        athlete_expenses: `select=id,athlete_id,athlete_email,athlete_name,date,category,amount,company,ticket_url,invoice_url,notes,status,created_at&order=created_at.desc&limit=${mediumLimit}`,
        athlete_deposits: `select=id,athlete_id,athlete_email,athlete_name,month,amount,company,proof_url,status,created_at&order=created_at.desc&limit=${mediumLimit}`,
        athlete_notifications: `select=id,athlete_id,athlete_email,athlete_name,title,message,category,priority,status,email_status,sent_by,read_at,created_at&order=created_at.desc&limit=${mediumLimit}`,
        terms_acceptances: `select=id,user_email,user_role,version,status,created_at&order=created_at.desc&limit=${mediumLimit}`,
        company_subscriptions: `select=id,company_id,profile_id,plan,status,current_period_end,listing_limit,event_limit_monthly,seats_limit,created_at,updated_at&order=created_at.desc&limit=${mediumLimit}`,
        company_listings: `select=id,company_id,profile_id,company_name,listing_type,category,subcategory,title,summary,description,price,currency,price_label,location,inventory_count,availability,contact_email,website_url,primary_image_url,plan_required,featured,featured_until,status,visual_status,visual_notes,expires_at,created_at,updated_at&order=created_at.desc&limit=${mainLimit}`,
        company_listing_media: `select=id,listing_id,company_id,storage_path,public_url,original_name,mime_type,sort_order,created_at&order=created_at.desc&limit=${mediumLimit}`,
        marketplace_leads: `select=id,listing_id,seller_company_id,buyer_company_id,requester_profile_id,requester_email,requester_name,requester_company,message,status,created_at,updated_at&order=created_at.desc&limit=${mediumLimit}`
      };
      const fallback = normalizeLoadedData(state.data || readDataCache() || {});
      const result = {};
      await Promise.all(Object.entries(tableQueries).map(async ([table, query]) => {
        try {
          result[table] = await request(`/rest/v1/${table}?${query}`, { headers: headers() });
        } catch (error) {
          result[table] = Array.isArray(fallback[table]) ? fallback[table] : [];
        }
      }));
      return normalizeLoadedData(result);
    },
    async loadRoleData(role = state.session?.role, session = state.session) {
      if (!session?.email) return normalizeLoadedData({});
      const email = String(session.email || "").trim().toLowerCase();
      const encodedEmail = encodeURIComponent(email);
      const tokenHeaders = headers(session.token);
      const authId = session.authId || session.id;
      const roleRequest = path => request(path, { headers: tokenHeaders }).catch(error => {
        console.warn("[ROIS role data]", path.split("?")[0], humanError(error));
        return [];
      });
      if (role === "admin") {
        const result = {};
        await Promise.all(dashboardPanelQueries("admin-users").map(async spec => {
          result[spec.table] = await roleRequest(`/rest/v1/${spec.table}?${spec.query}&limit=${dashboardPanelPageSizes.admin}`);
        }));
        return normalizeLoadedData(result);
      }
      const profileQuery = `/rest/v1/profiles?select=id,email,role,name,status,must_change_password,created_at&or=(id.eq.${encodeURIComponent(authId)},email.eq.${encodedEmail})&limit=1`;
      const athleteColumns = "id,profile_id,email,contact,name,sport,category,location,ranking,stats,monthly,max_sponsors,image_url,image_path,sponsor_deck,sponsor_deck_status,sponsor_deck_score,sponsor_deck_updated_at,video_url,instagram_url,tiktok_url,facebook_url,linkedin_url,sponsor_payment_url,sponsor_terms,sponsor_logos,status,visual_status,terms_accepted,scout_code,scout_active,created_at";
      const founderColumns = "id,profile_id,email,name,venture_name,industry,stage,city,ranking,stats,creator_type,public_name,content_categories,primary_platform,audience_size,engagement_rate,audience_location,audience_demographics,brand_categories,past_collaborations,deliverables,availability,monthly,max_sponsors,image_url,image_path,sponsor_deck,sponsor_deck_status,sponsor_deck_score,sponsor_deck_updated_at,video_url,instagram_url,tiktok_url,facebook_url,linkedin_url,sponsor_payment_url,sponsor_terms,sponsor_logos,status,visual_status,terms_accepted,scout_code,scout_active,invited_by_scout_code,scout_validation_status,scout_commission_status,created_at";
      const ownProfile = roleRequest(profileQuery);
      if (role === "athlete") {
        const [profiles, ownAthletes, terms, notifications, posts, results] = await Promise.all([
          ownProfile,
          roleRequest(`/rest/v1/athletes?select=${athleteColumns}&or=(profile_id.eq.${encodeURIComponent(authId)},email.eq.${encodedEmail},contact.eq.${encodedEmail})&limit=2`),
          roleRequest(`/rest/v1/terms_acceptances?select=id,user_email,user_role,version,status,created_at&user_email=eq.${encodedEmail}&order=created_at.desc&limit=20`),
          roleRequest(`/rest/v1/athlete_notifications?select=id,athlete_email,title,message,category,status,created_at&athlete_email=eq.${encodedEmail}&order=created_at.desc&limit=40`),
          roleRequest(`/rest/v1/athlete_posts?select=id,athlete_email,title,caption,image_url,video_url,status,created_at&athlete_email=eq.${encodedEmail}&order=created_at.desc&limit=30`),
          roleRequest(`/rest/v1/athlete_results?select=id,athlete_id,athlete_email,athlete_name,month,event,summary,proof_url,status,created_at&athlete_email=eq.${encodedEmail}&order=created_at.desc&limit=30`)
        ]);
        const ownAthlete = ownAthletes.find(item =>
          item.profile_id === authId ||
          String(item.email || item.contact || "").trim().toLowerCase() === email
        ) || ownAthletes[0];
        const scoutCode = scoutCodeForAthlete(ownAthlete);
        const referralColumns = "id,profile_id,email,contact,name,sport,category,location,stats,image_url,scout_code,scout_active,invited_by_scout_code,registration_terms_accepted,annual_fee_paid,annual_payment_status,scout_validation_status,scout_commission_status,status,visual_status,created_at";
        const [referrals, creatorReferrals] = scoutCode
          ? await Promise.all([
              roleRequest(`/rest/v1/athletes?select=${referralColumns}&invited_by_scout_code=eq.${encodeURIComponent(scoutCode)}&order=created_at.desc&limit=100`),
              roleRequest(`/rest/v1/founders?select=${founderColumns}&invited_by_scout_code=eq.${encodeURIComponent(scoutCode)}&order=created_at.desc&limit=100`)
            ])
          : [[], []];
        const athletes = [...ownAthletes];
        referrals.forEach(referral => {
          if (!athletes.some(item => item.id === referral.id)) athletes.push(referral);
        });
        return { profiles, athletes, founders: creatorReferrals, terms_acceptances: terms, athlete_notifications: notifications, athlete_posts: posts, athlete_results: results };
      }
      if (role === "founder") {
        const [profiles, founders, terms, notifications, posts, results] = await Promise.all([
          ownProfile,
          roleRequest(`/rest/v1/founders?select=${founderColumns}&or=(profile_id.eq.${encodeURIComponent(authId)},email.eq.${encodedEmail})&limit=2`),
          roleRequest(`/rest/v1/terms_acceptances?select=id,user_email,user_role,version,status,created_at&user_email=eq.${encodedEmail}&order=created_at.desc&limit=20`),
          roleRequest(`/rest/v1/athlete_notifications?select=id,athlete_email,title,message,category,status,created_at&athlete_email=eq.${encodedEmail}&order=created_at.desc&limit=40`),
          roleRequest(`/rest/v1/athlete_posts?select=id,athlete_email,title,caption,image_url,video_url,status,created_at&athlete_email=eq.${encodedEmail}&order=created_at.desc&limit=30`),
          roleRequest(`/rest/v1/athlete_results?select=id,athlete_id,athlete_email,athlete_name,month,event,summary,proof_url,status,created_at&athlete_email=eq.${encodedEmail}&order=created_at.desc&limit=30`)
        ]);
        const ownFounder = founders.find(item =>
          item.profile_id === authId || String(item.email || "").trim().toLowerCase() === email
        ) || founders[0];
        const scoutCode = scoutCodeForAthlete(ownFounder);
        const referralColumns = "id,profile_id,email,contact,name,sport,category,location,stats,image_url,scout_code,scout_active,invited_by_scout_code,registration_terms_accepted,annual_fee_paid,annual_payment_status,scout_validation_status,scout_commission_status,status,visual_status,created_at";
        const [athleteReferrals, creatorReferrals] = scoutCode
          ? await Promise.all([
              roleRequest(`/rest/v1/athletes?select=${referralColumns}&invited_by_scout_code=eq.${encodeURIComponent(scoutCode)}&order=created_at.desc&limit=100`),
              roleRequest(`/rest/v1/founders?select=${founderColumns}&invited_by_scout_code=eq.${encodeURIComponent(scoutCode)}&order=created_at.desc&limit=100`)
            ])
          : [[], []];
        creatorReferrals.forEach(referral => {
          if (!founders.some(item => item.id === referral.id)) founders.push(referral);
        });
        return { profiles, founders, athletes: athleteReferrals, terms_acceptances: terms, athlete_notifications: notifications, athlete_posts: posts, athlete_results: results };
      }
      const [profiles, companies, news, subscriptions] = await Promise.all([
        ownProfile,
        roleRequest(`/rest/v1/companies?select=id,profile_id,name,contact,owner,interest,website,description,logo_url,status&contact=eq.${encodedEmail}&limit=1`),
        roleRequest("/rest/v1/news?select=id,title,summary,image_url,status,visual_status,created_at&status=eq.published&order=created_at.desc&limit=12"),
        roleRequest(`/rest/v1/company_subscriptions?select=id,company_id,profile_id,plan,status,current_period_end,listing_limit,event_limit_monthly,seats_limit,created_at,updated_at&profile_id=eq.${encodeURIComponent(authId)}&limit=1`)
      ]);
      return { profiles, companies, news, company_subscriptions: subscriptions };
    },
    async validateScoutCode(code) {
      const normalized = normalizeScoutCode(code);
      if (!normalized) return { valid: false, exists: false };
      const validFormat = scoutCodeLooksValid(normalized);
      try {
        const result = await request("/rest/v1/rpc/is_active_scout_code", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ code: normalized })
        });
        const valid = result === true || result === "true" || result?.is_active_scout_code === true;
        return {
          valid: valid || validFormat,
          exists: valid,
          pendingValidation: !valid && validFormat
        };
      } catch (error) {
        const candidate = findScoutCandidateByCode(normalized);
        const activeCandidate = Boolean(candidate && scoutCanInvite(candidate));
        return {
          valid: activeCandidate || validFormat,
          exists: Boolean(candidate),
          pendingValidation: !activeCandidate && validFormat
        };
      }
    },
    async login(email, password) {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const auth = await request("/auth/v1/token?grant_type=password", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ email: normalizedEmail, password })
      });
      const [companies, initialAthletes, initialFounders, profilesById] = await Promise.all([
        request(`/rest/v1/companies?select=id,profile_id,name,contact,owner,interest,website,description,logo_url,status&contact=eq.${encodeURIComponent(normalizedEmail)}&limit=1`, {
          headers: headers(auth.access_token)
        }),
        request(`/rest/v1/athletes?select=id,profile_id,email,contact,name,sport,category,location,ranking,stats,monthly,max_sponsors,image_url,sponsor_deck_status,sponsor_deck_score,sponsor_deck_updated_at,status,visual_status&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`, {
          headers: headers(auth.access_token)
        }),
        request(`/rest/v1/founders?select=id,profile_id,email,name,venture_name,industry,stage,city,ranking,stats,creator_type,public_name,content_categories,primary_platform,audience_size,engagement_rate,audience_location,brand_categories,availability,monthly,max_sponsors,image_url,sponsor_deck_status,sponsor_deck_score,sponsor_deck_updated_at,sponsor_payment_url,sponsor_terms,status,visual_status&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`, {
          headers: headers(auth.access_token)
        }),
        request(`/rest/v1/profiles?select=id,email,role,name,status,must_change_password&id=eq.${auth.user.id}&limit=1`, {
          headers: headers(auth.access_token)
        })
      ]);
      let athletes = initialAthletes;
      let founders = initialFounders;
      let profiles = profilesById;
      if (!profiles.length) {
        profiles = await request(`/rest/v1/profiles?select=id,email,role,name,status,must_change_password&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`, {
          headers: headers(auth.access_token)
        });
      }
      if (!profiles.length && (companies.length || athletes.length || founders.length)) {
        throw new Error("Esta cuenta fue dada de baja o requiere reactivaci\u00f3n por ROIS.");
      }
      const authRole = String(auth.user.user_metadata?.role || "").toLowerCase();
      let profile = profiles[0] || null;
      if (!profile) {
        if (authRole === "founder" || founders.length) {
          profile = await this.ensureFounderAccount(auth);
        } else if (authRole === "athlete") {
          profile = await this.ensureAthleteAccount(auth);
        } else {
          profile = await this.ensureClientAccount(auth);
        }
      } else if (profile.role === "founder" && !founders.length) {
        profile = await this.ensureFounderAccount(auth, { name: profile.name });
      } else if (profile.role === "athlete" && !athletes.length) {
        profile = await this.ensureAthleteAccount(auth, { forceRole: true });
      } else if (profile.role === "client" && !companies.length) {
        profile = await this.ensureClientAccount(auth);
      }
      if (profile.role === "athlete" && !athletes.length) {
        try {
          await this.ensureAthleteAccount(auth, { forceRole: true });
          athletes = await request(`/rest/v1/athletes?select=id,profile_id,email,contact,name,sport,category,location,ranking,stats,status,visual_status&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`, {
            headers: headers(auth.access_token)
          });
        } catch (error) {
          athletes = [];
        }
      }
      if (profile.role === "founder" && !founders.length) {
        try {
          await this.ensureFounderAccount(auth, { name: profile.name });
          founders = await request(`/rest/v1/founders?select=id,profile_id,email,name,venture_name,industry,stage,city,ranking,stats,creator_type,public_name,content_categories,primary_platform,audience_size,engagement_rate,audience_location,brand_categories,availability,monthly,max_sponsors,image_url,sponsor_deck_status,sponsor_deck_score,sponsor_deck_updated_at,sponsor_payment_url,sponsor_terms,status,visual_status&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`, {
            headers: headers(auth.access_token)
          });
        } catch (error) {
          founders = [];
        }
      }
      if (["blocked", "deleted", "rejected"].includes(profile.status)) throw new Error("Esta cuenta fue dada de baja por ROIS.");
      if (profile.status !== "approved") throw new Error("Este usuario a\u00fan no est\u00e1 aprobado.");
      if (companies.some(company => ["blocked", "deleted", "rejected"].includes(company.status))) throw new Error("Esta empresa fue dada de baja por ROIS.");
      if (athletes.some(athlete => ["blocked", "deleted", "rejected"].includes(athlete.status))) throw new Error("Esta cuenta emprendedora fue dada de baja por ROIS.");
      if (founders.some(founder => ["blocked", "deleted", "rejected"].includes(founder.status))) throw new Error("Esta cuenta de creador fue dada de baja por ROIS.");
      const role = profile.role === "founder"
        ? "founder"
        : profile.role === "athlete"
          ? "athlete"
          : companies.length
            ? "client"
            : normalizedRole(normalizedEmail, profile.role);
      return {
        id: profile.id,
        authId: auth.user.id,
        email: normalizedEmail,
        role,
        name: profile.name,
        token: auth.access_token,
        mustChangePassword: !!profile.must_change_password,
        bootstrapData: {
          profiles: [profile],
          companies,
          athletes,
          founders
        }
      };
    },
    async signupCompany({ company, email, contact, interest, password }) {
      const auth = await request("/auth/v1/signup", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          email,
          password,
          data: {
            name: company,
            company_name: company,
            contact_name: contact,
            interest
          }
        })
      });
      const accessToken = auth.session?.access_token || auth.access_token;
      const authUser = auth.user || auth;
      if (!accessToken || !authUser?.id) {
        return { confirmed: false, email };
      }
      const profile = await this.ensureClientAccount({ user: authUser, access_token: accessToken }, { company, contact, interest });
      mergeLoadedData(await this.loadRoleData("client", { id: profile.id, email, token: accessToken }));
      return {
        confirmed: true,
        session: { id: profile.id, authId: authUser.id, email, role: "client", name: profile.name, token: accessToken, mustChangePassword: false }
      };
    },
    async signupAthlete(payload) {
      const normalizedEmail = String(payload.email || "").trim().toLowerCase();
      const birthDate = normalizedBirthDate(payload.birthDate);
      const auth = await request("/auth/v1/signup", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          email: normalizedEmail,
          password: payload.password,
          data: {
            name: payload.name,
            role: "athlete",
            sport: payload.sport || "Por definir",
            category: payload.category || "",
            location: payload.location || "",
            stats: payload.stats || ""
          }
        })
      });
      const accessToken = auth.session?.access_token || auth.access_token;
      const authUser = auth.user || auth;
      if (!accessToken || !authUser?.id) {
        await request("/rest/v1/athletes", {
          method: "POST",
          headers: { ...headers(), Prefer: "return=minimal" },
          body: JSON.stringify({
            email: normalizedEmail,
            name: payload.name,
            sport: payload.sport || "Por definir",
            category: payload.category || "",
            location: payload.location || "",
            ranking: "",
            stats: payload.stats || "",
            annual: athleteAnnualFeeAmount,
            annual_fee_required: false,
            monthly: 5000,
            max_sponsors: 10,
            scout_code: makeScoutCode(payload.name, normalizedEmail),
            scout_active: false,
            invited_by_scout_code: payload.scoutCode,
            scout_terms_accepted: false,
            annual_fee_paid: false,
            scout_validation_status: "pending",
            scout_commission_status: "pending",
            birth_date: birthDate,
            age_status: payload.isMinor ? "minor" : "adult",
            guardian_name: payload.isMinor ? payload.guardianName : "",
            guardian_email: payload.isMinor ? payload.guardianEmail : "",
            guardian_phone: payload.isMinor ? payload.guardianPhone : "",
            guardian_relationship: payload.isMinor ? payload.guardianRelationship : "",
            guardian_consent: Boolean(payload.guardianConsent),
            legal_status: payload.isMinor ? "minor_guardian_review" : "adult_self_registered",
            registration_terms_accepted: Boolean(payload.termsAccepted),
            terms_accepted: false,
            status: "approved",
            visual_status: "approved"
          })
        });
        return { confirmed: false, email: normalizedEmail };
      }
      let existingProfiles = await request(`/rest/v1/profiles?select=id,email,role,name,status&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`, {
        headers: headers(accessToken)
      });
      let existingProfile = existingProfiles[0] || null;
      const profileRecord = {
        id: authUser.id,
        email: normalizedEmail,
        role: "athlete",
        name: payload.name,
        status: "approved",
        must_change_password: false
      };
      if (existingProfile?.id) {
        await request(`/rest/v1/profiles?email=eq.${encodeURIComponent(normalizedEmail)}`, {
          method: "PATCH",
          headers: { ...headers(accessToken), Prefer: "return=minimal" },
          body: JSON.stringify({
            role: "athlete",
            name: payload.name,
            status: "approved",
            must_change_password: false
          })
        });
      } else {
        try {
          await request("/rest/v1/profiles?on_conflict=email", {
            method: "POST",
            headers: { ...headers(accessToken), Prefer: "resolution=merge-duplicates,return=representation" },
            body: JSON.stringify(profileRecord)
          });
        } catch (profileError) {
          const profileMessage = typeof profileError?.message === "string" ? profileError.message : JSON.stringify(profileError);
          if (!profileMessage.includes("23505") && !profileMessage.includes("profiles_email_key")) throw profileError;
          await request(`/rest/v1/profiles?email=eq.${encodeURIComponent(normalizedEmail)}`, {
            method: "PATCH",
            headers: { ...headers(accessToken), Prefer: "return=minimal" },
            body: JSON.stringify({
              role: "athlete",
              name: payload.name,
              status: "approved",
              must_change_password: false
            })
          });
        }
        existingProfiles = await request(`/rest/v1/profiles?select=id,email,role,name,status&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`, {
          headers: headers(accessToken)
        });
        existingProfile = existingProfiles[0] || null;
      }
      const athleteProfileId = existingProfile?.id || authUser.id;
      const athleteRecord = {
        profile_id: athleteProfileId,
        email: normalizedEmail,
        name: payload.name,
        sport: payload.sport || "Por definir",
        category: payload.category || "",
        location: payload.location || "",
        ranking: "",
        stats: payload.stats || "",
        annual: athleteAnnualFeeAmount,
        annual_fee_required: false,
        monthly: 5000,
        max_sponsors: 10,
        scout_code: makeScoutCode(payload.name, normalizedEmail),
        scout_active: false,
        invited_by_scout_code: payload.scoutCode,
        scout_terms_accepted: false,
        annual_fee_paid: false,
        scout_validation_status: "pending",
        scout_commission_status: "pending",
        birth_date: birthDate,
        age_status: payload.isMinor ? "minor" : "adult",
        guardian_name: payload.isMinor ? payload.guardianName : "",
        guardian_email: payload.isMinor ? payload.guardianEmail : "",
        guardian_phone: payload.isMinor ? payload.guardianPhone : "",
        guardian_relationship: payload.isMinor ? payload.guardianRelationship : "",
        guardian_consent: Boolean(payload.guardianConsent),
        legal_status: payload.isMinor ? "minor_guardian_review" : "adult_self_registered",
        registration_terms_accepted: Boolean(payload.termsAccepted),
        terms_accepted: false,
        status: "approved",
        visual_status: "approved"
      };
      try {
        await request("/rest/v1/athletes?on_conflict=email", {
          method: "POST",
          headers: { ...headers(accessToken), Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(athleteRecord)
        });
      } catch (athleteError) {
        const existingAthletes = await request(`/rest/v1/athletes?select=id&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`, {
          headers: headers(accessToken)
        });
        if (existingAthletes.length) {
          await request(`/rest/v1/athletes?id=eq.${existingAthletes[0].id}`, {
            method: "PATCH",
            headers: { ...headers(accessToken), Prefer: "return=minimal" },
            body: JSON.stringify(athleteRecord)
          });
        } else {
          await request("/rest/v1/athletes", {
            method: "POST",
            headers: { ...headers(accessToken), Prefer: "return=minimal" },
            body: JSON.stringify(athleteRecord)
          });
        }
      }
      mergeLoadedData(await this.loadRoleData("athlete", { id: athleteProfileId, email: normalizedEmail, token: accessToken }));
      return {
        confirmed: true,
        session: { id: athleteProfileId, authId: authUser.id, email: normalizedEmail, role: "athlete", name: payload.name, token: accessToken, mustChangePassword: false }
      };
    },
    async signupFounder(payload) {
      const normalizedEmail = String(payload.email || "").trim().toLowerCase();
      const auth = await request("/auth/v1/signup", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          email: normalizedEmail,
          password: payload.password,
          data: {
            name: payload.name,
            role: "founder",
            profile_type: "founder",
            vertical: "founder",
            creator_type: payload.creatorType || "founder",
            public_name: payload.publicName || payload.name,
            venture_name: payload.ventureName || "",
            industry: payload.industry || "Contenido y entretenimiento",
            stage: payload.stage || "En desarrollo",
            city: payload.city || "Por definir",
            stats: payload.stats || "",
            invited_by_scout_code: normalizeScoutCode(payload.scoutCode)
          }
        })
      });
      const accessToken = auth.session?.access_token || auth.access_token;
      const authUser = auth.user || auth;
      if (!accessToken || !authUser?.id) {
        return { confirmed: false, email: normalizedEmail };
      }
      const profile = await this.ensureFounderAccount({ user: authUser, access_token: accessToken }, payload);
      mergeLoadedData(await this.loadRoleData("founder", { id: profile.id, email: normalizedEmail, token: accessToken }));
      return {
        confirmed: true,
        session: { id: profile.id, authId: authUser.id, email: normalizedEmail, role: "founder", name: profile.name, token: accessToken, mustChangePassword: false }
      };
    },
    async resendSignup(email) {
      await request("/auth/v1/resend", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          type: "signup",
          email,
          options: {
            email_redirect_to: window.location.origin + window.location.pathname
          }
        })
      });
      return { email };
    },
    async recoverPassword(email) {
      await request("/auth/v1/recover", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          email,
          options: {
            email_redirect_to: window.location.origin + window.location.pathname
          }
        })
      });
      return { email };
    },
    async recoverySessionFromTokenHash(tokenHash) {
      const auth = await request("/auth/v1/verify", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          type: "recovery",
          token_hash: tokenHash
        })
      });
      const accessToken = auth.session?.access_token || auth.access_token;
      if (!accessToken) throw new Error("Recovery token invalid");
      return this.recoverySession(accessToken);
    },
    async recoverySession(accessToken) {
      const user = await request("/auth/v1/user", {
        headers: headers(accessToken)
      });
      const normalizedEmail = String(user.email || "").trim().toLowerCase();
      let profiles = [];
      try {
        profiles = await request(`/rest/v1/profiles?select=id,email,role,name,status,must_change_password&id=eq.${user.id}&limit=1`, {
          headers: headers(accessToken)
        });
      } catch (error) {
        profiles = [];
      }
      if (!profiles.length) {
        try {
          profiles = await request(`/rest/v1/profiles?select=id,email,role,name,status,must_change_password&email=eq.${encodeURIComponent(user.email)}&limit=1`, {
            headers: headers(accessToken)
          });
        } catch (error) {
          profiles = [];
        }
      }
      let profile = profiles[0] || null;
      if (!profile) {
        try {
          const authRole = String(user.user_metadata?.role || "").toLowerCase();
          profile = authRole === "founder"
            ? await this.ensureFounderAccount({ user, access_token: accessToken })
            : authRole === "athlete"
              ? await this.ensureAthleteAccount({ user, access_token: accessToken })
              : await this.ensureClientAccount({ user, access_token: accessToken });
        } catch (error) {
          profile = {
            id: user.id,
            email: normalizedEmail,
            role: user.user_metadata?.role === "founder" ? "founder" : user.user_metadata?.role === "athlete" ? "athlete" : "client",
            name: user.user_metadata?.name || normalizedEmail.split("@")[0] || "Perfil ROIS",
            status: "approved",
            must_change_password: true
          };
        }
      }
      let companies = [];
      try {
        companies = await request(`/rest/v1/companies?select=id&contact=eq.${encodeURIComponent(user.email)}&limit=1`, {
          headers: headers(accessToken)
        });
      } catch (error) {
        companies = [];
      }
      const role = profile.role === "founder" ? "founder" : profile.role === "athlete" ? "athlete" : companies.length ? "client" : normalizedRole(normalizedEmail, profile.role);
      return { id: profile.id || user.id, authId: user.id, email: normalizedEmail, role, name: profile.name || user.user_metadata?.name || normalizedEmail.split("@")[0] || "Perfil ROIS", token: accessToken, mustChangePassword: true };
    },
    async ensureClientAccount(auth, fallback = {}) {
      const token = auth.access_token || auth.session?.access_token;
      const normalizedEmail = String(auth.user.email || "").trim().toLowerCase();
      const meta = auth.user.user_metadata || {};
      const company = fallback.company || meta.company_name || meta.name || normalizedEmail.split("@")[0];
      const contact = fallback.contact || meta.contact_name || company;
      const interest = fallback.interest || meta.interest || "Relaciones estrat\u00e9gicas";
      let existingProfiles = await request(`/rest/v1/profiles?select=id,email,role,name,status&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`, {
        headers: headers(token)
      });
      let resolvedProfile = existingProfiles[0] || null;
      const profileRecord = {
        id: auth.user.id,
        email: normalizedEmail,
        role: "client",
        name: company,
        status: "approved",
        must_change_password: false
      };
      if (resolvedProfile?.id) {
        await request(`/rest/v1/profiles?email=eq.${encodeURIComponent(normalizedEmail)}`, {
          method: "PATCH",
          headers: { ...headers(token), Prefer: "return=minimal" },
          body: JSON.stringify({
            role: "client",
            name: company,
            status: "approved",
            must_change_password: false
          })
        });
      } else {
        try {
          await request("/rest/v1/profiles?on_conflict=email", {
            method: "POST",
            headers: { ...headers(token), Prefer: "resolution=merge-duplicates,return=representation" },
            body: JSON.stringify(profileRecord)
          });
        } catch (profileError) {
          const profileMessage = typeof profileError?.message === "string" ? profileError.message : JSON.stringify(profileError);
          if (!profileMessage.includes("23505") && !profileMessage.includes("profiles_email_key")) throw profileError;
          await request(`/rest/v1/profiles?email=eq.${encodeURIComponent(normalizedEmail)}`, {
            method: "PATCH",
            headers: { ...headers(token), Prefer: "return=minimal" },
            body: JSON.stringify({
              role: "client",
              name: company,
              status: "approved",
              must_change_password: false
            })
          });
        }
        existingProfiles = await request(`/rest/v1/profiles?select=id,email,role,name,status&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`, {
          headers: headers(token)
        });
        resolvedProfile = existingProfiles[0] || null;
      }
      const existingCompanies = await request(`/rest/v1/companies?select=id,profile_id&contact=eq.${encodeURIComponent(normalizedEmail)}&limit=1`, {
        headers: headers(token)
      });
      if (!existingCompanies.length) {
        await request("/rest/v1/companies", {
          method: "POST",
          headers: { ...headers(token), Prefer: "return=minimal" },
          body: JSON.stringify({ profile_id: resolvedProfile?.id || auth.user.id, name: company, contact: normalizedEmail, owner: contact, interest, status: "approved" })
        });
        await request("/rest/v1/crm", {
          method: "POST",
          headers: { ...headers(token), Prefer: "return=minimal" },
          body: JSON.stringify({ name: company, volume: 0, status: "Nuevo cliente" })
        });
      } else if (!existingCompanies[0].profile_id) {
        await request(`/rest/v1/companies?id=eq.${existingCompanies[0].id}`, {
          method: "PATCH",
          headers: { ...headers(token), Prefer: "return=minimal" },
          body: JSON.stringify({ profile_id: resolvedProfile?.id || auth.user.id })
        });
      }
      return {
        ...(resolvedProfile || profileRecord),
        id: resolvedProfile?.id || auth.user.id,
        email: normalizedEmail,
        role: "client",
        name: company,
        status: "approved",
        must_change_password: false
      };
    },
    async ensureAthleteAccount(auth, options = {}) {
      const token = auth.access_token || auth.session?.access_token;
      const normalizedEmail = String(auth.user.email || "").trim().toLowerCase();
      const meta = auth.user.user_metadata || {};
      const name = meta.name || normalizedEmail.split("@")[0];
      let existingProfiles = await request(`/rest/v1/profiles?select=id,email,role,name,status&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`, {
        headers: headers(token)
      });
      let resolvedProfile = existingProfiles[0] || null;
      const profileRecord = {
        id: auth.user.id,
        email: normalizedEmail,
        role: "athlete",
        name,
        status: "approved",
        must_change_password: false
      };
      if (resolvedProfile?.id) {
        await request(`/rest/v1/profiles?email=eq.${encodeURIComponent(normalizedEmail)}`, {
          method: "PATCH",
          headers: { ...headers(token), Prefer: "return=minimal" },
          body: JSON.stringify({
            role: "athlete",
            name,
            status: "approved",
            must_change_password: false
          })
        });
      } else {
        try {
          await request("/rest/v1/profiles?on_conflict=email", {
            method: "POST",
            headers: { ...headers(token), Prefer: "resolution=merge-duplicates,return=representation" },
            body: JSON.stringify(profileRecord)
          });
        } catch (profileError) {
          const profileMessage = typeof profileError?.message === "string" ? profileError.message : JSON.stringify(profileError);
          if (!profileMessage.includes("23505") && !profileMessage.includes("profiles_email_key")) throw profileError;
          await request(`/rest/v1/profiles?email=eq.${encodeURIComponent(normalizedEmail)}`, {
            method: "PATCH",
            headers: { ...headers(token), Prefer: "return=minimal" },
            body: JSON.stringify({
              role: "athlete",
              name,
              status: "approved",
              must_change_password: false
            })
          });
        }
        existingProfiles = await request(`/rest/v1/profiles?select=id,email,role,name,status&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`, {
          headers: headers(token)
        });
        resolvedProfile = existingProfiles[0] || null;
      }
      const athleteProfileId = resolvedProfile?.id || auth.user.id;
      if (options.forceRole) {
        try {
          await request(`/rest/v1/profiles?email=eq.${encodeURIComponent(normalizedEmail)}`, {
            method: "PATCH",
            headers: { ...headers(token), Prefer: "return=minimal" },
            body: JSON.stringify({ role: "athlete", name, status: "approved", must_change_password: false })
          });
        } catch (error) {
          // If RLS blocks the self-update, the manual admin SQL below will own the role correction.
        }
      }
      const existingAthletes = await request(`/rest/v1/athletes?select=id&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`, {
        headers: headers(token)
      });
      if (options.forceRole && existingAthletes.length) {
        try {
          await request(`/rest/v1/athletes?id=eq.${existingAthletes[0].id}`, {
            method: "PATCH",
            headers: { ...headers(token), Prefer: "return=minimal" },
            body: JSON.stringify({ profile_id: athleteProfileId, status: "approved", visual_status: "approved", annual: 0 })
          });
        } catch (error) {
          // The admin SQL can repair older records if RLS blocks this update.
        }
      }
      if (!existingAthletes.length) {
        await request("/rest/v1/athletes", {
          method: "POST",
          headers: { ...headers(token), Prefer: "return=minimal" },
          body: JSON.stringify({
            profile_id: athleteProfileId,
            email: normalizedEmail,
            name,
            sport: meta.sport || "Por definir",
            category: meta.category || "",
            location: meta.location || "",
            ranking: meta.ranking || "",
            annual: athleteAnnualFeeAmount,
            annual_fee_required: false,
            monthly: 5000,
            max_sponsors: 10,
            scout_code: makeScoutCode(name, normalizedEmail),
            scout_active: false,
            annual_fee_paid: false,
            scout_validation_status: "pending",
            scout_commission_status: "pending",
            status: "approved",
            visual_status: "approved",
            terms_accepted: true
          })
        });
      }
      return {
        ...(resolvedProfile || profileRecord),
        id: athleteProfileId,
        email: normalizedEmail,
        role: "athlete",
        name,
        status: "approved",
        must_change_password: false
      };
    },
    async ensureFounderAccount(auth, options = {}) {
      const token = auth.access_token || auth.session?.access_token;
      const normalizedEmail = String(auth.user.email || options.email || "").trim().toLowerCase();
      const meta = auth.user.user_metadata || {};
      const name = options.name || meta.name || normalizedEmail.split("@")[0] || "Creador ROIS";
      const ventureName = options.ventureName || meta.venture_name || "";
      const creatorType = options.creatorType || meta.creator_type || "founder";
      const publicName = options.publicName || meta.public_name || name;
      const industry = options.industry || meta.industry || "Contenido y entretenimiento";
      const stage = options.stage || meta.stage || "En desarrollo";
      const city = options.city || meta.city || "Por definir";
      const stats = options.stats || meta.stats || `${creatorTypeLabel(creatorType)} ROIS. Proyecto: ${ventureName || "Por definir"}. Categoria: ${industry}. Etapa: ${stage}. Ciudad: ${city}.`;
      const registrationScoutCode = normalizeScoutCode(options.scoutCode || "");
      let existingProfiles = await request(`/rest/v1/profiles?select=id,email,role,name,status&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`, {
        headers: headers(token)
      });
      let resolvedProfile = existingProfiles[0] || null;
      const profileRecord = {
        id: auth.user.id,
        email: normalizedEmail,
        role: "founder",
        name,
        status: "approved",
        must_change_password: false
      };
      if (resolvedProfile?.id) {
        await request(`/rest/v1/profiles?email=eq.${encodeURIComponent(normalizedEmail)}`, {
          method: "PATCH",
          headers: { ...headers(token), Prefer: "return=minimal" },
          body: JSON.stringify({
            role: "founder",
            name,
            status: "approved",
            must_change_password: false
          })
        });
      } else {
        try {
          await request("/rest/v1/profiles?on_conflict=email", {
            method: "POST",
            headers: { ...headers(token), Prefer: "resolution=merge-duplicates,return=representation" },
            body: JSON.stringify(profileRecord)
          });
        } catch (profileError) {
          const profileMessage = typeof profileError?.message === "string" ? profileError.message : JSON.stringify(profileError);
          if (!profileMessage.includes("23505") && !profileMessage.includes("profiles_email_key")) throw profileError;
          await request(`/rest/v1/profiles?email=eq.${encodeURIComponent(normalizedEmail)}`, {
            method: "PATCH",
            headers: { ...headers(token), Prefer: "return=minimal" },
            body: JSON.stringify({
              role: "founder",
              name,
              status: "approved",
              must_change_password: false
            })
          });
        }
        existingProfiles = await request(`/rest/v1/profiles?select=id,email,role,name,status&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`, {
          headers: headers(token)
        });
        resolvedProfile = existingProfiles[0] || null;
      }
      const founderProfileId = resolvedProfile?.id || auth.user.id;
      const founderRecord = {
        profile_id: founderProfileId,
        email: normalizedEmail,
        name,
        venture_name: ventureName,
        industry,
        stage,
        city,
        stats,
        creator_type: creatorType,
        public_name: publicName,
        content_categories: options.contentCategories || meta.content_categories || "",
        primary_platform: options.primaryPlatform || meta.primary_platform || "",
        audience_size: Number(options.audienceSize || meta.audience_size || 0),
        engagement_rate: Number(options.engagementRate || meta.engagement_rate || 0),
        audience_location: options.audienceLocation || meta.audience_location || "",
        brand_categories: options.brandCategories || meta.brand_categories || "",
        availability: options.availability || meta.availability || "available",
        monthly: 2500,
        max_sponsors: 10,
        scout_code: makeScoutCode(name, normalizedEmail),
        scout_active: false,
        ...(registrationScoutCode ? {
          invited_by_scout_code: registrationScoutCode,
          scout_validation_status: "pending",
          scout_commission_status: "pending"
        } : {}),
        status: "approved",
        visual_status: "approved"
      };
      try {
        await request("/rest/v1/founders?on_conflict=email", {
          method: "POST",
          headers: { ...headers(token), Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(founderRecord)
        });
      } catch (founderError) {
        const existingFounders = await request(`/rest/v1/founders?select=id&email=eq.${encodeURIComponent(normalizedEmail)}&limit=1`, {
          headers: headers(token)
        });
        if (existingFounders.length) {
          await request(`/rest/v1/founders?id=eq.${existingFounders[0].id}`, {
            method: "PATCH",
            headers: { ...headers(token), Prefer: "return=minimal" },
            body: JSON.stringify(founderRecord)
          });
        } else {
          await request("/rest/v1/founders", {
            method: "POST",
            headers: { ...headers(token), Prefer: "return=minimal" },
            body: JSON.stringify(founderRecord)
          });
        }
      }
      return {
        ...(resolvedProfile || profileRecord),
        id: founderProfileId,
        email: normalizedEmail,
        role: "founder",
        name,
        status: "approved",
        must_change_password: false
      };
    },
    async insert(table, record) {
      const rows = await request(`/rest/v1/${table}`, {
        method: "POST",
        headers: { ...headers(), Prefer: "return=representation" },
        body: JSON.stringify(record)
      });
      const inserted = Array.isArray(rows) ? rows[0] : rows;
      if (inserted) replaceRecordInState(table, inserted);
      return inserted;
    },
    async update(table, id, patch) {
      const rows = await request(`/rest/v1/${table}?id=eq.${id}`, {
        method: "PATCH",
        headers: { ...headers(), Prefer: "return=representation" },
        body: JSON.stringify(patch)
      });
      const updated = rows?.[0];
      if (updated) replaceRecordInState(table, updated);
      return updated;
    },
    async remove(table, id) {
      await request(`/rest/v1/${table}?id=eq.${id}`, {
        method: "DELETE",
        headers: { ...headers(), Prefer: "return=minimal" }
      });
      removeRecordFromState(table, id);
      return true;
    },
    async upsert(table, record) {
      const rows = await request(`/rest/v1/${table}?on_conflict=id`, {
        method: "POST",
        headers: { ...headers(), Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(record)
      });
      const updated = rows?.[0];
      if (updated) replaceRecordInState(table, updated);
      return updated;
    },
    async upsertByEmail(table, record) {
      const email = String(record.email || record.contact || "").trim().toLowerCase();
      if (!email) throw new Error("No encontramos el correo autenticado del perfil.");
      let existing = record.profile_id
        ? await request(`/rest/v1/${table}?select=id&profile_id=eq.${encodeURIComponent(record.profile_id)}&limit=1`, { headers: headers() })
        : [];
      if (!existing.length) {
        existing = await request(`/rest/v1/${table}?select=id&email=eq.${encodeURIComponent(email)}&limit=1`, { headers: headers() });
      }
      if (!existing.length && table === "athletes") {
        existing = await request(`/rest/v1/athletes?select=id&contact=eq.${encodeURIComponent(email)}&limit=1`, { headers: headers() });
      }
      const path = existing.length ? `/rest/v1/${table}?id=eq.${existing[0].id}` : `/rest/v1/${table}`;
      const rows = await request(path, {
        method: existing.length ? "PATCH" : "POST",
        headers: { ...headers(), Prefer: "return=representation" },
        body: JSON.stringify({ ...record, email })
      });
      const updated = rows?.[0];
      if (updated) replaceRecordInState(table, updated);
      return updated;
    },
    async changePassword(session, password) {
      await request("/auth/v1/user", {
        method: "PUT",
        headers: headers(session.token),
        body: JSON.stringify({ password })
      });
      await request(`/rest/v1/profiles?id=eq.${session.id}`, {
        method: "PATCH",
        headers: { ...headers(session.token), Prefer: "return=minimal" },
        body: JSON.stringify({ must_change_password: false })
      });
      const profile = (state.data?.profiles || []).find(item => item.id === session.id);
      if (profile) replaceRecordInState("profiles", { ...profile, must_change_password: false });
      return { ...session, mustChangePassword: false };
    }
  };
}

function bindGlobalEvents() {
  document.querySelectorAll("[data-open-login]").forEach(button => button.addEventListener("click", openLogin));
  document.querySelectorAll("[data-close-modal]").forEach(button => button.addEventListener("click", closeModalFromButton));
  document.querySelectorAll("[data-dashboard-target]").forEach(button => button.addEventListener("click", () => showDashboardPanel(button.dataset.dashboardTarget)));
  document.querySelectorAll("[data-mobile-menu]").forEach(button => button.addEventListener("click", () => openMobileDashboardMenu(button.dataset.mobileMenu)));
  document.querySelectorAll("[data-close-mobile-menu]").forEach(button => button.addEventListener("click", closeMobileDashboardMenus));
  document.querySelectorAll("[data-registration]").forEach(button => button.addEventListener("click", () => openRegistration(button.dataset.registration)));
  document.querySelector("[data-open-recovery]").addEventListener("click", toggleRecoveryForm);
  document.getElementById("loginForm").addEventListener("submit", submitLogin);
  document.getElementById("recoveryForm").addEventListener("submit", submitPasswordRecovery);
  document.getElementById("passwordForm").addEventListener("submit", submitPasswordChange);
  document.getElementById("registrationForm").addEventListener("submit", submitRegistration);
  document.addEventListener("click", handleDashboardDelegatedActions);
}

function handleDashboardDelegatedActions(event) {
  const loadMoreButton = event.target.closest("[data-load-more-panel]");
  if (loadMoreButton) {
    ensureDashboardPanelData(loadMoreButton.dataset.loadMorePanel, { loadMore: true });
    return;
  }
  const logoutButton = event.target.closest("[data-logout]");
  if (logoutButton) {
    logout();
    return;
  }
  const sponsorDeckProfileButton = event.target.closest("[data-sponsor-deck-profile]");
  if (sponsorDeckProfileButton) {
    openSponsorDeckById(sponsorDeckProfileButton.dataset.sponsorDeckProfile);
    return;
  }
  const sponsorButton = event.target.closest("[data-athlete-sponsor]");
  if (sponsorButton) {
    const profileId = sponsorButton.dataset.athleteSponsor;
    const athlete = state.data?.athletes?.find(item => item.id === profileId);
    const founder = state.data?.founders?.find(item => item.id === profileId);
    const profile = athlete || (founder ? founderAsAthleteProfile(founder) : null);
    if (profile) startAthleteSponsorPayment(profile);
    return;
  }
  const profileButton = event.target.closest("[data-athlete-profile]");
  if (profileButton) {
    const profileId = profileButton.dataset.athleteProfile;
    const athlete = state.data?.athletes?.find(item => item.id === profileId);
    if (athlete) {
      openAthleteProfileView(athlete);
      return;
    }
    const founder = state.data?.founders?.find(item => item.id === profileId || item.profile_id === profileId);
    if (founder) openAthleteProfileView(founderAsAthleteProfile(founder));
    return;
  }
  const deletePostButton = event.target.closest("[data-athlete-delete-post]");
  if (deletePostButton) {
    deleteAthletePost(deletePostButton.dataset.athleteDeletePost);
    return;
  }
  const soundButton = event.target.closest("[data-reel-sound]");
  if (soundButton) {
    toggleReelSound(soundButton);
    return;
  }
  const registrationChoiceButton = event.target.closest("[data-registration-choice]");
  if (registrationChoiceButton) {
    openRegistrationChoice(registrationChoiceButton.dataset.registrationChoice);
    return;
  }
  const dashboardShortcut = event.target.closest("[data-dashboard-shortcut]");
  if (dashboardShortcut) {
    showDashboardPanel(dashboardShortcut.dataset.dashboardShortcut);
    return;
  }
  const premiumRequestButton = event.target.closest("[data-premium-request]");
  if (premiumRequestButton) {
    requestPremiumAllianceProduct(premiumRequestButton.dataset.premiumRequest);
    return;
  }
  const planRequestButton = event.target.closest("[data-company-plan-request]");
  if (planRequestButton) {
    requestCompanyPlan(planRequestButton.dataset.companyPlanRequest);
    return;
  }
  const listingInterestButton = event.target.closest("[data-company-listing-interest]");
  if (listingInterestButton) {
    requestCompanyListing(listingInterestButton.dataset.companyListingInterest);
    return;
  }
  const archiveListingButton = event.target.closest("[data-company-listing-archive]");
  if (archiveListingButton) {
    archiveCompanyListing(archiveListingButton.dataset.companyListingArchive);
    return;
  }
  const requestScoutButton = event.target.closest("[data-request-scout-code]");
  if (requestScoutButton) {
    requestScoutCode();
    return;
  }
}

function showView(name) {
  document.body.dataset.activeView = name;
  document.querySelectorAll("[data-view]").forEach(view => view.classList.toggle("active", view.dataset.view === name));
  if (name === "client") {
    renderClient();
    ensureDashboardHydrated("client", { maxAgeMs: dashboardFreshnessMs });
  }
  if (name === "athlete") {
    renderAthlete();
    ensureDashboardHydrated(state.session?.role === "founder" ? "founder" : "athlete", { maxAgeMs: dashboardFreshnessMs });
  }
  if (name === "admin") {
    renderAdmin();
    ensureDashboardHydrated("admin", { maxAgeMs: dashboardFreshnessMs }).then(success => {
      adminDataHydrated = success;
    });
  }
  optimizeRenderedMedia();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showDashboardPanel(targetId) {
  const targetPanel = document.querySelector(`[data-dashboard-panel="${targetId}"]`);
  if (!targetPanel) return;
  const workspace = targetPanel.closest("[data-dashboard]");
  const nav = document.querySelector(`[data-dashboard-nav="${workspace.dataset.dashboard}"]`);
  workspace.querySelectorAll("[data-dashboard-panel]").forEach(panel => panel.classList.toggle("active", panel === targetPanel));
  nav.querySelectorAll("[data-dashboard-target]").forEach(button => button.classList.toggle("active", button.dataset.dashboardTarget === targetId));
  renderDashboardPanelById(targetId);
  optimizeRenderedMedia(targetPanel);
  closeMobileDashboardMenus();
  const role = workspace.dataset.dashboard === "athlete"
    ? (state.session?.role === "founder" ? "founder" : "athlete")
    : workspace.dataset.dashboard === "client"
      ? "client"
      : workspace.dataset.dashboard === "admin"
        ? "admin"
        : null;
  const shouldHydrateRole = role && !(role === "admin" && hydratedRoles.has("admin"));
  const hydration = shouldHydrateRole
    ? ensureDashboardHydrated(role, { maxAgeMs: dashboardFreshnessMs })
    : Promise.resolve(true);
  hydration.then(() => ensureDashboardPanelData(targetId, { maxAgeMs: dashboardPanelFreshnessMs }));
}

function renderDashboardPanelById(targetId) {
  if (targetId.startsWith("client-")) renderClientPanel(targetId);
  if (targetId.startsWith("athlete-")) renderAthletePanel(targetId);
  if (targetId.startsWith("admin-")) renderAdminPanel(targetId);
  decoratePanelPagination(targetId);
}

function openMobileDashboardMenu(type) {
  closeMobileDashboardMenus();
  const viewName = type === "admin" ? "admin" : type === "athlete" ? "athlete" : "client";
  const view = document.querySelector(`[data-view="${viewName}"]`);
  view?.classList.add("nav-open");
}

function closeMobileDashboardMenus() {
  document.querySelectorAll(".dashboard.nav-open").forEach(view => view.classList.remove("nav-open"));
}

async function submitLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const loginResult = await withTimeout(
      api.login(form.email.value, form.password.value),
      operationTimeoutMs,
      "La red esta tardando demasiado al iniciar sesion."
    );
    const { bootstrapData, ...session } = loginResult;
    if (session.mustChangePassword) {
      state.pendingSession = session;
      state.session = null;
      clearSession();
      closeModals();
      renderSession();
      showView("home");
      document.getElementById("passwordModal").classList.add("active");
      return;
    }
    state.session = session;
    hydratedRoles.clear();
    lastHydratedAtByRole.clear();
    resetDashboardPanelState();
    state.data = normalizeLoadedData(bootstrapData || {});
    state.dataSignature = runtimeDataSignature(state.data);
    writeDataCache(state.data, state.session);
    saveSession(state.session);
    closeModals();
    renderSession();
    showView(dashboardViewForRole(state.session.role));
  } catch (error) {
    if (String(error.message).toLowerCase().includes("email not confirmed")) {
      showVerificationNotice(form.email.value);
      return;
    }
    notify("Acceso", "No fue posible iniciar sesi\u00f3n", humanError(error));
  }
}

function toggleRecoveryForm() {
  const form = document.getElementById("recoveryForm");
  form.hidden = !form.hidden;
  if (!form.hidden) form.email.focus();
}

async function submitPasswordRecovery(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api.recoverPassword(form.email.value);
    notify("Recuperaci\u00f3n", "Correo enviado", "Si el correo existe en ROIS, recibir\u00e1 un enlace para restablecer la contrase\u00f1a.");
    form.reset();
    form.hidden = true;
    closeModals();
  } catch (error) {
    notify("Recuperaci\u00f3n", "No fue posible enviar el enlace", humanError(error));
  }
}

async function submitPasswordChange(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (form.password.value !== form.confirm.value) {
    notify("Contrase\u00f1a", "Las contrase\u00f1as no coinciden", "Confirma la nueva contrase\u00f1a para continuar.");
    return;
  }
  if (!state.pendingSession) {
    notify("Contrase\u00f1a", "Sesi\u00f3n no encontrada", "Inicia sesi\u00f3n nuevamente para cambiar la contrase\u00f1a.");
    return;
  }
  try {
    state.session = await api.changePassword(state.pendingSession, form.password.value);
    state.pendingSession = null;
    saveSession(state.session);
    form.reset();
    closeModals();
    renderSession();
    showView(dashboardViewForRole(state.session.role));
  } catch (error) {
    notify("Contrase\u00f1a", "No fue posible cambiarla", error.message);
  }
}

async function submitSettingsPassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (form.password.value !== form.confirm.value) {
    notify("Configuraci\u00f3n", "Las contrase\u00f1as no coinciden", "Confirma la nueva contrase\u00f1a para actualizarla.");
    return;
  }
  try {
    state.session = await api.changePassword(state.session, form.password.value);
    saveSession(state.session);
    form.reset();
    notify("Configuraci\u00f3n", "Contrase\u00f1a actualizada", "El cambio qued\u00f3 aplicado correctamente.");
  } catch (error) {
    notify("Configuraci\u00f3n", "No fue posible cambiarla", humanError(error));
  }
}

async function submitCompanyProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const company = currentCompany();
  if (!company) {
    notify("Empresa", "No encontramos tu cuenta", "Vuelve a iniciar sesi\u00f3n para actualizar tu perfil.");
    return;
  }
  try {
    const logoFile = form.logo.files[0];
    const patch = {
      name: form.name.value.trim(),
      owner: form.owner.value.trim(),
      interest: form.interest.value,
      website: form.website.value.trim(),
      description: form.description.value.trim()
    };
    if (logoFile) patch.logo_url = await fileToDataUrl(logoFile);
    await api.update("companies", company.id, patch);
    state.session = { ...state.session, name: patch.name };
    saveSession(state.session);
    renderSession();
    renderClient();
    notify("Empresa", "Perfil actualizado", logoFile ? "El logotipo y la informaci\u00f3n de tu empresa quedaron guardados." : "La informaci\u00f3n de tu empresa qued\u00f3 guardada.");
  } catch (error) {
    notify("Empresa", "No fue posible guardar", humanError(error));
  }
}

function logout() {
  const activeCacheKey = dataCacheStorageKey(state.session);
  state.session = null;
  hydratedRoles.clear();
  lastHydratedAtByRole.clear();
  dashboardHydrationPromise = null;
  dashboardHydrationRole = null;
  resetDashboardPanelState();
  adminDataHydrated = false;
  sessionStorage.removeItem(activeCacheKey);
  clearSession();
  renderSession();
  showView("home");
}

function openLogin() {
  document.getElementById("loginModal").classList.add("active");
}

function closeModals() {
  document.querySelectorAll(".modal").forEach(modal => {
    modal.classList.remove("active");
    modal.classList.remove("profile-modal");
    modal.classList.remove("sponsor-deck-modal");
  });
}

function closeModalFromButton(event) {
  const modal = event.currentTarget.closest(".modal");
  const registrationModal = document.getElementById("registrationModal");
  if (modal?.id === "actionModal" && registrationModal?.classList.contains("active")) {
    modal.classList.remove("active");
    modal.classList.remove("profile-modal");
    modal.classList.remove("sponsor-deck-modal");
    return;
  }
  closeModals();
}

function notify(kicker, title, text, actions = "") {
  document.getElementById("actionKicker").textContent = kicker;
  document.getElementById("actionTitle").textContent = title;
  document.getElementById("actionText").textContent = text;
  document.getElementById("actionActions").innerHTML = actions;
  document.getElementById("actionModal").classList.add("active");
}

function openRegistrationChoice(context = "profile") {
  const copy = context === "athlete-profile"
    ? "Para ver perfiles completos y solicitar patrocinios necesitas una cuenta empresarial. Si eres deportista, crea tu perfil para entrar al ecosistema ROIS."
    : "Elige el perfil que mejor representa tu actividad. Te llevaremos directamente al registro correspondiente.";
  notify(
    "Registro ROIS",
    "Selecciona tu tipo de cuenta",
    copy,
    `<div class="modal-actions">
      <button class="btn primary" type="button" data-registration="company">Empresa</button>
      <button class="btn" type="button" data-registration="athlete">Athlete</button>
      <button class="btn" type="button" data-registration="founder">Creador</button>
    </div>`
  );
  document.querySelectorAll("#actionModal [data-registration]").forEach(button => {
    button.addEventListener("click", () => {
      closeModals();
      openRegistration(button.dataset.registration);
    });
  });
}

function showVerificationNotice(email) {
  notify(
    "Verificaci\u00f3n",
    "Confirma tu correo",
    `Enviamos un enlace de verificaci\u00f3n a ${email}. Si no lo recibiste, revisa spam o solicita un nuevo env\u00edo.`,
    `<button class="btn primary full" type="button" id="resendVerificationButton">Reenviar correo de verificaci\u00f3n</button>`
  );
  document.getElementById("resendVerificationButton").addEventListener("click", () => resendVerificationEmail(email));
}

async function resendVerificationEmail(email) {
  try {
    await api.resendSignup(email);
    notify("Verificaci\u00f3n", "Correo reenviado", `Enviamos nuevamente el enlace de verificaci\u00f3n a ${email}.`);
  } catch (error) {
    notify("Verificaci\u00f3n", "No se pudo reenviar", humanError(error));
  }
}

function stripeLink(key) {
  return config.stripePaymentLinks?.[key] || "";
}

function openStripeCheckout(key, title) {
  const link = stripeLink(key);
  if (!link) {
    notify("Stripe", "Link pendiente", `Falta configurar el link de pago para ${title}.`);
    return false;
  }
  notify("Stripe", "Checkout abierto", `Completa el pago de ${title} en Stripe para continuar el proceso.`);
  const checkout = window.open(link, "_blank");
  if (checkout) {
    checkout.opener = null;
  } else {
    window.location.href = link;
  }
  return true;
}

function openExternalUrl(url, title) {
  if (!url) {
    notify("ROIS", "Link pendiente", `Falta configurar el link para ${title}.`);
    return false;
  }
  const target = window.open(url, "_blank");
  if (target) {
    target.opener = null;
  } else {
    window.location.href = url;
  }
  return true;
}

function registrationPaymentConfig(type, payload = {}) {
  if (type === "founder") {
    return {
      productKey: "founderMonthlyMembership",
      title: "Membresia mensual Creador ROIS",
      concept: "Membresia mensual Creador ROIS",
      amount: 2500,
      payer: payload.name || payload.email || "Creador ROIS"
    };
  }

  if (type === "athlete") {
    return {
      productKey: "athleteMonthlyMembership",
      title: "Membresia mensual Athlete ROIS",
      concept: "Membresia mensual Athlete ROIS",
      amount: 2500,
      payer: payload.name || payload.email || "Athlete ROIS"
    };
  }

  return null;
}

function eventSuccessFeeOptions() {
  return [
    {
      value: "listing_5",
      label: "Listing / Publicacion - 5%",
      rate: 5,
      description: "ROIS publica el evento y permite solicitudes entrantes de empresas interesadas."
    },
    {
      value: "introduction_10",
      label: "Sponsor Introduction - 10%",
      rate: 10,
      description: "ROIS presenta empresas calificadas y facilita la conexion inicial."
    },
    {
      value: "development_15",
      label: "Commercial Development - 15%",
      rate: 15,
      description: "ROIS participa activamente en prospeccion, seguimiento y presentacion comercial."
    },
    {
      value: "mandate_20",
      label: "Strategic Sponsor Mandate - 20%",
      rate: 20,
      description: "ROIS participa en originacion, curaduria, negociacion, cierre y seguimiento de sponsors estrategicos."
    }
  ];
}

function eventSuccessFeeRate(value) {
  const option = eventSuccessFeeOptions().find(item => item.value === value);
  return option?.rate || 5;
}

function eventSuccessFeeLabel(value) {
  const option = eventSuccessFeeOptions().find(item => item.value === value);
  return option?.label || "Listing / Publicacion - 5%";
}

function eventSuccessFeeSelectMarkup() {
  return `
    <label style="grid-column:1/-1">
      Nivel de involucramiento ROIS
      <select name="success_fee_level" required>
        ${eventSuccessFeeOptions().map(option => `<option value="${option.value}">${option.label}</option>`).join("")}
      </select>
    </label>
    <p class="hint" style="grid-column:1/-1">
      ROIS puede participar bajo success fee del 5% al 20% sobre sponsors cerrados a traves de la plataforma o gestion comercial de ROIS. El porcentaje depende del nivel de involucramiento seleccionado.
    </p>
  `;
}

async function registerMembershipPayment(type, payload = {}) {
  const payment = registrationPaymentConfig(type, payload);
  if (!payment) return null;

  try {
    await api.insert("payments", {
      concept: payment.concept,
      amount: payment.amount,
      company: payment.payer,
      status: "pending",
      product_key: payment.productKey
    });
  } catch (error) {
    // No bloquear el registro si el log de pago falla.
  }

  return payment;
}

async function insertEventRegistrationRecord(payload) {
  const successFeeLevel = payload.success_fee_level || "listing_5";
  const successFeeRate = eventSuccessFeeRate(successFeeLevel);
  const successFeeCopy = `Success fee ROIS: ${eventSuccessFeeLabel(successFeeLevel)}. Rate: ${successFeeRate}% sobre sponsors cerrados mediante ROIS.`;
  const baseRecord = {
    ...(payload.company_id ? { company_id: payload.company_id } : {}),
    ...(payload.profile_id ? { profile_id: payload.profile_id } : {}),
    name: payload.name,
    category: payload.category,
    venue: payload.venue,
    date: payload.date,
    status: "pending",
    image_url: payload.image_url || "",
    visual_status: payload.image_url ? "pending_review" : "approved"
  };

  try {
    return await api.insert("events", {
      ...baseRecord,
      event_scope: payload.event_scope || "",
      sponsor_levels: payload.sponsor_levels || "",
      success_fee_level: successFeeLevel,
      success_fee_rate: successFeeRate
    });
  } catch (error) {
    try {
      return await api.insert("events", {
        ...baseRecord,
        event_scope: [payload.event_scope || "", successFeeCopy].filter(Boolean).join("\n\n"),
        sponsor_levels: [payload.sponsor_levels || "", `Modelo success fee ROIS: ${eventSuccessFeeLabel(successFeeLevel)}`, `Rate: ${successFeeRate}%`].filter(Boolean).join("\n")
      });
    } catch (fallbackError) {
      return api.insert("events", baseRecord);
    }
  }
}

function humanError(error) {
  const message = typeof error?.message === "string" ? error.message : JSON.stringify(error);
  if (/aborted|tardando demasiado|timeout/i.test(message)) {
    return "La red esta tardando demasiado. Revisa tu conexion e intenta nuevamente.";
  }
  if (/jwt expired|session.*expired|invalid jwt/i.test(message)) {
    return "La sesion expiro. Inicia sesion nuevamente.";
  }
  if (/payload too large|exceeds.*size|supera (3|5|15) mb/i.test(message)) {
    return message;
  }
  if (message.includes("over_email_send_rate_limit") || message.includes("email rate limit exceeded") || message.includes("429")) {
    return "Supabase limit\u00f3 temporalmente el env\u00edo de correos de verificaci\u00f3n por demasiados intentos. Para el lanzamiento, desactiva la confirmaci\u00f3n por correo en Supabase o espera unos minutos antes de intentar de nuevo.";
  }
  if (message.includes("profiles_email_key") || message.includes("23505")) {
    return "Este correo ya existe en ROIS. Inicia sesion con tu contrasena actual o usa recuperar contrasena. Si el perfil quedo incompleto, ROIS puede reactivarlo desde administracion.";
  }
  if (message.includes("user_already_exists") || message.includes("already registered")) {
    return "Ese correo ya existe en Supabase Auth. Recupera el acceso con ese mismo correo para reactivar tu perfil dentro de ROIS.";
  }
  if (message.includes("row-level security") || message.includes("42501")) {
    return "Supabase bloqueo la operacion por RLS. Verifica que el perfil pertenezca a la sesion activa.";
  }
  return message || "Ocurri\u00f3 un error inesperado.";
}

function isUserAlreadyExistsError(error) {
  const message = typeof error?.message === "string" ? error.message : JSON.stringify(error);
  return message.includes("user_already_exists") || message.includes("already registered");
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(value = "") {
  return escapeHtml(value)
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function profileInitials(name = "ROIS") {
  return escapeHtml(String(name || "ROIS").trim().split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase() || "R");
}

function renderSession() {
  const area = document.getElementById("sessionArea");
  if (!state.session) {
    area.innerHTML = `
      <button class="btn primary nav-create-account" type="button" data-registration-choice="profile">Crear cuenta</button>
      <button class="btn subtle" type="button" data-open-login>Acceso</button>
    `;
    area.querySelector("[data-open-login]").addEventListener("click", openLogin);
    return;
  }
  area.innerHTML = `
    <span class="pill">${state.session.role === "admin" ? "Admin" : state.session.name}</span>
    <button class="btn subtle" type="button" data-panel-link>${state.session.role === "admin" ? "Panel admin" : state.session.role === "founder" ? "Panel founder" : state.session.role === "athlete" ? "Panel deportista" : "Panel cliente"}</button>
  `;
  area.querySelector("[data-panel-link]").addEventListener("click", () => showView(dashboardViewForRole(state.session.role)));
}

function renderPublic() {
  const coverSlot = document.getElementById("publicHomeCover");
  if (coverSlot) {
    clearCoverCarousels();
    coverSlot.innerHTML = featuredCoverMarkup("home");
  }
  renderHomeVisualSlots();

  const publicNews = (state.data?.news || []).filter(item => item.status === "published" && visualIsPublic(item));
  const publicNewsSlot = document.getElementById("publicNews");
  if (publicNewsSlot) publicNewsSlot.innerHTML = publicNews.length ? `
    <div class="public-feature-grid">
      ${publicNews.map(publicEditorialNewsCard).join("")}
    </div>
  ` : `<div class="empty">Las noticias publicadas aparecer\u00e1n aqu\u00ed.</div>`;

  document.querySelectorAll("[data-open-login]").forEach(button => button.addEventListener("click", openLogin));
  document.querySelectorAll("[data-registration]").forEach(button => button.addEventListener("click", () => openRegistration(button.dataset.registration)));
}

function renderPublicShell() {
  const coverSlot = document.getElementById("publicHomeCover");
  if (!coverSlot) return;
  if (!coverSlot.innerHTML.trim()) {
    clearCoverCarousels();
    coverSlot.innerHTML = featuredCoverMarkup("home");
  }
  renderHomeVisualSlots();
}

function siteSetting(id) {
  const row = (state.data?.site_settings || []).find(item => item.id === id);
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value);
  } catch (error) {
    return { value: row.value };
  }
}

function advertisingCoverIds() {
  return ["home_cover", "home_cover_2", "home_cover_3", "home_cover_4", "home_cover_5", "home_cover_6"];
}

function homeVisualSlotDefinitions() {
  return [
    { id: "home_cover", index: 1, label: "Portada principal", empty: "Portada principal disponible" },
    { id: "home_cover_2", index: 2, label: "Tarjeta Empresas", empty: "Tarjeta Empresas disponible" },
    { id: "home_cover_3", index: 3, label: "Tarjeta Founders", empty: "Tarjeta Founders disponible" },
    { id: "home_cover_4", index: 4, label: "Tarjeta Athletes", empty: "Tarjeta Athletes disponible" },
    { id: "home_cover_5", index: 5, label: "Visual Alianzas", empty: "Visual Alianzas disponible" },
    { id: "home_cover_6", index: 6, label: "Visual Perfil", empty: "Visual Perfil disponible" }
  ];
}

function homeVisualSlots() {
  return homeVisualSlotDefinitions().map(slot => ({ ...slot, ...(siteSetting(slot.id) || {}) }));
}

function advertisingCovers() {
  const covers = homeVisualSlots()
    .filter(cover => cover.id === "home_cover" && cover.image_url)
    .slice(0, 1);
  if (covers.length) {
    cacheAdvertisingCovers(covers);
    return covers;
  }
  return cachedAdvertisingCovers();
}

function featuredAdvertisingCover() {
  return homeVisualSlots().find(slot => slot.id === "home_cover" && slot.image_url) || null;
}

function homeVisualSlot(slotId) {
  return homeVisualSlots().find(slot => slot.id === slotId) || null;
}

function cachedAdvertisingCovers() {
  try {
    const covers = JSON.parse(sessionStorage.getItem(coverCacheKey) || "[]");
    return Array.isArray(covers) ? covers.filter(cover => cover?.image_url).slice(0, 5) : [];
  } catch (error) {
    return [];
  }
}

function cacheAdvertisingCovers(covers) {
  try {
    sessionStorage.setItem(coverCacheKey, JSON.stringify(covers.map(cover => ({
      id: cover.id,
      index: cover.index,
      title: cover.title || "Portada publicitaria ROIS",
      image_url: cover.image_url
    })).slice(0, 5)));
  } catch (error) {
    // Cache is optional; the platform still renders the fallback cover.
  }
}

function staticCoverFallback(context = "home") {
  return `
    <section class="${context === "client" ? "client-ad-cover" : "home-cover"} cover-carousel cover-fallback cover-static" data-cover-static>
      <div class="featured-cover-placeholder">
        <p class="eyebrow">PORTADA ROIS</p>
        <h3>Espacio principal disponible</h3>
        <p>Publica una portada horizontal desde el panel administrador para activar este espacio.</p>
      </div>
    </section>
  `;
}

function featuredCoverMarkup(context = "home") {
  const cover = featuredAdvertisingCover();
  if (!cover?.image_url) return staticCoverFallback(context);
  return `
    <section class="${context === "client" ? "client-ad-cover" : "home-cover"} cover-carousel cover-static" data-cover-static>
      <img class="cover-slide active" src="${cover.image_url}" alt="${escapeAttr(cover.title || "Portada publicitaria ROIS")}">
    </section>
  `;
}

function homeVisualMarkup(slotId) {
  const slot = homeVisualSlot(slotId);
  if (slot?.image_url) {
    return `<img src="${slot.image_url}" alt="${escapeAttr(slot.title || slot.label || "Visual ROIS")}">`;
  }
  return `
    <div class="home-visual-placeholder">
      <span>${escapeHtml(slot?.label || "Espacio visual")}</span>
    </div>
  `;
}

function renderHomeVisualSlots() {
  document.querySelectorAll("[data-home-visual]").forEach(slot => {
    slot.innerHTML = homeVisualMarkup(slot.dataset.homeVisual);
  });
}

function coverCarouselMarkup(context = "home") {
  const covers = advertisingCovers();
  if (!covers.length) return staticCoverFallback(context);
  return `
    <section class="${context === "client" ? "client-ad-cover" : "home-cover"} cover-carousel" data-cover-carousel>
      ${covers.map((cover, index) => `
        <img class="cover-slide ${index === 0 ? "active" : ""}" data-cover-slide src="${cover.image_url}" alt="${escapeAttr(cover.title || "Portada publicitaria ROIS")}">
      `).join("")}
      ${covers.length > 1 ? `<div class="cover-dots">${covers.map((_, index) => `<span class="${index === 0 ? "active" : ""}" data-cover-dot></span>`).join("")}</div>` : ""}
    </section>
  `;
}

function setupCoverCarousels() {
  coverCarouselTimers.forEach(timer => clearInterval(timer));
  coverCarouselTimers = [];
  document.querySelectorAll("[data-cover-carousel]").forEach(carousel => {
    const slides = [...carousel.querySelectorAll("[data-cover-slide]")];
    const dots = [...carousel.querySelectorAll("[data-cover-dot]")];
    if (slides.length <= 1) return;
    let active = 0;
    const show = index => {
      active = index % slides.length;
      slides.forEach((slide, slideIndex) => slide.classList.toggle("active", slideIndex === active));
      dots.forEach((dot, dotIndex) => dot.classList.toggle("active", dotIndex === active));
    };
    coverCarouselTimers.push(setInterval(() => show(active + 1), 10000));
  });
}

function clearCoverCarousels() {
  coverCarouselTimers.forEach(timer => clearInterval(timer));
  coverCarouselTimers = [];
}

function renderClient() {
  renderClientHeader();
  renderClientKpis();
  const activePanel = activeDashboardPanelId("client") || "client-overview";
  renderClientPanel(activePanel);
}

function renderClientPanel(targetId) {
  const map = {
    "client-overview": renderClientOverview,
    "client-events": renderClientEvents,
    "client-feed": renderClientFeed,
    "client-sponsors": renderClientSponsors,
    "client-marketplace": renderClientMarketplace,
    "client-founders": renderClientFounders,
    "client-register": renderClientRegister,
    "client-payments": renderClientPayments,
    "client-settings": () => renderAccountSettings("client-settings")
  };
  if (map[targetId]) map[targetId]();
  decoratePanelPagination(targetId);
}

function premiumAllianceCatalog() {
  return [
    {
      id: "f1-mexico",
      label: "Alianza premium",
      name: "F1 Gran Premio de Mexico",
      tag: "Experiencias, suites y patrocinios",
      description: "Productos corporativos de hospitalidad, acceso privado y patrocinios de alto impacto para el Gran Premio de Mexico.",
      logo: "F1",
      tone: "black",
      products: [
        { id: "f1-terraza-a", name: "Terraza A", price: "$65,000 MXN + IVA", detail: "Acceso premium por persona. Inventario sujeto a confirmacion." },
        { id: "f1-sky-box-mgs", name: "Sky Box MGS", price: "$65,800 MXN + IVA", detail: "Hospitalidad corporativa con vista y servicio premium." },
        { id: "f1-trackside-b", name: "Trackside Box B", price: "$83,500 MXN + IVA", detail: "Box trackside. Capacidad referencial: 40 lugares." },
        { id: "f1-platino-plus-b", name: "Platino Plus B Suite", price: "$95,000 MXN + IVA", detail: "Suite premium. Capacidad referencial: 40 lugares." },
        { id: "f1-mgc-suite", name: "MGC Suite Privada", price: "$104,500 MXN + IVA", detail: "Suite privada de alto nivel. Capacidad referencial: 40 lugares." },
        { id: "f1-black", name: "Patrocinio Black", price: "$1,850,000 MXN + IVA", detail: "Activacion de tierra, sampling y experiencia de marca." },
        { id: "f1-bronce-lite", name: "Patrocinio Bronce Lite", price: "$3,500,000 MXN + IVA", detail: "Visibilidad inicial, contenido online y pases para fiesta de patrocinadores." },
        { id: "f1-bronce", name: "Patrocinio Bronce", price: "$5,000,000 MXN + IVA", detail: "Pendones, spot en pantallas, retorno en boletos y accesos VIP." },
        { id: "f1-gold", name: "Patrocinio Gold", price: "$12,500,000 MXN + IVA", detail: "Presencia amplia, activaciones, pauta, mailings, pases VIP y hospitality." },
        { id: "f1-platino", name: "Patrocinio Platino", price: "$25,000,000 MXN + IVA", detail: "Maxima presencia, helicoptero, paddock, grid passes y beneficios principales." }
      ]
    },
    {
      id: "los-300",
      label: "Alianza editorial y golf",
      name: "Los 300",
      tag: "Networking, ranking empresarial y torneo de golf",
      description: "Acceso a productos de posicionamiento empresarial, networking premium y torneo de golf Los 300.",
      logo: "300",
      tone: "silver",
      products: [
        { id: "los300-anual-10m", name: "Membresia Anual Elite", price: "$10,000,000 MXN", detail: "Presencia anual prioritaria y acceso a ecosistema premium Los 300." },
        { id: "los300-anual-5m", name: "Membresia Anual Plus", price: "$5,000,000 MXN", detail: "Posicionamiento anual, networking y beneficios seleccionados." },
        { id: "los300-anual-25m", name: "Membresia Anual Base", price: "$2,500,000 MXN", detail: "Entrada institucional al ecosistema anual." },
        { id: "los300-networking", name: "Networking Premium", price: "$270,000 MXN", detail: "Acceso ejecutivo a sesion de relacionamiento premium." },
        { id: "los300-golf-cohost", name: "Golf Co-Anfitrion", price: "$1,000,000 MXN", detail: "Rol destacado dentro del torneo de golf." },
        { id: "los300-golf-platino", name: "Golf Platino", price: "$500,000 MXN", detail: "Presencia premium y activaciones dentro del torneo." },
        { id: "los300-golf-oro", name: "Golf Oro", price: "$250,000 MXN", detail: "Presencia de marca y relacionamiento con jugadores." }
      ]
    }
  ];
}

function clientCompanyLogoMarkup(company) {
  if (company?.logo_url) {
    return safeProfileImageMarkup(company.logo_url, company.name || "Empresa");
  }
  return `
    <button class="company-logo-upload-prompt" type="button" data-dashboard-shortcut="client-settings" aria-label="Subir logo de empresa">
      <span>+</span>
      <small>Subir logo</small>
    </button>
  `;
}

function clientAthleteRecords() {
  return (state.data.athletes || [])
    .filter(item => item.id && !item.is_virtual)
    .filter(item => String(item.status || "").toLowerCase() === "approved")
    .filter(item => String(item.visual_status || "").toLowerCase() === "approved");
}

function clientFounderRecords() {
  const athleteEmails = new Set(
    (state.data.athletes || [])
      .filter(item => item.id && !item.is_virtual)
      .map(item => String(item.email || item.contact || "").trim().toLowerCase())
      .filter(Boolean)
  );
  return (state.data.founders || [])
    .filter(item => item.id && !item.is_virtual)
    .filter(item => !athleteEmails.has(String(item.email || "").trim().toLowerCase()))
    .filter(item => !["blocked", "deleted", "rejected"].includes(String(item.status || "").toLowerCase()))
    .filter(item => String(item.visual_status || "").toLowerCase() === "approved");
}

function renderClientOverview() {
  const coverSlot = document.getElementById("clientDashboardCover");
  if (coverSlot) {
    coverSlot.innerHTML = "";
    coverSlot.hidden = true;
    coverSlot.setAttribute("aria-hidden", "true");
  }
  document.querySelector(`[data-dashboard-panel="client-overview"]`).innerHTML = clientAdvertisingOverviewMarkup();
}

function clientAdvertisingOverviewMarkup() {
  const company = currentCompany();
  const news = state.data.news
    .filter(item => item.status === "published" && visualIsPublic(item))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const companyName = company?.name || state.session?.name || "Empresa ROIS";
  const interest = company?.interest || "Oportunidades premium";
  const description = company?.description || "Cuenta empresarial habilitada para explorar el Mercado Corporativo, athletes, creadores, eventos privados y oportunidades administradas por ROIS.";

  return `
    <div class="client-ad-home">
      <section class="client-company-card">
        <div class="company-profile-logo">${clientCompanyLogoMarkup(company)}</div>
        <div class="client-company-copy">
          <p class="eyebrow">Perfil empresarial</p>
          <h2>${escapeHtml(companyName)}</h2>
          <p><strong>${escapeHtml(interest)}</strong></p>
          <p>${escapeHtml(description)}</p>
          <div class="company-profile-actions">
          <button class="btn primary" type="button" data-dashboard-shortcut="client-sponsors">Explorar mercado corporativo</button>
            <button class="btn" type="button" data-dashboard-shortcut="client-marketplace">Ver mercado de fichajes</button>
            <button class="btn" type="button" data-dashboard-shortcut="client-founders">Ver creadores</button>
            <button class="btn" type="button" data-dashboard-shortcut="client-settings">Editar perfil</button>
          </div>
        </div>
      </section>

        <section class="client-editorial-feed">
          <div class="section-minihead">
            <p class="eyebrow">Noticias ROIS</p>
            <h3>Actualizaciones publicadas por administracion.</h3>
            <p>Mensajes, aperturas de inventario, alianzas y oportunidades que requieren atencion empresarial.</p>
          </div>
          ${news.length ? `<div class="editorial-news-stack">${news.map(item => editorialNewsCard(item, {
            kicker: "Nota ROIS",
            text: item.summary
          })).join("")}</div>` : `<div class="empty">Las noticias publicadas por admin apareceran aqui.</div>`}
        </section>
    </div>
  `;
}

function clientNewsPreviewCard(news) {
  return editorialNewsCard(news, {
    kicker: "Nota ROIS",
    text: news.summary || "Actualizacion disponible para empresas registradas.",
    preview: true
  });
}

function formatEditorialBody(text = "") {
  const paragraphs = String(text || "Informacion disponible para miembros aprobados.")
    .split(/\n\s*\n/)
    .map(item => item.trim())
    .filter(Boolean);
  return paragraphs.length
    ? paragraphs.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join("")
    : `<p>Informacion disponible para miembros aprobados.</p>`;
}

function clientExperienceOverviewMarkup() {
  const company = currentCompany();
  const cover = featuredAdvertisingCover();
  const posts = state.data.athlete_posts
    .filter(post => post.status === "approved")
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const alliances = premiumAllianceCatalog();
  const events = state.data.events.filter(item => item.status === "approved" && visualIsPublic(item));
  const athletes = clientAthleteRecords();
  const founders = clientFounderRecords();
  const news = state.data.news.filter(item => item.status === "published" && visualIsPublic(item));
  const companyName = company?.name || state.session?.name || "Empresa ROIS";
  const interest = company?.interest || "Patrocinios, eventos y activos comerciales";
  const description = company?.description || "Cuenta empresarial habilitada para revisar oportunidades, solicitar patrocinios y colaborar con athletes y creadores dentro del ecosistema ROIS.";

  return `
    <div class="company-profile-layout">
      <section class="company-profile-card executive-company-card">
          <div class="company-cover">
            ${cover?.image_url ? `<img src="${cover.image_url}" alt="Portada ROIS">` : `<div class="company-cover-fallback"><span>ROIS</span><small>Strategic partnerships Â· athletes Â· investment</small></div>`}
          </div>
          <button class="btn company-cover-logout" type="button" data-logout>Cerrar sesiÃ³n</button>
          <div class="company-profile-body">
            <div class="company-profile-logo">${clientCompanyLogoMarkup(company)}</div>
            <div class="company-profile-copy">
              <p class="eyebrow">Centro privado de oportunidades</p>
              <h2>${escapeHtml(companyName)}</h2>
              <p><strong>${escapeHtml(interest)}</strong></p>
              <p>${escapeHtml(description)}</p>
              <div class="company-profile-actions">
                <button class="btn primary" type="button" data-dashboard-shortcut="client-alliances">Explorar alianzas premium</button>
                <button class="btn" type="button" data-dashboard-shortcut="client-marketplace">Ver mercado de fichajes</button>
                <button class="btn" type="button" data-dashboard-shortcut="client-founders">Ver creadores</button>
                <button class="btn" type="button" data-dashboard-shortcut="client-settings">Editar perfil</button>
              </div>
            </div>
          </div>
          <div class="company-signal-strip">
            <div><span>${alliances.length}</span><small>Alianzas activas</small></div>
            <div><span>${events.length}</span><small>Eventos privados</small></div>
            <div><span>${athletes.length}</span><small>Athletes</small></div>
            <div><span>${founders.length}</span><small>Creadores</small></div>
            <div><span>${news.length}</span><small>Noticias ROIS</small></div>
          </div>
      </section>

      <div class="company-profile-main">
        <section class="premium-command-panel">
          <div class="section-minihead">
            <p class="eyebrow">Mesa de oportunidades</p>
            <h3>Productos privados listos para evaluaciÃ³n empresarial.</h3>
              <p>ROIS concentra alianzas, athletes, creadores y eventos premium para que tu empresa pueda evaluar afinidad, solicitar disponibilidad y cerrar operaciones desde un solo lugar.</p>
          </div>
          <div class="premium-alliance-grid command">
            ${alliances.slice(0, 2).map(alliance => allianceCard(alliance, true)).join("")}
          </div>
        </section>

        <section class="client-decision-board">
          <div class="section-minihead">
            <p class="eyebrow">Ruta de decisiÃ³n</p>
            <h3>De la oportunidad al cierre comercial.</h3>
          </div>
          <div class="client-step-grid">
            <article>
              <span>01</span>
              <h4>Explora productos premium</h4>
              <p>Revisa F1, Los 300, eventos privados y oportunidades de alto valor publicadas por ROIS.</p>
              <button class="btn" type="button" data-dashboard-shortcut="client-alliances">Ver alianzas</button>
            </article>
            <article>
              <span>02</span>
              <h4>Evalua mercado de fichajes</h4>
              <p>Consulta athletes con resultados, narrativa y tickets mensuales antes de solicitar patrocinio.</p>
              <button class="btn" type="button" data-dashboard-shortcut="client-marketplace">Ver mercado de fichajes</button>
            </article>
            <article>
              <span>03</span>
              <h4>Solicita y activa</h4>
              <p>ROIS valida disponibilidad, contratos, pagos y seguimiento operativo con el activo comercial o aliado seleccionado.</p>
              <button class="btn" type="button" data-dashboard-shortcut="client-sponsors">Ver patrocinios</button>
            </article>
          </div>
        </section>

        <section class="company-operations-card">
          <div class="section-minihead">
            <p class="eyebrow">Accesos operativos</p>
            <h3>Activa oportunidades sin perder tiempo.</h3>
          </div>
          <div class="company-action-grid">
            ${clientOperationCard("Productos premium", "Suites, patrocinios F1, Los 300 y experiencias privadas.", "client-alliances", "Solicitar")}
            ${clientOperationCard("Mercado de fichajes", `${athletes.length} athletes listos para evaluacion.`, "client-marketplace", "Revisar")}
            ${clientOperationCard("Creadores", `${founders.length} artistas, influencers y perfiles creativos para evaluar.`, "client-founders", "Explorar")}
            ${clientOperationCard("Eventos privados", `${events.length} oportunidades publicadas por ROIS.`, "client-events", "Calendario")}
            ${clientOperationCard("Pagos y cierre", "Consulta pagos, solicitudes y proximos pasos de operacion.", "client-payments", "Ver pagos")}
          </div>
        </section>
      </div>

      <aside class="company-profile-aside">
        <div class="client-next-steps">
          <p class="eyebrow">Siguiente mejor accion</p>
          <h3>Revisa las alianzas premium y solicita disponibilidad.</h3>
          <p>Para empresas nuevas, el camino mas eficiente es elegir un producto de F1, Los 300, un athlete o un founder y abrir una solicitud. ROIS hace el seguimiento comercial.</p>
          <div>
            <button class="btn primary" type="button" data-dashboard-shortcut="client-alliances">Ver productos</button>
            <button class="btn" type="button" data-dashboard-shortcut="client-feed">Ver feed</button>
          </div>
        </div>
        <div class="company-reels-widget">
          <div class="section-minihead">
            <p class="eyebrow">SeÃ±ales del ecosistema</p>
            <h3>Publicaciones de athletes y creadores listas para evaluacion.</h3>
          </div>
          ${posts.length ? `
            <div class="reels-feed tiktok-feed compact-reels" aria-label="Reels deportivos ROIS">
              ${posts.slice(0, 6).map(post => athleteFeedCard(post)).join("")}
            </div>
          ` : `<div class="empty slim">Las publicaciones de athletes y creadores apareceran aqui cuando esten aprobadas.</div>`}
        </div>
      </aside>
    </div>
  `;
}

function clientOperationCard(title, text, target, action) {
  return `
    <article>
      <span>${escapeHtml(title)}</span>
      <p>${escapeHtml(text)}</p>
      <button class="btn" type="button" data-dashboard-shortcut="${escapeAttr(target)}">${escapeHtml(action)}</button>
    </article>
  `;
}

function allianceCard(alliance, compact = false) {
  return `
    <article class="premium-alliance-card ${alliance.tone || ""}">
      <div class="premium-alliance-mark">${escapeHtml(alliance.logo)}</div>
      <p class="eyebrow">${escapeHtml(alliance.label)}</p>
      <h3>${escapeHtml(alliance.name)}</h3>
      <strong>${escapeHtml(alliance.tag)}</strong>
      <p>${escapeHtml(alliance.description)}</p>
      ${compact ? `
        <button class="btn" type="button" data-dashboard-shortcut="client-alliances">Ver productos</button>
      ` : `
        <div class="premium-product-count">${alliance.products.length} productos disponibles</div>
      `}
    </article>
  `;
}

function renderClientAlliances() {
  const alliances = premiumAllianceCatalog();
  panel("client-alliances", "Alianzas Premium", "F1, Los 300 y experiencias privadas disponibles para empresas ROIS", `
    <div class="panel-body">
      <section class="client-alliance-brief">
        <div>
          <p class="eyebrow">Mesa privada ROIS</p>
          <h3>Selecciona una oportunidad y ROIS valida disponibilidad, condiciones y siguiente paso comercial.</h3>
        </div>
        <div class="brief-flow">
          <span>1. Solicitud</span>
          <span>2. Validacion</span>
          <span>3. Contrato y pago</span>
        </div>
      </section>
      <div class="premium-alliance-grid">
        ${alliances.map(alliance => allianceCard(alliance)).join("")}
      </div>
      ${alliances.map(alliance => `
        <div class="premium-products-block">
          <div class="section-minihead">
            <p class="eyebrow">${escapeHtml(alliance.name)}</p>
            <h3>Productos disponibles para solicitud empresarial.</h3>
          </div>
          <div class="premium-product-grid">
            ${alliance.products.map(product => premiumProductCard(alliance, product)).join("")}
          </div>
        </div>
      `).join("")}
    </div>
  `);
}

function premiumProductCard(alliance, product) {
  return `
    <article class="premium-product-card">
      <span>${escapeHtml(alliance.name)}</span>
      <h4>${escapeHtml(product.name)}</h4>
      <strong>${escapeHtml(product.price)}</strong>
      <p>${escapeHtml(product.detail)}</p>
      <button class="btn primary" type="button" data-premium-request="${escapeAttr(`${alliance.id}:${product.id}`)}">Solicitar producto</button>
    </article>
  `;
}

async function requestPremiumAllianceProduct(value) {
  if (!state.session || state.session.role !== "client") {
    openLogin();
    return;
  }
  const [allianceId, productId] = String(value || "").split(":");
  if (!productId) {
    const product = vipProducts().find(item => item.id === allianceId);
    if (!product) return;
    try {
      await api.insert("requests", {
        type: "Centro VIP",
        title: product.name,
        details: `${product.price || "Precio por confirmar"} | ${product.detail || "Producto privado ROIS"}`,
        priority: "Alta",
        owner: currentCompany()?.name || state.session?.name || "Empresa",
        status: "review"
      });
      await api.insert("crm", {
        name: `${currentCompany()?.name || state.session?.name || "Empresa"} - ${product.name}`,
        volume: Number(String(product.price || "").replace(/[^0-9.]/g, "")) || 0,
        status: "Solicitud Centro VIP"
      });
      notify("Centro VIP", "Solicitud recibida", `ROIS revisara disponibilidad y condiciones de ${product.name}.`);
      renderClient();
    } catch (error) {
      notify("Centro VIP", "No fue posible registrar", humanError(error));
    }
    return;
  }
  const alliance = premiumAllianceCatalog().find(item => item.id === allianceId);
  const product = alliance?.products.find(item => item.id === productId);
  if (!alliance || !product) return;
  try {
    await api.insert("requests", {
      type: "Alianza Premium",
      title: `${alliance.name} - ${product.name}`,
      details: `${alliance.name} | ${product.price} | ${product.detail}`,
      priority: "Alta",
      owner: currentCompany()?.name || state.session?.name || "Empresa",
      status: "review"
    });
    await api.insert("crm", {
      name: `${currentCompany()?.name || state.session?.name || "Empresa"} - ${product.name}`,
      volume: Number(String(product.price).replace(/[^0-9.]/g, "")) || 0,
      status: "Solicitud nueva"
    });
    notify("Alianzas Premium", "Solicitud recibida", `ROIS revisara disponibilidad y condiciones de ${product.name}.`);
    renderClient();
    renderAdmin();
  } catch (error) {
    notify("Alianzas Premium", "No fue posible registrar", humanError(error));
  }
}

function renderClientFeed() {
  const posts = state.data.athlete_posts
    .filter(post => post.status === "approved")
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  panel("client-feed", "Oportunidades", "Contenido publicado por athletes y creadores listos para evaluacion comercial", posts.length ? `
    <div class="panel-body reels-panel-body">
      <div class="reels-feed tiktok-feed" aria-label="Reels deportivos ROIS">
        ${posts.map(post => athleteFeedCard(post)).join("")}
      </div>
    </div>
  ` : `<div class="empty">Las publicaciones de athletes y creadores apareceran aqui cuando esten aprobadas.</div>`);
  setupReelAutoplay();
}

function renderClientHeader() {
  const company = currentCompany();
  document.getElementById("clientAccountEyebrow").textContent = "Cuenta aprobada";
  document.getElementById("clientAccountName").textContent = company?.name || state.session?.name || "Cuenta ROIS";
  const companyLogo = document.getElementById("clientCompanyLogo");
  if (companyLogo) {
    companyLogo.hidden = !company?.logo_url;
    if (company?.logo_url) companyLogo.src = company.logo_url;
  }
  applySessionBranding();
}

function renderClientKpis() {
  const countFor = (targetId, records) => {
    const status = dashboardPanelLoads.get(targetId);
    if (!status?.loaded) return "Al abrir";
    return status.hasMore ? `${records.length}+` : records.length;
  };
  const events = countFor("client-events", state.data.events.filter(item => item.status === "approved" && visualIsPublic(item)));
  const athletes = countFor("client-marketplace", clientAthleteRecords());
  const founders = countFor("client-founders", clientFounderRecords());
  const pendingPayments = countFor("client-payments", state.data.payments.filter(item => item.status !== "paid"));
  document.getElementById("clientKpis").innerHTML = [
    ["Eventos", events],
    ["Athletes", athletes],
    ["Creadores", founders],
    ["Pagos", pendingPayments]
  ].map(([label, value]) => `<div class="kpi"><span>${label}</span><strong>${value}</strong></div>`).join("");
}

function renderClientEvents() {
  const events = state.data.events.filter(item => item.status === "approved" && visualIsPublic(item));
  panel("client-events", "Eventos", "Calendario privado publicado por ROIS", events.length ? `
    <div class="panel-body">
      <div class="opportunity-grid">
        ${events.map(event => eventClientCard(event)).join("")}
      </div>
    </div>
  ` : `<div class="empty">Los eventos aprobados por admin aparecer\u00e1n aqu\u00ed.</div>`);
}

function renderClientNews() {
  const news = state.data.news.filter(item => item.status === "published" && visualIsPublic(item));
  panel("client-news", "Noticias", "Publicaciones privadas para detectar oportunidades", news.length ? `
    <div class="panel-body">
      <div class="opportunity-grid">
        ${news.map(item => editorialNewsCard(item, {
          kicker: "Publicaci\u00f3n ROIS",
          text: item.summary
        })).join("")}
      </div>
    </div>
  ` : `<div class="empty">Las noticias publicadas por admin aparecer\u00e1n aqu\u00ed.</div>`);
}

function companyListingTypeLabel(value) {
  return ({ product: "Producto", service: "Servicio", asset: "Activo", opportunity: "Oportunidad" })[value] || "Oferta corporativa";
}

function companyListingAvailabilityLabel(value) {
  return ({ available: "Disponible", limited: "Disponibilidad limitada", on_request: "Bajo solicitud", sold_out: "Agotado" })[value] || "Disponible";
}

function companyListingPrice(listing) {
  if (listing.price_label) return listing.price_label;
  if (listing.price !== null && listing.price !== undefined && listing.price !== "") {
    return `$${Number(listing.price).toLocaleString("es-MX")} ${listing.currency || "MXN"}`;
  }
  return "Cotización privada";
}

function corporateMarketplaceListings() {
  const company = currentCompany();
  return (state.data?.company_listings || [])
    .filter(item => item.company_id === company?.id
      ? !["archived", "rejected"].includes(item.status)
      : item.status === "approved" && item.visual_status === "approved")
    .filter(item => !item.expires_at || new Date(item.expires_at).getTime() > Date.now())
    .sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

function companyListingCard(listing) {
  const own = listing.company_id === currentCompany()?.id;
  const image = listing.primary_image_url || "./assets/rois-isotipo-cropped.png";
  return `
    <article class="corporate-listing-card">
      <div class="corporate-listing-media">
        <img src="${escapeAttr(image)}" alt="${escapeAttr(listing.title || "Oferta corporativa ROIS")}" onerror="this.onerror=null;this.src='./assets/rois-isotipo-cropped.png';">
        <div class="corporate-listing-badges">
          <span class="pill">${escapeHtml(companyListingTypeLabel(listing.listing_type))}</span>
          ${listing.featured ? `<span class="pill premium">Destacado</span>` : ""}
          ${own ? `<span class="pill">${escapeHtml(listing.status || "pending")}</span>` : ""}
        </div>
      </div>
      <div class="corporate-listing-copy">
        <p class="eyebrow">${escapeHtml(listing.company_name || "Empresa ROIS")} · ${escapeHtml(listing.category || "Corporativo")}</p>
        <h3>${escapeHtml(listing.title || "Oferta corporativa")}</h3>
        <p>${escapeHtml(listing.summary || listing.description || "Información disponible para empresas ROIS.")}</p>
        <div class="corporate-listing-meta">
          <div><span>Condición comercial</span><strong>${escapeHtml(companyListingPrice(listing))}</strong></div>
          <div><span>Disponibilidad</span><strong>${escapeHtml(companyListingAvailabilityLabel(listing.availability))}</strong></div>
          <div><span>Ubicación</span><strong>${escapeHtml(listing.location || "Por confirmar")}</strong></div>
        </div>
        <div class="action-row">
          ${own
            ? `<button class="btn" type="button" data-company-listing-archive="${escapeAttr(listing.id)}">Archivar</button>`
            : `<button class="btn primary" type="button" data-company-listing-interest="${escapeAttr(listing.id)}">Solicitar información</button>`}
          ${listing.website_url ? `<a class="btn" href="${escapeAttr(listing.website_url)}" target="_blank" rel="noopener">Ver sitio</a>` : ""}
        </div>
      </div>
    </article>
  `;
}

function companyListingFormMarkup() {
  return `
    <section class="corporate-publisher">
      <div class="section-minihead">
        <p class="eyebrow">Publicación empresarial</p>
        <h3>Incorpora un activo al Mercado Corporativo.</h3>
        <p>Productos, servicios, activos y oportunidades se publican después de revisión comercial y visual ROIS.</p>
      </div>
      <form id="companyListingForm" class="form-grid">
        <label>Tipo<select name="listing_type" required><option value="product">Producto</option><option value="service">Servicio</option><option value="asset">Activo</option><option value="opportunity">Oportunidad</option></select></label>
        <label>Categoría<input name="category" required placeholder="Tecnología, movilidad, hospitalidad..."></label>
        <label style="grid-column:1/-1">Título<input name="title" required maxlength="120" placeholder="Nombre comercial de la oferta"></label>
        <label style="grid-column:1/-1">Resumen<input name="summary" required maxlength="240" placeholder="Propuesta de valor en una frase clara"></label>
        <label style="grid-column:1/-1">Descripción<textarea name="description" required placeholder="Alcance, beneficios, condiciones, audiencia y diferenciadores."></textarea></label>
        <label>Precio numérico opcional<input name="price" type="number" min="0" step="0.01" placeholder="0"></label>
        <label>Etiqueta de precio<input name="price_label" placeholder="Desde $25,000 MXN o Bajo cotización"></label>
        <label>Ubicación<input name="location" placeholder="Nacional, Querétaro, remoto..."></label>
        <label>Disponibilidad<select name="availability"><option value="available">Disponible</option><option value="limited">Limitada</option><option value="on_request">Bajo solicitud</option></select></label>
        <label>Inventario opcional<input name="inventory_count" type="number" min="0" step="1"></label>
        <label>Sitio o brochure<input name="website_url" type="url" placeholder="https://"></label>
        <label style="grid-column:1/-1">Imagen principal<input name="image" type="file" accept="image/png,image/jpeg,image/webp" required></label>
        <button class="btn primary" type="submit">Enviar a revisión ROIS</button>
      </form>
    </section>
  `;
}

async function uploadCompanyListingImage(file, companyId, listingId) {
  validateProfileAsset(file, "avatar");
  const prepared = await resizeProfileImage(file);
  const filename = `${crypto.randomUUID()}-${sanitizedStorageFilename(prepared.name)}`;
  const path = `companies/${companyId}/listings/${listingId}/${filename}`;
  const response = await withTimeout(fetch(`${config.supabaseUrl}/storage/v1/object/${companyMediaBucket}/${path}`, {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${state.session?.token || config.supabaseAnonKey}`,
      "Content-Type": prepared.type,
      "x-upsert": "false"
    },
    body: prepared
  }), operationTimeoutMs, "La red está tardando demasiado al subir el archivo.");
  if (!response.ok) {
    const detail = await response.text();
    if (/row-level security|rls|unauthorized/i.test(detail)) throw new Error("Supabase bloqueó la imagen por permisos RLS.");
    throw new Error("No fue posible subir la imagen corporativa.");
  }
  return {
    path,
    url: `${config.supabaseUrl}/storage/v1/object/public/${companyMediaBucket}/${path}`,
    name: file.name,
    mime: prepared.type
  };
}

async function uploadCompanyEventImage(file, companyId, eventId) {
  if (!file) return null;
  validateProfileAsset(file, "avatar");
  const prepared = await resizeProfileImage(file);
  const filename = `${crypto.randomUUID()}-${sanitizedStorageFilename(prepared.name)}`;
  const path = `companies/${companyId}/events/${eventId}/${filename}`;
  const response = await withTimeout(fetch(`${config.supabaseUrl}/storage/v1/object/${companyMediaBucket}/${path}`, {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${state.session?.token || config.supabaseAnonKey}`,
      "Content-Type": prepared.type,
      "x-upsert": "false"
    },
    body: prepared
  }), operationTimeoutMs, "La red está tardando demasiado al subir el archivo.");
  if (!response.ok) throw new Error("No fue posible subir la imagen del evento.");
  return {
    path,
    url: `${config.supabaseUrl}/storage/v1/object/public/${companyMediaBucket}/${path}`
  };
}

async function submitCompanyListing(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const company = currentCompany();
  if (!company || !companyCan("publish_listings")) {
    notify("Mercado Corporativo", "Plan requerido", "Activa PRO o Business para publicar inventario empresarial.");
    return;
  }
  const activeCount = (state.data.company_listings || []).filter(item => item.company_id === company.id && ["draft", "pending", "approved"].includes(item.status)).length;
  const limit = Number(currentCompanySubscription(company)?.listing_limit || currentCompanyPlan(company).listingLimit || 0);
  if (limit && activeCount >= limit) {
    notify("Mercado Corporativo", "Límite alcanzado", `Tu plan permite ${limit} publicaciones activas.`);
    return;
  }
  submit.disabled = true;
  submit.textContent = "Publicando…";
  let listing = null;
  try {
    listing = await api.insert("company_listings", {
      company_id: company.id,
      profile_id: state.session.authId || state.session.id,
      company_name: company.name,
      listing_type: form.listing_type.value,
      category: form.category.value.trim(),
      title: form.title.value.trim(),
      summary: form.summary.value.trim(),
      description: form.description.value.trim(),
      price: form.price.value ? Number(form.price.value) : null,
      currency: "MXN",
      price_label: form.price_label.value.trim(),
      location: form.location.value.trim(),
      inventory_count: form.inventory_count.value ? Number(form.inventory_count.value) : null,
      availability: form.availability.value,
      contact_email: company.contact || state.session.email,
      website_url: form.website_url.value.trim(),
      plan_required: currentCompanyPlan(company).key === "business" ? "business" : "pro",
      featured: false,
      status: "pending",
      visual_status: "pending_review"
    });
    const uploaded = await uploadCompanyListingImage(form.image.files[0], company.id, listing.id);
    const updated = await api.update("company_listings", listing.id, {
      primary_image_url: uploaded.url,
      primary_image_path: uploaded.path
    });
    await api.insert("company_listing_media", {
      listing_id: listing.id,
      company_id: company.id,
      storage_path: uploaded.path,
      public_url: uploaded.url,
      original_name: uploaded.name,
      mime_type: uploaded.mime,
      sort_order: 0
    });
    listing = updated || { ...listing, primary_image_url: uploaded.url, primary_image_path: uploaded.path };
    replaceRecordInState("company_listings", listing);
    notify("Mercado Corporativo", "Publicación recibida", "El activo quedó pendiente de revisión comercial y visual ROIS.");
    renderClientSponsors();
  } catch (error) {
    const suffix = listing ? " El registro se conservó, pero revisa la carga de su imagen." : "";
    notify("Mercado Corporativo", "No fue posible publicar", `${humanError(error)}${suffix}`);
  } finally {
    submit.disabled = false;
    submit.textContent = "Enviar a revisión ROIS";
  }
}

async function requestCompanyPlan(planKey) {
  const company = currentCompany();
  const plan = companyPlanCatalog[planKey];
  if (!company || !plan || plan.key === "free") return;
  try {
    const duplicate = (state.data.requests || []).some(item => item.type === "Plan empresarial" && item.owner === company.name && item.status === "review" && String(item.details || "").includes(`Plan: ${plan.key}`));
    if (!duplicate) {
      await api.insert("requests", {
        type: "Plan empresarial",
        title: `Activación ${plan.name}`,
        owner: company.name,
        details: `Plan: ${plan.key} | Precio sugerido: $${plan.price.toLocaleString("es-MX")} MXN + IVA / mes | Empresa: ${company.name} | Correo: ${company.contact || state.session.email}`,
        priority: plan.key === "business" ? "Alta" : "Normal",
        status: "review"
      });
    }
    notify("Planes ROIS", "Solicitud recibida", `Administración validará la activación del plan ${plan.name}.`);
  } catch (error) {
    notify("Planes ROIS", "No fue posible solicitar", humanError(error));
  }
}

async function requestCompanyListing(listingId) {
  const listing = (state.data.company_listings || []).find(item => item.id === listingId);
  const buyer = currentCompany();
  if (!listing || !buyer || listing.company_id === buyer.id) return;
  try {
    await api.insert("marketplace_leads", {
      listing_id: listing.id,
      seller_company_id: listing.company_id,
      buyer_company_id: buyer.id,
      requester_profile_id: state.session.authId || state.session.id,
      requester_email: state.session.email,
      requester_name: buyer.owner || state.session.name,
      requester_company: buyer.name,
      message: `Interés en ${listing.title}`,
      status: "new"
    });
    notify("Mercado Corporativo", "Interés registrado", "ROIS y la empresa oferente recibirán la solicitud para dar seguimiento.");
  } catch (error) {
    notify("Mercado Corporativo", "No fue posible registrar", humanError(error));
  }
}

async function archiveCompanyListing(listingId) {
  const listing = (state.data.company_listings || []).find(item => item.id === listingId);
  if (!listing || listing.company_id !== currentCompany()?.id) return;
  if (!window.confirm(`¿Archivar "${listing.title}"?`)) return;
  try {
    await api.update("company_listings", listing.id, { status: "archived", featured: false });
    renderClientSponsors();
  } catch (error) {
    notify("Mercado Corporativo", "No fue posible archivar", humanError(error));
  }
}

function renderClientSponsors() {
  const products = vipProducts();
  const listings = corporateMarketplaceListings();
  const canPublish = companyCan("publish_listings");
  const plan = currentCompanyPlan();
  panel("client-sponsors", "Mercado Corporativo", "Productos, servicios, activos y oportunidades entre empresas ROIS", `
    <div class="panel-body corporate-market-intro">
      <div class="section-minihead">
        <p class="eyebrow">Plan ${escapeHtml(companyPlanLabel())}</p>
        <h3>Inventario empresarial con contexto comercial.</h3>
        <p>Explora ofertas aprobadas por ROIS o incorpora inventario propio con trazabilidad de solicitudes.</p>
      </div>
      <div class="corporate-plan-summary">
        <span>${plan.listingLimit || 0} publicaciones</span>
        <span>${plan.eventLimitMonthly || 0} eventos / mes</span>
        <span>${plan.seatsLimit || 1} usuario${plan.seatsLimit > 1 ? "s" : ""}</span>
      </div>
    </div>
    <div class="panel-body">
      ${listings.length
        ? `<div class="corporate-listing-grid">${listings.map(companyListingCard).join("")}</div>`
        : `<div class="empty">El inventario corporativo aprobado aparecerá aquí.</div>`}
    </div>
    <div class="panel-body">
      ${canPublish ? companyListingFormMarkup() : companyPlanGateMarkup("Publica inventario y eventos en ROIS")}
    </div>
    ${products.length ? `
      <div class="panel-body curated-vip-inventory">
        <div class="section-minihead"><p class="eyebrow">Selección ROIS</p><h3>Inventario curado por administración.</h3></div>
        <div class="vip-product-grid">${products.map(vipProductCard).join("")}</div>
      </div>` : ""}
  `);
  document.getElementById("companyListingForm")?.addEventListener("submit", submitCompanyListing);
}

function isVipProduct(item) {
  return String(item.type || "").toLowerCase() === "centro vip";
}

function vipProducts() {
  const adminProducts = state.data.partnerships
    .filter(item => isVipProduct(item) && item.status === "approved" && visualIsPublic(item))
    .map(item => ({
      id: item.id,
      name: item.name,
      price: item.tier || "Precio por confirmar",
      detail: item.description || "Producto privado disponible para empresas ROIS.",
      image_url: item.image_url,
      url: item.url,
      source: "Admin"
    }));
  return adminProducts;
}

function vipProductCard(product) {
  const hasAdminUrl = product.url;
  const requestAction = hasAdminUrl
    ? `<a class="btn primary" href="${product.url}" target="_blank" rel="noopener">Abrir producto</a>`
    : `<button class="btn primary" type="button" data-premium-request="${escapeAttr(product.id)}">Solicitar disponibilidad</button>`;
  return `
    <article class="vip-product-card">
      <div class="vip-product-media">
        ${product.image_url ? `<img src="${product.image_url}" alt="${escapeAttr(product.name)}">` : `<div><span>${escapeHtml(product.source || "ROIS")}</span></div>`}
      </div>
      <div class="vip-product-copy">
        <p class="eyebrow">${escapeHtml(product.source || product.alliance || "Producto VIP")}</p>
        <h3>${escapeHtml(product.name)}</h3>
        <strong>${escapeHtml(product.price || "Precio por confirmar")}</strong>
        <p>${escapeHtml(product.detail || "Producto privado disponible para empresas ROIS.")}</p>
        <div class="action-row">${requestAction}</div>
      </div>
    </article>
  `;
}

function renderClientMarketplace() {
  const athletes = clientAthleteRecords();
  panel("client-marketplace", "Mercado de fichajes", "Athletes listos para evaluacion comercial y patrocinio.", athletes.length ? `
    <div class="panel-body">
      <div class="athlete-showcase compact">
        ${athletes.map(athlete => athleteCard(athlete)).join("")}
      </div>
    </div>
  ` : `<div class="empty">Los athletes aprobados apareceran aqui cuando esten listos para evaluacion empresarial.</div>`);
}

function marketProfileCard(profile, options = {}) {
  const founder = options.founder === true;
  const primary = founder ? profile.industry || profile.sport : profile.sport;
  const secondary = founder ? profile.stage || profile.category : profile.category;
  const location = founder ? profile.city || profile.location : profile.location;
  const summary = profile.stats || (founder
    ? "Perfil de creador en evaluacion dentro de ROIS."
    : "Perfil deportivo en evaluacion dentro de ROIS.");
  const ticket = Number(profile.monthly || (founder ? 2500 : 5000)).toLocaleString("es-MX");
  const ranking = profile.ranking || "En evaluacion";
  const typeLabel = founder ? `${creatorTypeLabel(profile.creator_type)} ROIS` : "Athlete ROIS";
  const displayName = founder ? profile.public_name || profile.name : profile.name;
  const decisionCopy = founder
    ? `Perfil para marcas interesadas en ${profile.content_categories || primary || "contenido, cultura y comunidades"}. Consulta su Sponsor Deck ROIS, redes y disponibilidad comercial.`
    : "Ideal para empresas interesadas en talento deportivo, visibilidad de marca, narrativa competitiva y relaciones de patrocinio.";
  return `
    <article class="athlete-card founder-card">
      <div class="athlete-media">
        ${safeProfileImageMarkup(profile.image_url, displayName || typeLabel)}
        <span class="pill media-pill">${founder ? creatorTypeLabel(profile.creator_type) : "Athlete"}</span>
      </div>
      <div class="athlete-info">
        <div>
          <p class="eyebrow">${founder ? "Creador ROIS" : "Perfil athlete"}</p>
          <h3>${escapeHtml(displayName || typeLabel)}</h3>
          <p class="athlete-summary">${escapeHtml(summary)}</p>
        </div>
        <div class="athlete-technical">
          <div><span>${founder ? "Categoria / nicho" : "Deporte"}</span><strong>${escapeHtml(primary || "Por definir")}</strong></div>
          <div><span>${founder ? "Plataforma" : "Categoria"}</span><strong>${escapeHtml(founder ? profile.primary_platform || secondary || "Por definir" : secondary || "Por definir")}</strong></div>
          <div><span>Base</span><strong>${escapeHtml(location)}</strong></div>
          <div><span>${founder ? "Audiencia" : "Ranking / marca"}</span><strong>${escapeHtml(founder ? creatorAudienceLabel(profile) : ranking)}</strong></div>
        </div>
        <div class="athlete-metrics">
          <div><span>${founder ? "Engagement" : "Ticket mensual"}</span><strong>${founder ? creatorEngagementLabel(profile) : `$${ticket} MXN`}</strong></div>
          <div><span>${founder ? "Inversion objetivo" : "Tipo"}</span><strong>${founder ? `$${ticket} MXN` : typeLabel}</strong></div>
        </div>
        <div class="athlete-decision">
          <p>${decisionCopy}</p>
          <div class="athlete-actions">
            <button class="btn" type="button" data-athlete-profile="${escapeAttr(profile.id)}">Ver perfil</button>
            ${sponsorDeckButton(profile)}
            ${athleteSponsorCta(profile, founder ? "Solicitar colaboracion" : "Solicitar patrocinio")}
            ${profileSocialLinksMarkup(profile)}
          </div>
        </div>
      </div>
    </article>
  `;
}

function founderMarketCard(founder) {
  return marketProfileCard(founder, { founder: true });
}

function renderClientFounders() {
  const founders = clientFounderRecords();
  panel("client-founders", "Creadores", "Artistas, influencers y creadores listos para evaluacion comercial", `
    <div class="panel-body">
      <div class="section-minihead">
        <p class="eyebrow">Creator Marketplace ROIS</p>
        <h3>Talento creativo preparado para colaborar con marcas.</h3>
        <p>Compara categoria, plataforma, audiencia, engagement, Sponsor Deck y afinidad comercial antes de solicitar una colaboracion.</p>
      </div>
      ${founders.length
        ? `<div class="athlete-showcase compact founder-market-grid">${founders.map(founder => founderMarketCard(founder)).join("")}</div>`
        : `<div class="empty">Los creadores aprobados apareceran aqui cuando su perfil y metricas esten listos para evaluacion empresarial.</div>`
      }
    </div>
  `);
}

function renderClientRegister() {
  if (!companyCan("publish_events")) {
    panel("client-register", "Registrar Evento", "Funcionalidad disponible para empresas PRO y Business", `
      <div class="panel-body">${companyPlanGateMarkup("Publica eventos empresariales sujetos a revisión ROIS")}</div>
    `);
    return;
  }
  const company = currentCompany();
  const subscription = currentCompanySubscription(company);
  const monthlyLimit = Number(subscription?.event_limit_monthly || currentCompanyPlan(company).eventLimitMonthly || 0);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const usedThisMonth = (state.data.events || []).filter(item => item.company_id === company?.id && new Date(item.created_at || 0) >= monthStart && item.status !== "rejected").length;
  if (monthlyLimit && usedThisMonth >= monthlyLimit) {
    panel("client-register", "Registrar Evento", "Límite mensual alcanzado", `
      <div class="panel-body"><div class="empty">Tu plan permite ${monthlyLimit} eventos por mes. Puedes actualizar a Business o esperar al siguiente periodo.</div></div>
    `);
    return;
  }
  panel("client-register", "Registrar Evento", "Env\u00edo a revisi\u00f3n", `
    <div class="panel-body">
      <form id="eventForm" class="form-grid">
        <label>Evento<input name="name" required placeholder="Nombre del evento"></label>
        <label>Sede<input name="venue" required placeholder="Sede o ciudad"></label>
        <label>Categor\u00eda<input name="category" required placeholder="Ejecutivo, sponsor, membresia, networking"></label>
        <label>Fecha<input name="date" required placeholder="Por confirmar"></label>
        <label style="grid-column:1/-1">Descripcion comercial del evento<textarea name="event_scope" required placeholder="Audiencia, alcance, sectores, tomadores de decision, medios, impacto esperado y por que una empresa deberia patrocinar este evento."></textarea></label>
        <label style="grid-column:1/-1">Paquetes o patrocinio buscado<textarea name="sponsor_levels" placeholder="Describe niveles, tickets, beneficios o tipo de sponsor buscado."></textarea></label>
        ${eventSuccessFeeSelectMarkup()}
        <div class="registration-note" style="grid-column:1/-1">
          <p class="eyebrow">Modelo de success fee ROIS</p>
          <p>La publicacion de eventos esta incluida en los limites de tu plan empresarial, sin fee individual adicional. Si ROIS participa en la atraccion, presentacion, desarrollo comercial, negociacion o cierre, podra aplicar un success fee del 5% al 20%.</p>
          <p class="hint">El success fee aplica unicamente sobre sponsors, patrocinios o ingresos comerciales cerrados mediante presentacion, gestion o intervencion comercial de ROIS. Las condiciones finales podran documentarse en contrato o acuerdo comercial especifico.</p>
        </div>
        <label style="grid-column:1/-1">Imagen del evento<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <p class="hint" style="grid-column:1/-1">El evento queda sujeto a revision interna y consume una publicacion mensual del plan activo. ROIS podra participar bajo success fee sobre patrocinios, sponsors, alianzas o ingresos comerciales generados mediante nuestra gestion.</p>
        <button class="btn primary" type="submit">Enviar evento a revision ROIS</button>
      </form>
    </div>
  `);
  document.getElementById("eventForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const eventName = form.name.value.trim();
    const successFeeLevel = form.success_fee_level?.value || "listing_5";
    const eventRecord = await insertEventRegistrationRecord({
      company_id: company.id,
      profile_id: state.session.authId || state.session.id,
      name: eventName,
      venue: form.venue.value,
      category: form.category.value,
      date: form.date.value,
      event_scope: form.event_scope?.value || "",
      sponsor_levels: form.sponsor_levels?.value || "",
      success_fee_level: successFeeLevel,
      image_url: ""
    });
    const imageFile = form.image.files?.[0];
    if (imageFile && eventRecord?.id) {
      const uploaded = await uploadCompanyEventImage(imageFile, company.id, eventRecord.id);
      await api.update("events", eventRecord.id, { image_url: uploaded.url, image_path: uploaded.path, visual_status: "pending_review" });
    }
    notify("Eventos", "Evento registrado", "Tu evento quedo enviado a revision ROIS dentro del limite de tu plan. El success fee seleccionado aplicara sobre resultados comerciales generados mediante nuestra intervencion.");
    renderClient();
  });
}

function renderClientPayments() {
  const companyName = currentCompany()?.name || state.session?.name || "";
  const rows = state.data.payments.filter(payment => payment.company === companyName).map(payment => [
    payment.concept,
    `$${Number(payment.amount).toLocaleString("es-MX")} MXN`,
    badge(payment.status),
    payment.status === "paid" ? "Pagado" : button("Pagar con Stripe", () => payClientPayment(payment.id))
  ]);
  panel("client-payments", "Pagos", "Operaciones y compromisos comerciales ROIS", rows.length ? table(["Concepto", "Monto", "Estado", "Acci\u00f3n"], rows) : `
    <div class="panel-body">
      <div class="empty">No hay pagos registrados todav\u00eda. Aqui apareceran operaciones comerciales especificas que requieran seguimiento.</div>
    </div>
  `);
}

function renderAccountSettings(panelId) {
  const company = panelId === "client-settings" ? currentCompany() : null;
  panel(panelId, "Configuraci\u00f3n", panelId === "client-settings" ? "Perfil de empresa y seguridad" : "Seguridad de acceso", `
    <div class="panel-body">
      <div class="settings-grid">
        ${company ? `
          <div class="settings-block">
            <p class="eyebrow">Empresa</p>
            <h3>Identidad visible en tu sesi\u00f3n</h3>
            <p class="hint">Sube un logotipo institucional en PNG, JPG o WEBP. Se guardar\u00e1 en tu cuenta y ser\u00e1 visible en tu dashboard al iniciar sesi\u00f3n desde cualquier dispositivo.</p>
          </div>
          <form class="form-grid company-profile-form" data-company-profile>
            <div class="company-logo-preview ${company.logo_url ? "" : "image-fallback"}">
              ${company.logo_url ? safeProfileImageMarkup(company.logo_url, company.name || "Empresa") : `<div class="company-logo-empty">Logo</div>`}
              <span>${company.logo_url ? "Logo actual" : "Logo pendiente"}</span>
            </div>
            <label>Nombre de empresa<input name="name" required value="${escapeAttr(company.name || "")}" placeholder="Nombre legal o comercial"></label>
            <label>Contacto principal<input name="owner" value="${escapeAttr(company.owner || "")}" placeholder="Nombre del responsable"></label>
            <label>Correo de acceso<input name="contact" type="email" readonly value="${escapeAttr(company.contact || state.session?.email || "")}" placeholder="correo@empresa.com"></label>
            <label>Inter\u00e9s principal<select name="interest">
              ${["Patrocinios", "Eventos", "Deportistas", "Patrocinador oficial ROIS", "Relaciones estrat\u00e9gicas"].map(option => `<option value="${option}" ${company.interest === option ? "selected" : ""}>${option}</option>`).join("")}
            </select></label>
            <label>Sitio web<input name="website" type="url" value="${escapeAttr(company.website || "")}" placeholder="https://"></label>
            <label>Logotipo de empresa<input name="logo" type="file" accept="image/png,image/jpeg,image/webp"></label>
            <label style="grid-column:1/-1">Descripci\u00f3n breve<textarea name="description" placeholder="Describe a qu\u00e9 se dedica la empresa y qu\u00e9 tipo de oportunidades busca.">${escapeHtml(company.description || "")}</textarea></label>
            <button class="btn primary" type="submit">Guardar perfil de empresa</button>
          </form>
        ` : ""}
        <div class="settings-block">
          <p class="eyebrow">Sesi\u00f3n</p>
          <h3>Cierre autom\u00e1tico</h3>
          <p class="hint">La sesi\u00f3n ROIS se mantiene solo mientras esta ventana del navegador permanezca abierta. Al cerrar la pesta\u00f1a o el navegador, se solicitar\u00e1 iniciar sesi\u00f3n nuevamente.</p>
        </div>
        <form class="form-grid settings-password-form" data-settings-password>
          <label>Nueva Contrasena<input name="password" type="password" minlength="8" autocomplete="new-password" required></label>
          <label>Confirmar contrasena<input name="confirm" type="password" minlength="8" autocomplete="new-password" required></label>
          <button class="btn primary" type="submit">Actualizar contrase\u00f1a</button>
        </form>
        <div class="settings-block">
          <p class="eyebrow">Recuperaci\u00f3n</p>
          <h3>Recuperar acceso</h3>
          <p class="hint">Si pierdes acceso, usa "Recuperar contrase\u00f1a" en la pantalla de acceso. ROIS enviar\u00e1 un enlace al correo registrado.</p>
        </div>
        ${panelId === "client-settings" ? `
          <div class="settings-block session-exit-block">
            <p class="eyebrow">Salida segura</p>
            <h3>Cerrar sesion</h3>
            <p class="hint">Finaliza tu sesion empresarial cuando termines de operar en ROIS.</p>
            <button class="btn" type="button" data-logout>Cerrar sesion</button>
          </div>
        ` : ""}
      </div>
    </div>
  `);
  const companyForm = document.querySelector(`[data-dashboard-panel="${panelId}"] [data-company-profile]`);
  if (companyForm) companyForm.addEventListener("submit", submitCompanyProfile);
  document.querySelector(`[data-dashboard-panel="${panelId}"] [data-settings-password]`).addEventListener("submit", submitSettingsPassword);
}

function renderAthlete() {
  renderAthleteHeader();
  renderAthleteKpis();
  const activePanel = activeDashboardPanelId("athlete") || "athlete-profile";
  renderAthletePanel(activePanel);
}

function renderAthletePanel(targetId) {
  const map = {
    "athlete-profile": renderAthleteProfile,
    "athlete-notifications": renderAthleteNotifications,
    "athlete-scouts": renderAthleteScouts,
    "athlete-results": renderAthleteResults,
    "athlete-sponsor-deck": renderAthleteSponsorDeck,
    "athlete-settings": () => renderAccountSettings("athlete-settings")
  };
  if (map[targetId]) map[targetId]();
}

function renderAthleteHeader() {
  const athlete = currentAthlete();
  const copy = verticalCopy(athlete);
  document.getElementById("athleteAccountEyebrow").textContent = copy.accountEyebrow;
  document.getElementById("athleteAccountName").textContent = athlete?.name || state.session?.name || copy.profileDefaultName;
  const logo = document.getElementById("athleteProfileLogo");
  if (logo) {
    logo.removeAttribute("hidden");
  }
  applySessionBranding();
}

function renderAthleteKpis() {
  document.getElementById("athleteKpis").innerHTML = "";
}

function athleteSocialMedia(post, athlete) {
  const image = post.image_url || athlete?.image_url || profileImageFallback;
  if (post.video_url?.startsWith("data:video")) {
    return `<video src="${post.video_url}" muted loop playsinline preload="metadata" poster="${escapeAttr(image)}"></video>`;
  }
  return safeProfileImageMarkup(image, post.title || "Publicacion ROIS");
}

function athleteSocialPostTile(post, athlete, options = {}) {
  const canDelete = options.canDelete && post.id;
  const founder = isFounderProfile(athlete);
  return `
    <article class="athlete-social-tile">
      <div class="athlete-social-media">
        ${athleteSocialMedia(post, athlete)}
        <span>Publicacion</span>
        ${canDelete ? `<button class="media-delete-btn" type="button" data-athlete-delete-post="${escapeAttr(post.id)}">Eliminar</button>` : ""}
      </div>
      <div class="athlete-social-caption">
        <strong>${escapeHtml(post.title || (founder ? "Avance de emprendimiento" : "Avance deportivo"))}</strong>
        <p>${escapeHtml(post.caption || (founder ? "Actualizacion de creador ROIS." : "Actualizacion deportiva ROIS."))}</p>
      </div>
    </article>
  `;
}

function athleteResultTile(result) {
  return `
    <article class="athlete-social-info-card">
      <p class="eyebrow">${escapeHtml(result.month || "Resultado")}</p>
      <h4>${escapeHtml(result.event || "Actividad deportiva")}</h4>
      <p>${escapeHtml(result.summary || "Resultado documentado pendiente de resumen.")}</p>
      <div class="row-meta">
        ${badge(result.status || "registrado")}
        ${result.proof_url ? `<a class="btn" href="${result.proof_url}" target="_blank" rel="noopener">Ver soporte</a>` : ""}
      </div>
    </article>
  `;
}

function athleteSponsorshipTile(item) {
  return `
    <article class="athlete-social-info-card">
      <p class="eyebrow">${escapeHtml(item.status || "Solicitud")}</p>
      <h4>${escapeHtml(item.company || "Empresa en revision")}</h4>
      <p>${escapeHtml(item.details || "Condiciones y entregables por confirmar con ROIS.")}</p>
      <div class="row-meta">
        <span class="pill">$${Number(item.amount || 0).toLocaleString("es-MX")} MXN</span>
        ${badge(item.status || "review")}
      </div>
    </article>
  `;
}

function activateAthleteProfileTab(tabName = "posts") {
  document.querySelectorAll("[data-athlete-profile-tab]").forEach(button => {
    button.classList.toggle("active", button.dataset.athleteProfileTab === tabName);
  });
  document.querySelectorAll("[data-athlete-tab-panel]").forEach(panel => {
    panel.classList.toggle("active", panel.dataset.athleteTabPanel === tabName);
  });
}

function athleteRequirementStatus(athlete) {
  const hasRealSport = athlete?.sport && athlete.sport !== "Por definir";
  const items = [
    { key: "sport", label: "Disciplina deportiva", done: Boolean(hasRealSport) },
    { key: "category", label: "Categoria o nivel competitivo", done: Boolean(athlete?.category) },
    { key: "location", label: "Ciudad, club o academia base", done: Boolean(athlete?.location) },
    { key: "ranking", label: "Ranking, marca o metrica principal", done: Boolean(athlete?.ranking) },
    { key: "stats", label: "Ficha tecnica con resultados y objetivo deportivo", done: Boolean(athlete?.stats) },
    { key: "image", label: "Foto de perfil profesional", done: Boolean(athlete?.image_url) },
    { key: "monthly", label: "Ticket mensual y cupo maximo de patrocinadores", done: Number(athlete?.monthly || 0) > 0 && Number(athlete?.max_sponsors || 0) > 0 },
    { key: "terms", label: `Terminos de representacion aceptados con ${roisLegalEntity}`, done: Boolean(athlete?.terms_accepted) }
  ];
  const optional = [
    { key: "video", label: "Video o demo del emprendimiento", done: Boolean(athlete?.video_url) },
    { key: "deck", label: "Sponsor Deck ROIS", done: sponsorDeckIsReady(athlete) },
    { key: "logos", label: "Logos de patrocinadores actuales", done: athleteSponsorLogos(athlete || {}).length > 0 }
  ];
  const completed = items.filter(item => item.done).length;
  return {
    items,
    optional,
    completed,
    total: items.length,
    ready: completed === items.length
  };
}

function athleteOnboardingComplete(athlete = currentAthlete()) {
  return true;
}

function athleteGate(panelId, title, subtitle) {
  showDashboardPanel("athlete-profile");
}

function athleteTermsBlock(athlete) {
  return `
    <div class="terms-box">
      <p><strong>Entidad operadora.</strong> La plataforma ROIS es operada comercialmente por ${roisLegalEntity}. Al aceptar estos terminos, el deportista reconoce que ROIS estructura, negocia y administra oportunidades comerciales de patrocinio, representacion y seguimiento operativo con empresas patrocinadoras.</p>
      <p><strong>Representacion y no elusion.</strong> Las solicitudes, contactos, patrocinadores, negociaciones, briefings, contratos y pagos generados a partir de ROIS deberan gestionarse por la plataforma. El deportista no podra cerrar directa o indirectamente con empresas presentadas por ROIS sin autorizacion escrita.</p>
      <p><strong>Uso de imagen y entregables.</strong> El deportista autoriza a ROIS a presentar su perfil, resultados, entrenamientos, fotografias, videos y propuesta comercial a empresas interesadas. Cada patrocinio definira entregables permitidos, cuidando que no afecten el rendimiento, calendario competitivo ni preparacion deportiva.</p>
      <p><strong>Tarjetas, tickets y facturacion.</strong> Cuando una empresa asigne recursos, tarjetas o presupuestos operativos, el deportista debera conservar tickets, facturas y comprobantes, facturar conforme a las instrucciones contractuales de cada patrocinador y subir evidencia mensual en ROIS.</p>
      <p><strong>Revision y moderacion.</strong> ROIS podra revisar, aprobar, pausar o retirar visuales, reels, resultados, comprobantes o informacion sensible antes de mostrarla a empresas, para proteger a deportistas, patrocinadores y la integridad institucional de la plataforma.</p>
      <p><strong>Fee operativo.</strong> El deportista reconoce que ROIS podra retener o cobrar el porcentaje operativo pactado en el contrato de representacion o patrocinio correspondiente. La aceptacion digital no sustituye contratos especificos de cada operacion.</p>
    </div>
    <label class="check-option" style="grid-column:1/-1">
      <input name="terms_accepted" type="checkbox" ${athlete?.terms_accepted ? "checked" : ""} required>
      <span>Acepto los terminos operativos, comerciales y de representacion de ROIS / ${roisLegalEntity}.</span>
    </label>
  `;
}

function renderAthleteRequirements() {
  renderAthleteProfile();
}

function athleteNotificationsFor(email = state.session?.email || "") {
  return (state.data.athlete_notifications || [])
    .filter(item => String(item.athlete_email || "").toLowerCase() === String(email || "").toLowerCase())
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

function readableDate(value) {
  if (!value) return "Fecha pendiente";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

function athleteNotificationCard(item) {
  const unread = item.status !== "read";
  return `
    <article class="notification-card ${unread ? "is-unread" : ""}">
      <div>
        <div class="notification-meta">
          ${badge(item.priority || "normal")}
          <span>${escapeHtml(item.category || "general")}</span>
          <span>${readableDate(item.created_at)}</span>
        </div>
        <h3>${escapeHtml(item.title || "Notificacion ROIS")}</h3>
        <p>${escapeHtml(item.message || "")}</p>
      </div>
      <div class="notification-actions">
        ${unread ? button("Marcar leida", () => markAthleteNotificationRead(item.id)) : badge("leida")}
      </div>
    </article>
  `;
}

function renderAthleteNotifications() {
  const email = state.session?.email || "";
  const adminMessages = athleteNotificationsFor(email);
  panel("athlete-notifications", "Notificaciones", "Mensajes importantes enviados por ROIS", `
    <div class="panel-body">
      ${adminMessages.length ? `
        <div class="notification-list">
          ${adminMessages.map(athleteNotificationCard).join("")}
        </div>
      ` : `<div class="empty">Aun no tienes notificaciones. Cuando ROIS tenga novedades importantes sobre sponsors, contratos o pagos, apareceran aqui.</div>`}
    </div>
  `);
}

function profileVertical(profile) {
  if (!profile) return "athlete";
  const email = String(profile.email || profile.contact || "").trim().toLowerCase();
  const athleteRecord = (state.data?.athletes || []).some(item =>
    (profile.id && item.id === profile.id) ||
    (profile.profile_id && item.profile_id === profile.profile_id) ||
    (email && String(item.email || item.contact || "").trim().toLowerCase() === email)
  );
  if (athleteRecord && profile.role !== "founder") return "athlete";
  const founderRecord = (state.data?.founders || []).some(item =>
    (profile.id && item.id === profile.id) ||
    (profile.profile_id && item.profile_id === profile.profile_id) ||
    (email && String(item.email || "").trim().toLowerCase() === email)
  );
  if (founderRecord && !athleteRecord) return "founder";
  const directType = String(profile.profile_type || profile.vertical || profile.role || "").trim().toLowerCase();
  if (directType === "founder") return "founder";
  const normalize = value => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const profileText = [profile.sport, profile.category, profile.stats, profile.ranking, profile.industry, profile.stage, profile.venture_name].map(normalize).join(" ");
  const founderSignals = ["founder", "founders", "emprendimiento", "emprendedor", "startup", "empresa", "negocio", "industria", "venture", "founder rois"];
  return founderSignals.some(signal => profileText.includes(signal)) ? "founder" : "athlete";
}

function isFounderProfile(profile) {
  return profileVertical(profile) === "founder";
}

function verticalCopy(profile) {
  const founder = isFounderProfile(profile);
  return founder ? {
    accountEyebrow: "Cuenta de creador",
    profileDefaultName: "Creador ROIS",
    primaryFieldLabel: "Categoria / nicho",
    secondaryFieldLabel: "Etapa profesional",
    locationLabel: "Ciudad / base",
    rankingLabel: "Alcance o indicador destacado",
    summaryLabel: "Resumen comercial del creador",
    summaryPlaceholder: "Audiencia, estilo, contenido, relevancia cultural, resultados y valor para marcas.",
    videoLabel: "Showreel, portafolio o canal principal",
    profileEmptyText: "No encontramos una ficha de creador vinculada a tu correo. Contacta a ROIS para asociarla.",
    resultsTitle: "Resultados de campanas y contenido",
    resultsSubtitle: "Alcance, engagement, conversiones e hitos para marcas",
    resultMonthPlaceholder: "Junio 2026",
    resultEventPlaceholder: "Campana, lanzamiento, presentacion, colaboracion o crecimiento de audiencia",
    resultSummaryPlaceholder: "Resultado, alcance, engagement, conversiones y siguiente objetivo.",
    sponsorshipsTitle: "Patrocinios",
    sponsorshipsSubtitle: "Marcas y aliados que respaldan tu trayectoria creativa",
    scoutsTitle: "Scouts",
    scoutsSubtitle: "Invita creadores y comunidades a ROIS",
    postsEmptyText: "Tus publicaciones aparecer\u00e1n aqu\u00ed. Comparte contenido, campanas, presentaciones y evidencia para que las marcas eval\u00faen tu perfil.",
    profileStatusLabel: "Estado del perfil"
  } : {
    accountEyebrow: "Cuenta deportiva",
    profileDefaultName: "Athlete ROIS",
    primaryFieldLabel: "Disciplina",
    secondaryFieldLabel: "Categoria / nivel competitivo",
    locationLabel: "Ciudad / club / academia",
    rankingLabel: "Ranking / marca / metrica principal",
    summaryLabel: "Resumen deportivo",
    summaryPlaceholder: "Resultados, avances, objetivos, narrativa competitiva y siguiente meta para sponsors.",
    videoLabel: "Video o plan deportivo",
    profileEmptyText: "No encontramos un perfil deportivo vinculado a tu correo. Contacta a ROIS para asociarlo.",
    resultsTitle: "Resultados deportivos",
    resultsSubtitle: "Evidencia deportiva para reportar a patrocinadores",
    resultMonthPlaceholder: "Junio 2026",
    resultEventPlaceholder: "Torneo, entrenamiento, ranking, marca o competencia",
    resultSummaryPlaceholder: "Resultado, avance deportivo, aprendizaje y siguiente objetivo.",
    sponsorshipsTitle: "Patrocinios",
    sponsorshipsSubtitle: "Solicitudes y condiciones propuestas por empresas",
    scoutsTitle: "Scouts",
    scoutsSubtitle: "Invita deportistas y da seguimiento a tus comisiones",
    postsEmptyText: "Tus publicaciones aparecer\u00e1n aqu\u00ed. Comparte avances, evidencia, hitos y contenido \u00fatil para que las empresas eval\u00faen tu perfil.",
    profileStatusLabel: "Estado del perfil"
  };
}

function sponsorDeckData(profile = {}) {
  if (!profile?.sponsor_deck) return null;
  if (typeof profile.sponsor_deck === "object") return profile.sponsor_deck;
  try {
    const parsed = JSON.parse(profile.sponsor_deck);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    console.warn("[ROIS sponsor deck] JSON invalido", { profileId: profile.id, error: error.message });
    return null;
  }
}

function sponsorDeckIsReady(profile = {}) {
  return profile.sponsor_deck_status === "ready" || Boolean(sponsorDeckData(profile));
}

function sponsorDeckList(value = "") {
  if (Array.isArray(value)) return value.map(item => String(item || "").trim()).filter(Boolean);
  return String(value || "")
    .split(/\r?\n|;/)
    .map(item => item.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function sponsorDeckFormPayload(form, profile, role, media = []) {
  const value = name => String(form.elements.namedItem(name)?.value || "").trim();
  return {
    role,
    profile: {
      name: profile.public_name || profile.name || "Perfil ROIS",
      primary: profile.sport || profile.industry || "Talento ROIS",
      category: profile.category || profile.stage || "En desarrollo",
      location: profile.location || profile.city || "Mexico",
      ranking: profile.ranking || "",
      stats: profile.stats || "",
      audienceSize: Number(profile.audience_size || 0),
      engagementRate: Number(profile.engagement_rate || 0),
      contentCategories: profile.content_categories || "",
      primaryPlatform: profile.primary_platform || "",
      pastCollaborations: profile.past_collaborations || "",
      monthlyTicket: Number(profile.monthly || 5000),
      maxSponsors: Math.min(10, Number(profile.max_sponsors || 10))
    },
    answers: {
      objective: value("objective"),
      differentiator: value("differentiator"),
      audience: value("audience"),
      proof: value("proof"),
      brandFit: value("brand_fit"),
      deliverables: value("deliverables"),
      benefits: value("benefits"),
      contact: "Gestion comercial exclusiva mediante ROIS"
    },
    media
  };
}

function sponsorDeckQualityScore(payload, profile = {}) {
  const answers = payload.answers || {};
  const checks = [
    [answers.objective, 10],
    [answers.differentiator, 15],
    [answers.audience, 15],
    [answers.proof, 15],
    [answers.brandFit, 10],
    [answers.deliverables, 10],
    [answers.benefits, 15],
    [profile.image_url, 4],
    [profileSocialLinks(profile).length, 3],
    [profile.video_url || payload.media?.length, 3]
  ];
  return checks.reduce((score, [value, points]) => score + (value ? points : 0), 0);
}

function localSponsorDeckDraft(payload) {
  const { role, profile, answers } = payload;
  const creator = role === "founder";
  const benefits = sponsorDeckList(answers.benefits || answers.deliverables);
  return {
    version: 1,
    generatedBy: "rois-guided-engine",
    headline: `${profile.name}: ${creator ? "audiencia y contenido" : "talento deportivo"} con valor para marcas`,
    positioning: answers.differentiator,
    story: profile.stats || answers.objective,
    commercialObjective: answers.objective,
    audience: answers.audience,
    proofPoints: sponsorDeckList(answers.proof),
    brandFit: sponsorDeckList(answers.brandFit),
    deliverables: sponsorDeckList(answers.deliverables),
    benefits,
    monthlyTicket: Number(profile.monthlyTicket || 5000),
    maxSponsors: Math.min(10, Number(profile.maxSponsors || 10)),
    media: Array.isArray(payload.media) ? payload.media.slice(0, 2) : [],
    cta: "Solicita una evaluacion de patrocinio mediante ROIS. Nuestro equipo valida el alcance, coordina la presentacion y gestiona la relacion comercial.",
    generatedAt: new Date().toISOString()
  };
}

function normalizeSponsorDeck(deck, fallback) {
  const source = deck && typeof deck === "object" ? deck : {};
  const legacyBenefits = Array.isArray(source.packages)
    ? source.packages.flatMap(item => sponsorDeckList(item?.includes))
    : [];
  const normalizedBenefits = sponsorDeckList(source.benefits);
  return {
    ...fallback,
    ...source,
    proofPoints: sponsorDeckList(source.proofPoints || fallback.proofPoints),
    brandFit: sponsorDeckList(source.brandFit || fallback.brandFit),
    deliverables: sponsorDeckList(source.deliverables || fallback.deliverables),
    benefits: (normalizedBenefits.length ? normalizedBenefits : legacyBenefits.length ? legacyBenefits : sponsorDeckList(fallback.benefits)).slice(0, 10),
    monthlyTicket: Number(fallback.monthlyTicket || 5000),
    maxSponsors: Math.min(10, Number(fallback.maxSponsors || 10)),
    media: Array.isArray(fallback.media) ? fallback.media.slice(0, 2) : [],
    cta: "Solicita una evaluacion de patrocinio mediante ROIS. Nuestro equipo valida el alcance, coordina la presentacion y gestiona la relacion comercial.",
    generatedAt: new Date().toISOString()
  };
}

async function requestSponsorDeckAI(payload) {
  if (demoMode || !config.supabaseUrl || !state.session?.token) throw new Error("IA remota no configurada");
  const response = await withTimeout(fetch(`${config.supabaseUrl}/functions/v1/${sponsorDeckFunctionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${state.session.token}`
    },
    body: JSON.stringify(payload)
  }), operationTimeoutMs, "La IA esta tardando demasiado. Generaremos una version local.");
  if (!response.ok) throw new Error(await response.text() || "La IA no respondio.");
  const result = await response.json();
  if (!result?.deck) throw new Error("La IA no devolvio un sponsor deck valido.");
  return result.deck;
}

function sponsorDeckBenefitMarkup(value = "", index = 0) {
  return `
    <article class="sponsor-deck-benefit">
      <p class="eyebrow">Beneficio ${String(index + 1).padStart(2, "0")}</p>
      <p>${escapeHtml(value)}</p>
    </article>
  `;
}

function sponsorDeckMedia(profile, deck = sponsorDeckData(profile) || {}) {
  return (Array.isArray(deck.media) ? deck.media : [])
    .filter(item => item && normalizedSocialUrl(item.url))
    .slice(0, 2);
}

function sponsorDeckMediaMarkup(profile, deck) {
  const media = sponsorDeckMedia(profile, deck);
  if (!media.length) return "";
  return `<section class="sponsor-deck-media">
    <div class="sponsor-deck-media-heading"><p class="eyebrow">Evidencia visual</p><h3>Calendario, competiciones, eventos y activos de patrocinio.</h3></div>
    <div class="sponsor-deck-media-grid">${media.map((item, index) => `<figure>
      ${safeProfileImageMarkup(item.url, item.caption || `Evidencia ${index + 1}`)}
      <figcaption>${escapeHtml(item.caption || `Activo comercial ${index + 1}`)}</figcaption>
    </figure>`).join("")}</div>
  </section>`;
}

function sponsorDeckMarkup(profile, options = {}) {
  const deck = sponsorDeckData(profile);
  if (!deck) return `<div class="empty">Este perfil aun no ha generado su Sponsor Deck ROIS.</div>`;
  const founder = isFounderProfile(profile);
  const score = Number(profile.sponsor_deck_score || 0);
  const monthlyTicket = Number(deck.monthlyTicket || profile.monthly || 5000);
  const maxSponsors = Math.min(10, Number(deck.maxSponsors || profile.max_sponsors || 10));
  const benefits = sponsorDeckList(deck.benefits || deck.deliverables).slice(0, 10);
  return `
    <article class="sponsor-deck-preview ${options.compact ? "compact" : ""}">
      <header class="sponsor-deck-cover">
        <div class="sponsor-deck-brand">
          <img src="./assets/rois-logo.png" alt="ROIS">
          <span>Private sponsorship management</span>
        </div>
        <div class="sponsor-deck-portrait">${safeProfileImageMarkup(profile.image_url, profile.name || "Perfil ROIS")}</div>
        <div class="sponsor-deck-cover-copy">
          <p class="eyebrow">Sponsor Deck ROIS · ${founder ? "Creador" : "Athlete"}</p>
          <h2>${escapeHtml(deck.headline || profile.name || "Talento ROIS")}</h2>
          <p>${escapeHtml(deck.positioning || profile.stats || "Propuesta comercial en desarrollo.")}</p>
          <div class="row-meta"><span class="pill">${score}% completo</span><span class="pill">Hasta ${maxSponsors} sponsors</span></div>
        </div>
      </header>
      <div class="sponsor-deck-section sponsor-deck-story">
        <p class="eyebrow">Narrativa y objetivo</p>
        <h3>${escapeHtml(deck.commercialObjective || "Construir una alianza medible con marcas.")}</h3>
        <p>${escapeHtml(deck.story || profile.stats || "Historia profesional por documentar.")}</p>
      </div>
      <div class="sponsor-deck-columns">
        <section><p class="eyebrow">Audiencia</p><p>${escapeHtml(deck.audience || "Audiencia por documentar.")}</p></section>
        <section><p class="eyebrow">Evidencia</p><ul>${sponsorDeckList(deck.proofPoints).map(value => `<li>${escapeHtml(value)}</li>`).join("") || "<li>Resultados por documentar.</li>"}</ul></section>
        <section><p class="eyebrow">Afinidad de marca</p><ul>${sponsorDeckList(deck.brandFit).map(value => `<li>${escapeHtml(value)}</li>`).join("") || "<li>Categorias por definir.</li>"}</ul></section>
        <section><p class="eyebrow">Entregables</p><ul>${sponsorDeckList(deck.deliverables).map(value => `<li>${escapeHtml(value)}</li>`).join("") || "<li>Entregables por definir.</li>"}</ul></section>
      </div>
      ${sponsorDeckMediaMarkup(profile, deck)}
      <section class="sponsor-deck-commercial-model">
        <p class="eyebrow">Propuesta de patrocinio mensual</p>
        <h3>Beneficios y ventajas para construir una relacion de valor.</h3>
        <p>El ticket mensual es el mismo para cada patrocinador. La metodologia comercial ROIS organiza los activos que este perfil puede aportar y nuestro equipo valida alcance, derechos, calendario y condiciones.</p>
        <div class="sponsor-deck-offer-summary"><div><span>Ticket mensual</span><strong>$${monthlyTicket.toLocaleString("es-MX")} MXN</strong></div><div><span>Capacidad maxima</span><strong>${maxSponsors} sponsors</strong></div></div>
      </section>
      <div class="sponsor-deck-benefits">${benefits.map(sponsorDeckBenefitMarkup).join("") || `<div class="empty">Los beneficios para patrocinadores estan en preparacion.</div>`}</div>
      <section class="sponsor-deck-managed-panel">
        <div><p class="eyebrow">Gestion exclusiva ROIS</p><h3>ROIS coordina cada relacion de patrocinio.</h3><p>Validamos afinidad, presentamos la oportunidad y gestionamos negociacion, seguimiento y cierre sin exponer datos de contacto directo.</p></div>
        ${state.session?.role === "client" ? `<button class="btn primary" type="button" data-athlete-sponsor="${escapeAttr(profile.id)}">Solicitar evaluacion a ROIS</button>` : ""}
      </section>
    </article>
  `;
}

function sponsorDeckProfileById(profileId) {
  const athlete = (state.data.athletes || []).find(item => item.id === profileId || item.profile_id === profileId);
  if (athlete) return athlete;
  const founder = (state.data.founders || []).find(item => item.id === profileId || item.profile_id === profileId);
  return founder ? founderAsAthleteProfile(founder) : null;
}

async function loadSponsorDeckProfile(profileId) {
  let profile = sponsorDeckProfileById(profileId);
  if (!profile || sponsorDeckData(profile) || !sponsorDeckIsReady(profile) || !api.loadTablePage) return profile;

  const founder = (state.data.founders || []).find(item => item.id === profileId || item.profile_id === profileId);
  const table = founder ? "founders" : "athletes";
  const columns = table === "founders"
    ? "id,profile_id,email,name,venture_name,industry,stage,city,ranking,stats,creator_type,public_name,content_categories,primary_platform,audience_size,engagement_rate,audience_location,audience_demographics,brand_categories,past_collaborations,deliverables,availability,monthly,max_sponsors,image_url,sponsor_deck,sponsor_deck_status,sponsor_deck_score,sponsor_deck_updated_at,instagram_url,tiktok_url,facebook_url,linkedin_url,status,visual_status"
    : "id,profile_id,email,contact,name,sport,category,location,ranking,stats,monthly,max_sponsors,image_url,sponsor_deck,sponsor_deck_status,sponsor_deck_score,sponsor_deck_updated_at,instagram_url,tiktok_url,facebook_url,linkedin_url,status,visual_status";

  try {
    const rows = await api.loadTablePage(table, `select=${columns}&id=eq.${encodeURIComponent(profileId)}`, {
      limit: 1,
      token: state.session?.token
    });
    const updated = rows?.[0];
    if (!updated) return profile;
    replaceRecordInState(table, updated);
    profile = table === "founders" ? founderAsAthleteProfile(updated) : updated;
    return profile;
  } catch (error) {
    console.warn("[ROIS sponsor deck] No fue posible cargar el deck", { profileId, error: error.message });
    return profile;
  }
}

async function openSponsorDeckById(profileId) {
  const profile = await loadSponsorDeckProfile(profileId);
  if (!profile || !sponsorDeckData(profile)) {
    notify("Sponsor Deck ROIS", "Deck no disponible", "No fue posible cargar esta propuesta comercial. Intenta nuevamente.");
    return;
  }
  openSponsorDeckView(profile);
}

function openSponsorDeckView(profile) {
  if (!profile) return;
  notify("Sponsor Deck ROIS", profile.name || "Perfil comercial", "", sponsorDeckMarkup(profile));
  const modal = document.getElementById("actionModal");
  modal.dataset.profileRecordId = String(profile.id || "");
  modal.classList.add("profile-modal", "sponsor-deck-modal");
}

function sponsorDeckButton(profile, label = "Ver Sponsor Deck") {
  return sponsorDeckIsReady(profile)
    ? `<button class="btn" type="button" data-sponsor-deck-profile="${escapeAttr(profile.id)}">${label}</button>`
    : "";
}

function renderAthleteSponsorDeck() {
  const profile = currentAthlete();
  if (!profile) {
    panel("athlete-sponsor-deck", "Sponsor Deck ROIS", "Propuesta comercial estructurada", `<div class="empty">Completa primero tu perfil ROIS.</div>`);
    return;
  }
  const founder = isFounderProfile(profile);
  const deck = sponsorDeckData(profile);
  const deckMedia = sponsorDeckMedia(profile, deck || {});
  const defaultProof = founder ? profile.past_collaborations || profile.ranking : profile.ranking;
  const defaultAudience = founder
    ? [profile.audience_size ? `${Number(profile.audience_size).toLocaleString("es-MX")} personas` : "", profile.engagement_rate ? `${profile.engagement_rate}% engagement` : "", profile.audience_location || ""].filter(Boolean).join(" · ")
    : `Audiencia interesada en ${profile.sport || "deporte"}, rendimiento, estilo de vida y comunidad en ${profile.location || "Mexico"}.`;
  panel("athlete-sponsor-deck", "Sponsor Deck ROIS", founder ? "Convierte audiencia y contenido en una propuesta clara para marcas" : "Convierte trayectoria y resultados en una propuesta clara para sponsors", `
    <div class="panel-body sponsor-deck-builder">
      <div class="section-minihead">
        <p class="eyebrow">Metodologia comercial ROIS</p>
        <h3>Construye una propuesta capaz de ocupar tus 10 espacios de patrocinio.</h3>
        <p>Organiza tu narrativa, evidencia, audiencia, beneficios y activos visuales para que cada patrocinador entienda el valor de una relacion mensual.</p>
      </div>
      <div class="sponsor-deck-ai-coming">
        <span class="pill">ROIS IA · Proximamente</span>
        <p>Tu propuesta ya puede estructurarse y guardarse con la metodologia comercial ROIS. Proximamente ROIS IA podra optimizar automaticamente la narrativa, los beneficios y la propuesta de valor.</p>
      </div>
      <div class="sponsor-deck-progress">
        <div><span>Completitud actual</span><strong>${Number(profile.sponsor_deck_score || 0)}%</strong></div>
        <div><span>Estado</span><strong>${deck ? "Listo para revisar" : "Borrador pendiente"}</strong></div>
        <div><span>Capacidad</span><strong>${Math.min(10, Number(profile.max_sponsors || 10))} sponsors / mes</strong></div>
      </div>
      ${deck ? sponsorDeckMarkup(profile) : ""}
      <form id="sponsorDeckForm" class="form-grid sponsor-deck-form">
        <label style="grid-column:1/-1">Objetivo comercial<textarea name="objective" required placeholder="Que quieres lograr con una marca en los proximos 6 a 12 meses.">${escapeHtml(deck?.commercialObjective || "")}</textarea></label>
        <label style="grid-column:1/-1">Por que eres diferente<textarea name="differentiator" required placeholder="Tu historia, ventaja, comunidad, disciplina, estilo o posicionamiento unico.">${escapeHtml(deck?.positioning || profile.stats || "")}</textarea></label>
        <label style="grid-column:1/-1">Audiencia y comunidad<textarea name="audience" required placeholder="Quienes te siguen, ubicacion, intereses y datos relevantes.">${escapeHtml(deck?.audience || defaultAudience)}</textarea></label>
        <label style="grid-column:1/-1">Evidencia y resultados<textarea name="proof" required placeholder="Un resultado por linea: ranking, alcance, engagement, conversion, aparicion o logro.">${escapeHtml(sponsorDeckList(deck?.proofPoints || defaultProof).join("\n"))}</textarea></label>
        <label style="grid-column:1/-1">Marcas y categorias compatibles<textarea name="brand_fit" required placeholder="Deporte; bienestar; tecnologia; moda; movilidad; hospitalidad...">${escapeHtml(sponsorDeckList(deck?.brandFit || profile.brand_categories).join("\n"))}</textarea></label>
        <label style="grid-column:1/-1">Entregables disponibles<textarea name="deliverables" required placeholder="Un entregable por linea: publicaciones, reels, presencia, contenido, licencias, clinicas...">${escapeHtml(sponsorDeckList(deck?.deliverables || profile.deliverables).join("\n"))}</textarea></label>
        <label style="grid-column:1/-1">Beneficios y ventajas para patrocinadores<textarea name="benefits" required placeholder="Un beneficio por linea: visibilidad, integracion de marca, contenido, hospitalidad, acceso a comunidad, presencia en eventos...">${escapeHtml(sponsorDeckList(deck?.benefits || deck?.deliverables || profile.deliverables).join("\n"))}</textarea></label>
        <div class="sponsor-deck-fixed-offer" style="grid-column:1/-1"><div><span>Ticket mensual por patrocinador</span><strong>$${Number(profile.monthly || 5000).toLocaleString("es-MX")} MXN</strong></div><div><span>Espacios disponibles</span><strong>Hasta ${Math.min(10, Number(profile.max_sponsors || 10))}</strong></div></div>
        <div class="sponsor-deck-media-editor" style="grid-column:1/-1">
          <div class="section-minihead"><p class="eyebrow">Activos visuales</p><h3>Agrega dos imagenes de valor para patrocinadores.</h3><p>Calendario de competiciones, perfil de eventos, audiencia presencial, espacios de marca o evidencia de resultados.</p></div>
          <div class="sponsor-deck-media-inputs">
            <label>Imagen 1<input name="deck_image_1" type="file" accept="image/png,image/jpeg,image/webp"><span>${deckMedia[0] ? "Imagen actual conservada si no seleccionas otra." : "JPG, PNG o WEBP. Maximo 5 MB."}</span></label>
            <label>Descripcion imagen 1<input name="deck_caption_1" value="${escapeAttr(deckMedia[0]?.caption || "")}" placeholder="Ej. Calendario competitivo 2026"></label>
            <label>Imagen 2<input name="deck_image_2" type="file" accept="image/png,image/jpeg,image/webp"><span>${deckMedia[1] ? "Imagen actual conservada si no seleccionas otra." : "JPG, PNG o WEBP. Maximo 5 MB."}</span></label>
            <label>Descripcion imagen 2<input name="deck_caption_2" value="${escapeAttr(deckMedia[1]?.caption || "")}" placeholder="Ej. Evento con presencia para marcas"></label>
          </div>
          ${deckMedia.length ? `<div class="sponsor-deck-media-grid current">${deckMedia.map((item, index) => `<figure>${safeProfileImageMarkup(item.url, item.caption || `Imagen ${index + 1}`)}<figcaption>${escapeHtml(item.caption || `Imagen ${index + 1}`)}</figcaption></figure>`).join("")}</div>` : ""}
        </div>
        <div class="sponsor-deck-managed-contact"><span>Contacto comercial</span><strong>Gestionado exclusivamente por ROIS</strong><p>Las empresas no reciben correos, telefonos ni datos de contacto directo del perfil.</p></div>
        <button class="btn primary" type="submit">${deck ? "Actualizar propuesta ROIS" : "Generar propuesta ROIS"}</button>
      </form>
    </div>
  `);
  document.getElementById("sponsorDeckForm")?.addEventListener("submit", submitSponsorDeck);
}

async function sponsorDeckMediaFromForm(form, context, currentDeck = {}) {
  const existing = sponsorDeckMedia({}, currentDeck);
  const media = [];
  for (let index = 0; index < 2; index += 1) {
    const slot = index + 1;
    const file = form.elements.namedItem(`deck_image_${slot}`)?.files?.[0];
    const caption = String(form.elements.namedItem(`deck_caption_${slot}`)?.value || "").trim();
    if (file) {
      const uploaded = await uploadProfileAsset(file, "deck", context);
      media.push({ url: uploaded.url, path: uploaded.path, name: uploaded.name, mime: uploaded.mime, caption: caption || `Activo de patrocinio ${slot}` });
    } else if (existing[index]?.url) {
      media.push({ ...existing[index], caption: caption || existing[index].caption || `Activo de patrocinio ${slot}` });
    }
  }
  return media;
}

async function submitSponsorDeck(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const context = getCurrentProfileContext();
  const profile = currentAthlete();
  if (!context || !profile) return;
  const invalid = [...form.querySelectorAll("[required]")].find(field => !String(field.value || "").trim());
  if (invalid) {
    invalid.focus();
    notify("Sponsor Deck", "Falta informacion", "Completa todos los campos requeridos antes de generar el deck.");
    return;
  }
  setSavingState(form, true);
  let media;
  try {
    media = await sponsorDeckMediaFromForm(form, context, sponsorDeckData(profile) || {});
  } catch (error) {
    setSavingState(form, false);
    notify("Sponsor Deck", "No fue posible cargar las imagenes", humanError(error));
    return;
  }
  const payload = sponsorDeckFormPayload(form, profile, context.role, media);
  const fallback = localSponsorDeckDraft(payload);
  let generated = fallback;
  let roisIAUsed = false;
  if (roisIAEnabled) {
    try {
      generated = normalizeSponsorDeck(await requestSponsorDeckAI(payload), fallback);
      generated.generatedBy = "rois-ia";
      roisIAUsed = true;
    } catch (error) {
      console.warn("[ROIS IA] La optimizacion no respondio", humanError(error));
    }
  }
  try {
    const score = sponsorDeckQualityScore(payload, profile);
    const updated = await saveProfileRecord({
      sponsor_deck: generated,
      sponsor_deck_status: "ready",
      sponsor_deck_score: score,
      sponsor_deck_updated_at: new Date().toISOString()
    }, context);
    refreshProfileViews(context.role, updated);
    renderAthleteSponsorDeck();
    notify("Sponsor Deck ROIS", roisIAUsed ? "Propuesta mejorada con ROIS IA" : "Propuesta ROIS guardada", roisIAUsed
      ? "ROIS IA optimizo beneficios, evidencia y propuesta de valor. Revisala antes de presentarla a empresas."
      : "Tu Sponsor Deck fue estructurado y guardado correctamente con la metodologia comercial ROIS.");
  } catch (error) {
    const message = /sponsor_deck|schema cache|PGRST204/i.test(String(error?.message || ""))
      ? "Falta ejecutar supabase-sponsor-deck-ai-mvp.sql antes de guardar el deck."
      : humanError(error);
    notify("Sponsor Deck", "No fue posible guardar", message);
  } finally {
    setSavingState(form, false);
  }
}

function athleteProfileHero(athlete, logos = athleteSponsorLogos(athlete), options = {}) {
  const readOnly = Boolean(options.readOnly);
  const companyView = Boolean(options.companyView);
  const founder = isFounderProfile(athlete);
  const copy = verticalCopy(athlete);
  const showPostsTab = true;
  const posts = state.data.athlete_posts
    .filter(item => item.athlete_email === athlete.email && item.status === "approved")
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, 12);
  const email = athlete.email || state.session?.email || "";
  const results = state.data.athlete_results.filter(item => item.athlete_email === email);
  const profilePhoto = athlete.image_url
    ? safeProfileImageMarkup(athlete.image_url, athlete.name || "Perfil ROIS")
    : `<span>${profileInitials(athlete.name)}</span>`;
  const sponsorHighlights = logos.slice(0, 10);
  const hasPosts = posts.length > 0;
  const hasResults = results.length > 0;
  const primaryValue = athlete.sport || (founder ? creatorTypeLabel(athlete.creator_type) : "Disciplina por definir");
  const secondaryValue = athlete.category || (founder ? "Nicho por definir" : "Categoria por definir");
  const locationValue = athlete.location || (founder ? "Base por confirmar" : "Ciudad por confirmar");
  const summaryFallback = founder
    ? "Perfil de creador en construccion. Documenta audiencia, engagement, contenido y resultados para presentar una propuesta atractiva a marcas."
    : "Perfil deportivo en construccion. Sube tu plan de trabajo, resultados y publicaciones para presentar una propuesta atractiva a patrocinadores.";
  const postsEmptyText = readOnly ? "Este perfil aun no ha publicado contenido." : copy.postsEmptyText;
  const resultsEmptyText = founder
    ? "Tus resultados de contenido y campanas apareceran aqui. Sube evidencia para fortalecer la confianza de las marcas."
    : "Tus resultados documentados apareceran aqui. Sube evidencia mensual para construir confianza con patrocinadores.";
  const videoCtaLabel = founder ? "Ver portafolio" : "Ver plan deportivo";
  const videoPendingLabel = founder ? "Portafolio pendiente" : "Plan deportivo pendiente";
  return `
    <section class="athlete-profile-hero athlete-social-profile">
      <div class="athlete-social-header">
        <div class="athlete-social-avatar">
          ${profilePhoto}
        </div>
        <div class="athlete-social-bio">
          <div class="athlete-social-name">
            <h3>${escapeHtml(athlete.name || copy.profileDefaultName)}</h3>
            ${badge(athlete.status === "approved" ? "perfil activo" : "en revision")}
          </div>
          <div class="athlete-social-stats">
            <div><strong>${posts.length}</strong><span>publicaciones</span></div>
            <div><strong>${founder ? creatorAudienceLabel(athlete) : sponsorHighlights.length}</strong><span>${founder ? "audiencia" : "sponsors"}</span></div>
            <div><strong>${founder ? creatorEngagementLabel(athlete) : results.length}</strong><span>${founder ? "engagement" : "resultados"}</span></div>
          </div>
          <p><strong>${escapeHtml(primaryValue)}</strong> / ${escapeHtml(secondaryValue)} / ${escapeHtml(locationValue)}</p>
          <p>${escapeHtml(athlete.stats || summaryFallback)}</p>
          <div class="athlete-social-actions">
            ${readOnly ? `
              ${athleteSponsorCta(athlete, "Solicitar fichaje")}
              ${sponsorDeckButton(athlete)}
               ${profileSocialLinksMarkup(athlete)}
            ` : `
            ${button("Editar perfil", () => {
              const details = document.getElementById("athleteEditProfile");
              if (details) {
                details.open = !details.open;
                if (details.open) details.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            })}
            ${sponsorDeckIsReady(athlete) ? sponsorDeckButton(athlete, "Ver Sponsor Deck") : `<button class="btn" type="button" data-dashboard-shortcut="athlete-sponsor-deck">Crear Sponsor Deck con IA</button>`}
            ${athlete.video_url ? `<a class="btn" href="${escapeAttr(athlete.video_url)}" target="_blank" rel="noopener">${videoCtaLabel}</a>` : `<span class="pill">${videoPendingLabel}</span>`}
            `}
          </div>
        </div>
      </div>

      <div class="athlete-social-highlights">
        ${athleteSponsorBubbleStrip(sponsorHighlights, { limit: 10, emptyLabel: "Disponible" })}
      </div>

      <div class="athlete-social-tabs">
        <button class="active" type="button" data-athlete-profile-tab="posts">Publicaciones</button>
        <button type="button" data-athlete-profile-tab="results">Resultados</button>
      </div>

      <div class="athlete-social-tab-content active" data-athlete-tab-panel="posts">
        ${hasPosts ? `
          <div class="athlete-social-grid">
            ${posts.map(post => athleteSocialPostTile(post, athlete, { canDelete: !readOnly })).join("")}
          </div>
        ` : `<div class="empty athlete-social-empty">${postsEmptyText}</div>`}
      </div>

      <div class="athlete-social-tab-content ${showPostsTab ? "" : "active"}" data-athlete-tab-panel="reels">
        ${hasPosts ? `
          <div class="athlete-social-grid reels-only">
            ${posts.map(post => athleteSocialPostTile(post, athlete, { canDelete: !readOnly })).join("")}
          </div>
        ` : `<div class="empty athlete-social-empty">${readOnly ? "Este perfil aun no ha publicado contenido." : "Aun no has publicado contenido. Sube avances, videos o evidencia desde archivos para fortalecer tu perfil."}</div>`}
      </div>

      <div class="athlete-social-tab-content" data-athlete-tab-panel="results">
        ${hasResults ? `
          <div class="athlete-social-info-grid">
            ${results.map(result => athleteResultTile(result)).join("")}
          </div>
        ` : `<div class="empty athlete-social-empty">${resultsEmptyText}</div>`}
      </div>
    </section>
  `;
}

function renderAthleteProfile() {
  const athlete = currentAthlete();
  const copy = verticalCopy(athlete);
  if (!athlete) {
    panel("athlete-profile", "Mi perfil", "Perfil profesional para sponsors", `<div class="empty">${copy.profileEmptyText}</div>`);
    return;
  }
  const founder = isFounderProfile(athlete);
  const logos = athleteSponsorLogos(athlete);
  const annualRequired = athleteAnnualFeeRequired(athlete);
  panel("athlete-profile", "Mi perfil", "Perfil profesional para sponsors", `
    <div class="panel-body">
      ${athleteProfileHero(athlete, logos)}
      <details class="athlete-edit-drawer" id="athleteEditProfile">
        <summary>Editar informacion profesional</summary>
      <form id="athleteProfileForm" class="form-grid">
        <label>Nombre<input name="name" required value="${escapeAttr(athlete.name || "")}"></label>
        ${founder ? `
          <label>Tipo de creador<select name="creator_type" required>${creatorTypeOptionsMarkup(athlete.creator_type || "founder")}</select></label>
          <label>Nombre publico o artistico<input name="public_name" value="${escapeAttr(athlete.public_name || athlete.name || "")}" placeholder="Nombre visible para marcas"></label>
          <label>Proyecto, canal o marca personal<input name="venture_name" required value="${escapeAttr(athlete.venture_name || "")}" placeholder="Nombre del proyecto creativo"></label>
          <label>Plataforma principal<select name="primary_platform" required>
            <option value="">Selecciona</option>
            ${["Instagram", "TikTok", "YouTube", "Facebook", "LinkedIn", "Twitch", "Spotify", "Podcast", "Eventos en vivo", "Multiplataforma"].map(value => `<option ${athlete.primary_platform === value ? "selected" : ""}>${value}</option>`).join("")}
          </select></label>
          <label>Audiencia total<input name="audience_size" type="number" min="0" step="1" value="${Number(athlete.audience_size || 0)}" placeholder="Seguidores o suscriptores"></label>
          <label>Engagement promedio %<input name="engagement_rate" type="number" min="0" max="100" step="0.01" value="${Number(athlete.engagement_rate || 0)}"></label>
          <label>Mercado principal de audiencia<input name="audience_location" value="${escapeAttr(athlete.audience_location || "")}" placeholder="Mexico, LATAM, global..."></label>
          <label>Disponibilidad<select name="availability">
            <option value="available" ${athlete.availability === "available" ? "selected" : ""}>Disponible para campanas</option>
            <option value="limited" ${athlete.availability === "limited" ? "selected" : ""}>Disponibilidad limitada</option>
            <option value="unavailable" ${athlete.availability === "unavailable" ? "selected" : ""}>No disponible temporalmente</option>
          </select></label>
          <label style="grid-column:1/-1">Categorias de contenido<input name="content_categories" value="${escapeAttr(athlete.content_categories || "")}" placeholder="Musica, moda, tecnologia, lifestyle, gaming..."></label>
          <label style="grid-column:1/-1">Perfil de audiencia<textarea name="audience_demographics" placeholder="Edad, intereses, ubicacion y caracteristicas relevantes.">${escapeHtml(athlete.audience_demographics || "")}</textarea></label>
          <label style="grid-column:1/-1">Categorias de marca compatibles<input name="brand_categories" value="${escapeAttr(athlete.brand_categories || "")}" placeholder="Moda, consumo, tecnologia, movilidad, hospitalidad..."></label>
          <label style="grid-column:1/-1">Colaboraciones anteriores<textarea name="past_collaborations" placeholder="Marcas, campanas, eventos y resultados relevantes.">${escapeHtml(athlete.past_collaborations || "")}</textarea></label>
          <label style="grid-column:1/-1">Entregables disponibles<textarea name="deliverables" placeholder="Reels, historias, publicaciones, presencia, conciertos, licencias, embajadurias...">${escapeHtml(athlete.deliverables || "")}</textarea></label>
        ` : ""}
        <label>${copy.primaryFieldLabel}<input name="sport" required value="${escapeAttr(athlete.sport === "Por definir" ? "" : athlete.sport || "")}" placeholder="${escapeAttr(founder ? "Musica, moda, entretenimiento, lifestyle..." : "Disciplina principal")}"></label>
        <label>${copy.secondaryFieldLabel}<input name="category" required value="${escapeAttr(athlete.category || "")}"></label>
        <label>${copy.locationLabel}<input name="location" required value="${escapeAttr(athlete.location || "")}"></label>
        <label>${copy.rankingLabel}<input name="ranking" value="${escapeAttr(athlete.ranking || "")}"></label>
        <label>Ticket mensual objetivo<input name="monthly" type="number" min="0" value="${Number(athlete.monthly || 5000)}"></label>
        <label>M\u00e1ximo de patrocinadores<input name="max_sponsors" type="number" min="1" max="10" value="${Math.min(10, Number(athlete.max_sponsors || 10))}"></label>
        <label>Foto de perfil<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <label style="grid-column:1/-1">${copy.summaryLabel}<textarea name="stats" required placeholder="${escapeAttr(copy.summaryPlaceholder)}">${escapeHtml(athlete.stats || "")}</textarea></label>
        <label style="grid-column:1/-1">${copy.videoLabel} opcional<input name="video_url" type="url" value="${escapeAttr(athlete.video_url || "")}" placeholder="YouTube, Vimeo, Drive o video publicado"></label>
        <label>Instagram<input name="instagram_url" type="url" value="${escapeAttr(athlete.instagram_url || "")}" placeholder="https://instagram.com/usuario"></label>
        <label>TikTok<input name="tiktok_url" type="url" value="${escapeAttr(athlete.tiktok_url || "")}" placeholder="https://tiktok.com/@usuario"></label>
        <label>Facebook<input name="facebook_url" type="url" value="${escapeAttr(athlete.facebook_url || "")}" placeholder="https://facebook.com/perfil"></label>
        <label>LinkedIn<input name="linkedin_url" type="url" value="${escapeAttr(athlete.linkedin_url || "")}" placeholder="https://linkedin.com/in/perfil"></label>
        <label style="grid-column:1/-1">Logos de sponsors actuales opcional<input name="sponsor_logo_files" type="file" accept="image/png,image/jpeg,image/webp" multiple></label>
        <label style="grid-column:1/-1">Nombre de marcas patrocinadoras opcional<textarea name="sponsor_logo_names" placeholder="Una marca por linea, en el mismo orden de los logos."></textarea></label>
        <label class="check-option" style="grid-column:1/-1"><input name="terms_accepted" type="checkbox" ${athlete.terms_accepted ? "checked" : ""}><span>Acepto que la informacion y los medios de este perfil sean revisados y mostrados dentro de ROIS.</span></label>
        <div class="profile-status-grid" style="grid-column:1/-1">
          <div>
            <span>Sponsor Deck ROIS</span>
            <strong>${sponsorDeckIsReady(athlete) ? "Disponible" : "Pendiente"}</strong>
            ${sponsorDeckIsReady(athlete) ? sponsorDeckButton(athlete, "Ver Sponsor Deck") : `<button class="btn" type="button" data-dashboard-shortcut="athlete-sponsor-deck">Crear con IA</button>`}
          </div>
          <div>
            <span>Link mensual admin</span>
            <strong>${athlete.sponsor_payment_url ? "Asignado" : "Pendiente por ROIS"}</strong>
          </div>
          <div>
            <span>Pago anual</span>
            <strong>${annualRequired ? `$${athleteAnnualFeeAmount.toLocaleString("es-MX")} MXN` : "No solicitado"}</strong>
            ${annualRequired ? `<button class="btn" type="button" data-stripe-key="athleteAnnualProfile">Pagar anualidad</button>` : `<span>Completa tu perfil. ROIS habilitara el pago cuando corresponda.</span>`}
          </div>
        </div>
        <div class="athlete-sponsor-brands" style="grid-column:1/-1"><span>Sponsors actuales</span>${athleteSponsorBubbleStrip(logos, { limit: 10, emptyLabel: "Disponible", compact: true })}</div>
        <button class="btn primary" type="submit">Guardar perfil</button>
      </form>
      </details>
    </div>
  `);
  document.getElementById("athleteProfileForm").addEventListener("submit", submitAthleteProfile);
  document.querySelectorAll("[data-athlete-profile-tab]").forEach(button => {
    button.addEventListener("click", () => activateAthleteProfileTab(button.dataset.athleteProfileTab));
  });
  if (annualRequired) document.querySelector("[data-stripe-key='athleteAnnualProfile']")?.addEventListener("click", () => openStripeCheckout("athleteAnnualProfile", founder ? "Anualidad Creador ROIS" : "Anualidad Deportiva ROIS"));
}

function renderAthleteSponsorships() {
  const athlete = currentAthlete();
  const copy = verticalCopy(athlete);
  const email = state.session?.email || "";
  const name = athlete?.name || state.session?.name || "";
  const rows = state.data.sponsorships.filter(item => item.athlete === name || item.athlete_email === email).map(item => [
    item.company || "Empresa en revisi\u00f3n",
    `$${Number(item.amount || 0).toLocaleString("es-MX")} MXN`,
    item.details || "Condiciones por confirmar",
    badge(item.status)
  ]);
  panel("athlete-sponsorships", copy.sponsorshipsTitle, copy.sponsorshipsSubtitle, rows.length ? table(["Empresa", "Monto", "Condiciones", "Estado"], rows) : `<div class="empty">Cuando una empresa te contacte para respaldarte, aparecera aqui.</div>`);
}

function scoutRulesList(profile = currentAthlete()) {
  const founder = isFounderProfile(profile);
  const singularProfile = founder ? "founder" : "deportista";
  return `
    <ul class="scout-rules">
      <li>El scout no puede cobrar dinero directamente al ${singularProfile}.</li>
      <li>El pago de inscripcion se hace unicamente a ROIS.</li>
      <li>La comision es de $${scoutCommissionAmount.toLocaleString("es-MX")} MXN por cuenta pagada y validada.</li>
      <li>No se paga por registros incompletos ni cuentas duplicadas.</li>
      <li>No se puede prometer patrocinio automatico ni decir que ROIS garantiza sponsors.</li>
      <li>ROIS es una plataforma para construir perfil, documentar evolucion y aspirar a patrocinios.</li>
      <li>${founder ? "Si el founder representa una entidad legal, debe compartir informacion valida y verificable para su revision." : "Si el atleta es menor de edad, debe existir autorizacion de madre, padre o tutor."}</li>
      <li>ROIS puede cancelar comisiones por fraude, abuso o informacion falsa.</li>
    </ul>
  `;
}

function renderAthleteScouts() {
  const athlete = currentAthlete();
  const copy = verticalCopy(athlete);
  const founder = isFounderProfile(athlete);
  const referredLabel = "Perfil";
  const referredPlural = "athletes y creadores";
  const talentLabel = "talento deportivo y creativo";
  if (!athlete) {
    panel("athlete-scouts", copy.scoutsTitle, "Red de invitacion ROIS", `<div class="empty">${copy.profileEmptyText}</div>`);
    return;
  }
  const code = scoutCodeForAthlete(athlete);
  const codeKey = scoutCodeKey(code);
  const sessionEmail = String(state.session?.email || "").trim().toLowerCase();
  const referrals = [
    ...(state.data.athletes || []).map(item => ({ ...item, _profile_table: "athletes" })),
    ...(state.data.founders || []).map(item => ({ ...item, _profile_table: "founders", role: "founder" }))
  ].filter(item =>
    String(item.email || item.contact || "").trim().toLowerCase() !== sessionEmail &&
    scoutCodeKey(item.invited_by_scout_code) === codeKey
  );
  const weekStart = currentWeekStart();
  const eligibleRows = referrals.filter(item => scoutReferralStatus(item).eligible);
  const weeklyRows = eligibleRows.filter(item => new Date(item.created_at || 0) >= weekStart);
  const rows = referrals.map(item => {
    const status = scoutReferralStatus(item);
    return [
      escapeHtml(item.name || referredLabel),
      badge(item._profile_table === "founders" ? "creador" : "athlete"),
      badge(item.created_at ? "registrado" : "registro"),
      status.paid ? badge("pagado") : badge("sin pago"),
      status.profile ? badge("perfil completo") : badge("perfil pendiente"),
      status.validated ? badge("validado") : badge("revision ROIS"),
      status.eligible ? `$${scoutCommissionAmount.toLocaleString("es-MX")} MXN` : "$0 MXN"
    ];
  });
  panel("athlete-scouts", copy.scoutsTitle, copy.scoutsSubtitle, `
    <div class="panel-body scout-dashboard">
      <div class="scout-code-card">
        <div>
          <p class="eyebrow">Codigo Scout ROIS</p>
          <h3>${code}</h3>
          <p>${athlete.scout_active ? `Tu codigo esta activo para invitar ${referredPlural}.` : `Unete a la red para activar tu codigo y empezar a invitar ${referredPlural}.`}</p>
        </div>
        <div class="scout-actions">
          ${athlete.scout_active ? button("Copiar codigo", () => copyScoutCode(code)) : button("Unirme a Scouts ROIS", () => activateScoutNetwork(athlete))}
        </div>
      </div>
      <div class="scout-metrics">
        <div><span>Referidos</span><strong>${referrals.length}</strong></div>
        <div><span>Validados</span><strong>${eligibleRows.length}</strong></div>
        <div><span>Semana</span><strong>$${(weeklyRows.length * scoutCommissionAmount).toLocaleString("es-MX")}</strong></div>
        <div><span>Total</span><strong>$${(eligibleRows.length * scoutCommissionAmount).toLocaleString("es-MX")}</strong></div>
      </div>
      <div class="scout-policy">
        <p class="eyebrow">Reglas obligatorias</p>
        <p>La comision sigue siendo de $${scoutCommissionAmount.toLocaleString("es-MX")} MXN por referido directo activo y validado por ROIS.</p>
        <p>Comparte tu codigo con ${referredPlural}, comunidades y perfiles alineados con el ${talentLabel} que quieres acercar al ecosistema.</p>
        ${scoutRulesList(athlete)}
      </div>
    </div>
    ${rows.length ? table([referredLabel, "Tipo", "Registro", "Pago", "Perfil", "Validacion", "Comision"], rows) : `<div class="empty">Aun no hay ${referredPlural} registrados con tu codigo.</div>`}
  `);
}

function renderAthleteResults() {
  const athlete = currentAthlete();
  const copy = verticalCopy(athlete);
  const email = state.session?.email || "";
  const rows = state.data.athlete_results.filter(item => item.athlete_email === email).map(item => [
    item.month,
    item.summary,
    item.proof_url ? `<a class="btn" href="${item.proof_url}" target="_blank" rel="noopener">Ver soporte</a>` : badge("sin soporte"),
    badge(item.status)
  ]);
  panel("athlete-results", copy.resultsTitle, copy.resultsSubtitle, `
    <div class="panel-body">
      <form id="athleteResultForm" class="form-grid">
        <label>Mes<input name="month" required placeholder="${escapeAttr(copy.resultMonthPlaceholder)}"></label>
        <label>Hito / actividad<input name="event" required placeholder="${escapeAttr(copy.resultEventPlaceholder)}"></label>
        <label style="grid-column:1/-1">Resultado documentado<textarea name="summary" required placeholder="${escapeAttr(copy.resultSummaryPlaceholder)}"></textarea></label>
        <label style="grid-column:1/-1">Documento o imagen soporte<input name="proof" type="file" accept="image/png,image/jpeg,image/webp,application/pdf"></label>
        <button class="btn primary" type="submit">Subir resultado</button>
      </form>
    </div>
    ${rows.length ? table(["Mes", "Resumen", "Soporte", "Estado"], rows) : `<div class="empty">A\u00fan no has subido resultados mensuales.</div>`}
  `);
  document.getElementById("athleteResultForm").addEventListener("submit", submitAthleteResult);
}

function renderAthleteReels() {
  const email = state.session?.email || "";
  const posts = state.data.athlete_posts.filter(item => item.athlete_email === email).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  panel("athlete-reels", "Publicaciones", "Publica avances visibles para empresas", `
    <div class="panel-body">
      <form id="athletePostForm" class="form-grid">
        <label>T\u00edtulo<input name="title" required placeholder="Avance destacado"></label>
        <label>Video o archivo de publicaci\u00f3n<input name="video_file" type="file" required accept="video/mp4,video/webm,video/quicktime"></label>
        <label style="grid-column:1/-1">Descripci\u00f3n<textarea name="caption" required placeholder="Contexto, avance y valor para sponsors."></textarea></label>
        <label style="grid-column:1/-1">Imagen miniatura opcional<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <button class="btn primary" type="submit">Publicar contenido</button>
      </form>
      ${posts.length ? `<div class="athlete-own-reels">${posts.map(post => athleteOwnReelCard(post)).join("")}</div>` : `<div class="empty">Aun no has publicado contenido.</div>`}
    </div>
  `);
  document.getElementById("athletePostForm").addEventListener("submit", submitAthletePost);
}

function recordWithinDays(record, days) {
  const createdAt = new Date(record?.created_at || 0).getTime();
  return createdAt > 0 && createdAt >= Date.now() - (days * 86400000);
}

function growthRate(numerator, denominator) {
  return denominator > 0 ? Math.round((Number(numerator || 0) / denominator) * 100) : 0;
}

function adminGrowthSnapshotFromState() {
  const data = normalizeLoadedData(state.data || {});
  const talent = [...data.athletes, ...data.founders];
  const profiles = data.profiles || [];
  const companies = data.companies || [];
  const publicAthletes = data.athletes.filter(item => item.status === "approved" && item.visual_status === "approved");
  const publicCreators = data.founders.filter(item => item.status === "approved" && item.visual_status === "approved");
  const publicTalent = [...publicAthletes, ...publicCreators];
  const deckReady = publicTalent.filter(profile => sponsorDeckIsReady(profile));
  const referrals = talent.filter(item => String(item.invited_by_scout_code || "").trim());
  const validatedReferrals = referrals.filter(item =>
    ["validated", "approved", "paid"].includes(String(item.scout_validation_status || item.scout_commission_status || "").toLowerCase())
  );
  const activeSubscriptions = data.company_subscriptions.filter(item =>
    ["active", "trialing"].includes(String(item.status || "").toLowerCase())
  );
  const income = incomePayments(data.payments || []);
  const activeSponsorships = data.sponsorships.filter(item =>
    !["rejected", "deleted", "cancelled"].includes(String(item.status || "").toLowerCase())
  );
  const pendingVisualTalent = talent.filter(item =>
    item.status === "pending" || item.visual_status === "pending_review"
  ).length;
  return {
    generatedAt: new Date().toISOString(),
    exact: false,
    totalProfiles: profiles.length,
    totalCompanies: companies.length,
    totalAthletes: data.athletes.length,
    totalCreators: data.founders.length,
    registrations24h: profiles.filter(item => recordWithinDays(item, 1)).length,
    registrations7d: profiles.filter(item => recordWithinDays(item, 7)).length,
    registrations30d: profiles.filter(item => recordWithinDays(item, 30)).length,
    talent7d: talent.filter(item => recordWithinDays(item, 7)).length,
    companies7d: companies.filter(item => recordWithinDays(item, 7)).length,
    publicAthletes: publicAthletes.length,
    publicCreators: publicCreators.length,
    deckReady: deckReady.length,
    activeScouts: talent.filter(item => item.scout_active === true).length,
    referrals: referrals.length,
    validatedReferrals: validatedReferrals.length,
    activeSponsorships: activeSponsorships.length,
    sponsorshipPipelineValue: activeSponsorships.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    listingsLive: data.company_listings.filter(item => item.status === "approved" && item.visual_status === "approved").length,
    marketplaceLeads: data.marketplace_leads.length,
    closedLeads: data.marketplace_leads.filter(item => item.status === "closed").length,
    pendingEvents: data.events.filter(item => item.status === "pending" || item.visual_status === "pending_review").length,
    activePro: activeSubscriptions.filter(item => item.plan === "pro").length,
    activeBusiness: activeSubscriptions.filter(item => item.plan === "business").length,
    paidRevenue: income.filter(item => item.status === "paid").reduce((sum, item) => sum + Number(item.amount || 0), 0),
    pendingRevenue: income.filter(item => item.status !== "paid").reduce((sum, item) => sum + Number(item.amount || 0), 0),
    pendingProfiles: profiles.filter(item => item.status === "pending").length + companies.filter(item => item.status === "pending").length,
    pendingVisualTalent,
    pendingListings: data.company_listings.filter(item => item.status === "pending" || item.visual_status === "pending_review").length,
    sponsorReviews: data.sponsorships.filter(item => item.status === "review").length,
    planRequests: data.requests.filter(item => item.type === "Plan empresarial" && item.status !== "closed").length,
    profileAlerts: profileDiagnostics().length
  };
}

async function loadAdminGrowthSnapshot(options = {}) {
  if (!options.force && adminGrowthSnapshot && Date.now() - adminGrowthSnapshotLoadedAt < dashboardPanelFreshnessMs) return adminGrowthSnapshot;
  if (adminGrowthSnapshotPromise) return adminGrowthSnapshotPromise;
  adminGrowthSnapshotPromise = (async () => {
    try {
      const snapshot = api.loadAdminGrowthSnapshot
        ? await api.loadAdminGrowthSnapshot()
        : null;
      adminGrowthSnapshot = snapshot && typeof snapshot === "object"
        ? { ...snapshot, exact: snapshot.exact !== false }
        : adminGrowthSnapshotFromState();
    } catch (error) {
      console.warn("[ROIS admin control] Usa el fallback local hasta ejecutar supabase-admin-growth-control.sql", humanError(error));
      adminGrowthSnapshot = adminGrowthSnapshotFromState();
    } finally {
      adminGrowthSnapshotLoadedAt = Date.now();
      adminGrowthSnapshotPromise = null;
    }
    return adminGrowthSnapshot;
  })();
  return adminGrowthSnapshotPromise;
}

function adminControlMetric(label, value, note = "") {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ""}</div>`;
}

function adminControlSignal(label, value, target, targetPanel, inverse = false) {
  const numeric = Number(value || 0);
  const healthy = inverse ? numeric <= target : numeric >= target;
  const warning = inverse ? numeric <= target * 2 : numeric >= target * 0.5;
  const status = healthy ? "estable" : warning ? "atencion" : "critico";
  return `
    <article class="admin-control-signal ${status}">
      <div><p class="eyebrow">${escapeHtml(status)}</p><h4>${escapeHtml(label)}</h4></div>
      <strong>${escapeHtml(String(value))}</strong>
      ${button("Abrir", () => showDashboardPanel(targetPanel))}
    </article>
  `;
}

function renderAdminControlLegacy() {
  const snapshot = adminGrowthSnapshot || adminGrowthSnapshotFromState();
  const totalTalent = Number(snapshot.totalAthletes || 0) + Number(snapshot.totalCreators || 0);
  const publicTalent = Number(snapshot.publicAthletes || 0) + Number(snapshot.publicCreators || 0);
  const demand = Number(snapshot.activeSponsorships || 0) + Number(snapshot.marketplaceLeads || 0);
  const deckCoverage = growthRate(snapshot.deckReady, publicTalent);
  const referralShare = growthRate(snapshot.referrals, totalTalent);
  const leadCloseRate = growthRate(snapshot.closedLeads, snapshot.marketplaceLeads);
  const ecosystem = Number(snapshot.totalCompanies || 0) + totalTalent;
  const northStar = Math.min(Number(snapshot.deckReady || 0), Math.max(demand, 0));
  const sourceNote = snapshot.exact ? "Metrica global del servidor" : "Vista parcial; instala el SQL de control para precision global";

  panel("admin-control", "Control ROIS", "Radiografia ejecutiva y crecimiento", `
    <div class="panel-body admin-control-hero">
      <div>
        <p class="eyebrow">North Star</p>
        <h2>${northStar} perfiles comercialmente conectables</h2>
        <p>Perfiles publicos con Sponsor Deck listo frente a demanda activa de empresas. ${escapeHtml(sourceNote)}.</p>
      </div>
      <div class="admin-control-hero-actions">
        ${button("Actualizar control", async () => {
          adminGrowthSnapshot = null;
          await loadAdminGrowthSnapshot({ force: true });
          renderAdminKpis();
          renderAdminControl();
        })}
        ${button("Revisar alertas", () => showDashboardPanel("admin-stats"))}
      </div>
    </div>

    <div class="panel-body">
      <div class="section-minihead"><p class="eyebrow">Pulso del negocio</p><h3>Lo que esta creciendo y lo que ya monetiza.</h3></div>
      <div class="scout-metrics admin-control-metrics">
        ${adminControlMetric("Registros 7 dias", snapshot.registrations7d, `${snapshot.registrations24h || 0} en 24 horas`)}
        ${adminControlMetric("Ecosistema", ecosystem, `${snapshot.totalCompanies || 0} empresas · ${totalTalent} talentos`)}
        ${adminControlMetric("Perfiles publicos", publicTalent, `${snapshot.publicAthletes || 0} athletes · ${snapshot.publicCreators || 0} creadores`)}
        ${adminControlMetric("Decks listos", snapshot.deckReady, `${deckCoverage}% de cobertura`)}
        ${adminControlMetric("Referidos", snapshot.referrals, `${referralShare}% del talento`)}
        ${adminControlMetric("Demanda activa", demand, `${leadCloseRate}% de leads cerrados`)}
        ${adminControlMetric("Pipeline sponsor", money(snapshot.sponsorshipPipelineValue), `${snapshot.activeSponsorships || 0} oportunidades`)}
        ${adminControlMetric("Ingreso pagado", money(snapshot.paidRevenue), `${money(snapshot.pendingRevenue)} pendiente`)}
      </div>
    </div>

    <div class="panel-body admin-control-funnels">
      <article class="admin-control-funnel">
        <p class="eyebrow">1 · Adquisicion</p><h3>${snapshot.registrations30d || 0} registros en 30 dias</h3>
        <dl><div><dt>Ultimas 24 h</dt><dd>${snapshot.registrations24h || 0}</dd></div><div><dt>Ultimos 7 dias</dt><dd>${snapshot.registrations7d || 0}</dd></div><div><dt>Talento nuevo 7d</dt><dd>${snapshot.talent7d || 0}</dd></div><div><dt>Empresas nuevas 7d</dt><dd>${snapshot.companies7d || 0}</dd></div></dl>
        ${button("Gestionar usuarios", () => showDashboardPanel("admin-users"))}
      </article>
      <article class="admin-control-funnel">
        <p class="eyebrow">2 · Activacion</p><h3>${deckCoverage}% con activo comercial</h3>
        <dl><div><dt>Athletes publicos</dt><dd>${snapshot.publicAthletes || 0}</dd></div><div><dt>Creadores publicos</dt><dd>${snapshot.publicCreators || 0}</dd></div><div><dt>Sponsor Deck listo</dt><dd>${snapshot.deckReady || 0}</dd></div><div><dt>Revision pendiente</dt><dd>${snapshot.pendingVisualTalent || 0}</dd></div></dl>
        ${button("Revisar talento", () => showDashboardPanel("admin-athletes"))}
      </article>
      <article class="admin-control-funnel">
        <p class="eyebrow">3 · Propagacion</p><h3>${snapshot.referrals || 0} altas por red Scout</h3>
        <dl><div><dt>Scouts activos</dt><dd>${snapshot.activeScouts || 0}</dd></div><div><dt>Referidos</dt><dd>${snapshot.referrals || 0}</dd></div><div><dt>Validados</dt><dd>${snapshot.validatedReferrals || 0}</dd></div><div><dt>Participacion</dt><dd>${referralShare}%</dd></div></dl>
        ${button("Ver red Scout", () => showDashboardPanel("admin-athletes"))}
      </article>
      <article class="admin-control-funnel">
        <p class="eyebrow">4 · Comercial</p><h3>${demand} señales de demanda</h3>
        <dl><div><dt>Patrocinios</dt><dd>${snapshot.activeSponsorships || 0}</dd></div><div><dt>Inventario live</dt><dd>${snapshot.listingsLive || 0}</dd></div><div><dt>Leads corporativos</dt><dd>${snapshot.marketplaceLeads || 0}</dd></div><div><dt>PRO / Business</dt><dd>${Number(snapshot.activePro || 0) + Number(snapshot.activeBusiness || 0)}</dd></div></dl>
        ${button("Abrir mercado", () => showDashboardPanel("admin-corporate-market"))}
      </article>
    </div>

    <div class="panel-body">
      <div class="section-minihead"><p class="eyebrow">Cola ejecutiva</p><h3>Acciones que frenan crecimiento o ingreso.</h3><p>Prioriza de izquierda a derecha: acceso, publicacion, demanda y salud de datos.</p></div>
      <div class="admin-control-signals">
        ${adminControlSignal("Cuentas pendientes", snapshot.pendingProfiles || 0, 0, "admin-users", true)}
        ${adminControlSignal("Talento por revisar", snapshot.pendingVisualTalent || 0, 0, "admin-athletes", true)}
        ${adminControlSignal("Eventos pendientes", snapshot.pendingEvents || 0, 0, "admin-events", true)}
        ${adminControlSignal("Inventario pendiente", snapshot.pendingListings || 0, 0, "admin-corporate-market", true)}
        ${adminControlSignal("Sponsors en revision", snapshot.sponsorReviews || 0, 0, "admin-payments", true)}
        ${adminControlSignal("Solicitudes de plan", snapshot.planRequests || 0, 0, "admin-corporate-market", true)}
        ${adminControlSignal("Alertas de datos", snapshot.profileAlerts || 0, 0, "admin-stats", true)}
      </div>
    </div>
  `);
}

function adminCommandMetric(label, value, note = "") {
  return `<div class="admin-command-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong><small>${escapeHtml(note)}</small></div>`;
}

function adminPriorityRow(label, value, targetPanel, context) {
  return `
    <div class="admin-priority-row">
      <span class="admin-priority-mark" aria-hidden="true"></span>
      <div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(context)}</small></div>
      <b>${Number(value || 0)}</b>
      ${button("Resolver", () => showDashboardPanel(targetPanel))}
    </div>
  `;
}

function adminFlowRow(index, label, value, note, targetPanel) {
  return `
    <div class="admin-flow-row">
      <span>${String(index).padStart(2, "0")}</span>
      <div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(note)}</small></div>
      <b>${escapeHtml(String(value))}</b>
      ${button("Ver", () => showDashboardPanel(targetPanel))}
    </div>
  `;
}

function renderAdminControl() {
  const snapshot = adminGrowthSnapshot || adminGrowthSnapshotFromState();
  const totalTalent = Number(snapshot.totalAthletes || 0) + Number(snapshot.totalCreators || 0);
  const publicTalent = Number(snapshot.publicAthletes || 0) + Number(snapshot.publicCreators || 0);
  const demand = Number(snapshot.activeSponsorships || 0) + Number(snapshot.marketplaceLeads || 0);
  const deckCoverage = growthRate(snapshot.deckReady, publicTalent);
  const referralShare = growthRate(snapshot.referrals, totalTalent);
  const leadCloseRate = growthRate(snapshot.closedLeads, snapshot.marketplaceLeads);
  const scoutK = Number(snapshot.activeScouts || 0) > 0
    ? (Number(snapshot.referrals || 0) / Number(snapshot.activeScouts)).toFixed(1)
    : "0.0";
  const sourceNote = snapshot.exact
    ? "Sincronizado con la base global"
    : "Vista parcial hasta instalar el SQL de control";
  const priorities = [
    ["Sponsors en revision", snapshot.sponsorReviews, "admin-payments", "Demanda comercial esperando decision"],
    ["Eventos pendientes", snapshot.pendingEvents, "admin-events", "Publicaciones que requieren validacion"],
    ["Talento por revisar", snapshot.pendingVisualTalent, "admin-athletes", "Perfiles fuera del mercado"],
    ["Inventario pendiente", snapshot.pendingListings, "admin-corporate-market", "Oferta empresarial sin publicar"],
    ["Cuentas pendientes", snapshot.pendingProfiles, "admin-users", "Accesos sin resolver"],
    ["Solicitudes de plan", snapshot.planRequests, "admin-corporate-market", "Conversion PRO o Business"],
    ["Alertas de datos", snapshot.profileAlerts, "admin-stats", "Integridad de perfiles y relaciones"]
  ].filter(([, value]) => Number(value || 0) > 0).sort((a, b) => Number(b[1]) - Number(a[1]));
  const openDecisionCount = priorities.reduce((sum, item) => sum + Number(item[1] || 0), 0);

  panel("admin-control", "", "", `
    <div class="admin-command">
      <header class="admin-command-head">
        <div>
          <p class="eyebrow">Executive command</p>
          <h2>${openDecisionCount ? `${openDecisionCount} decisiones abiertas` : "Operacion al dia"}</h2>
          <p>Una lectura ordenada de crecimiento, activacion, propagacion y demanda. ${escapeHtml(sourceNote)}.</p>
        </div>
        <div class="admin-command-actions">
          ${button("Actualizar", async () => {
            adminGrowthSnapshot = null;
            await loadAdminGrowthSnapshot({ force: true });
            renderAdminControl();
          })}
          ${button("Salud del sistema", () => showDashboardPanel("admin-stats"))}
        </div>
      </header>

      <div class="admin-command-strip">
        ${adminCommandMetric("Altas 7d", snapshot.registrations7d || 0, `${snapshot.registrations24h || 0} en 24 h`)}
        ${adminCommandMetric("Talento publico", publicTalent, `${snapshot.publicAthletes || 0} athletes / ${snapshot.publicCreators || 0} creadores`)}
        ${adminCommandMetric("Deck coverage", `${deckCoverage}%`, `${snapshot.deckReady || 0} listos`)}
        ${adminCommandMetric("K Scout", scoutK, `${snapshot.referrals || 0} referidos`)}
        ${adminCommandMetric("Demanda", demand, `${leadCloseRate}% cierre leads`)}
        ${adminCommandMetric("Pipeline", money(snapshot.sponsorshipPipelineValue), `${snapshot.activeSponsorships || 0} oportunidades`)}
      </div>

      <div class="admin-command-layout">
        <main>
          <section class="admin-command-section">
            <div class="admin-command-section-head"><div><p class="eyebrow">Prioridad ahora</p><h3>Decisiones pendientes</h3></div><span>${priorities.length} frentes</span></div>
            <div class="admin-priority-list">
              ${priorities.length
                ? priorities.map(item => adminPriorityRow(item[0], item[1], item[2], item[3])).join("")
                : `<div class="admin-command-empty"><strong>Sin bloqueos operativos.</strong><span>El sistema no registra decisiones pendientes.</span></div>`}
            </div>
          </section>

          <section class="admin-command-section">
            <div class="admin-command-section-head"><div><p class="eyebrow">Embudo</p><h3>Flujo del negocio</h3></div><span>30 dias</span></div>
            <div class="admin-flow-list">
              ${adminFlowRow(1, "Adquisicion", snapshot.registrations30d || 0, `${snapshot.talent7d || 0} talentos y ${snapshot.companies7d || 0} empresas en 7 dias`, "admin-users")}
              ${adminFlowRow(2, "Activacion", `${deckCoverage}%`, `${snapshot.deckReady || 0} perfiles con activo comercial`, "admin-athletes")}
              ${adminFlowRow(3, "Propagacion", `${referralShare}%`, `${snapshot.activeScouts || 0} Scouts activos / K ${scoutK}`, "admin-athletes")}
              ${adminFlowRow(4, "Demanda", demand, `${snapshot.marketplaceLeads || 0} leads / ${snapshot.activeSponsorships || 0} patrocinios`, "admin-corporate-market")}
            </div>
          </section>
        </main>

        <aside>
          <section class="admin-command-section admin-command-ledger">
            <div class="admin-command-section-head"><div><p class="eyebrow">Comercial</p><h3>Posicion actual</h3></div></div>
            <dl>
              <div><dt>Pipeline sponsor</dt><dd>${money(snapshot.sponsorshipPipelineValue)}</dd></div>
              <div><dt>Ingreso pagado</dt><dd>${money(snapshot.paidRevenue)}</dd></div>
              <div><dt>Ingreso pendiente</dt><dd>${money(snapshot.pendingRevenue)}</dd></div>
              <div><dt>Inventario publicado</dt><dd>${snapshot.listingsLive || 0}</dd></div>
              <div><dt>PRO / Business</dt><dd>${Number(snapshot.activePro || 0) + Number(snapshot.activeBusiness || 0)}</dd></div>
            </dl>
            ${button("Abrir ingresos", () => showDashboardPanel("admin-revenue"))}
          </section>

          <section class="admin-command-section admin-command-ledger">
            <div class="admin-command-section-head"><div><p class="eyebrow">Capacidad</p><h3>Red disponible</h3></div></div>
            <dl>
              <div><dt>Empresas</dt><dd>${snapshot.totalCompanies || 0}</dd></div>
              <div><dt>Deportistas</dt><dd>${snapshot.totalAthletes || 0}</dd></div>
              <div><dt>Creadores</dt><dd>${snapshot.totalCreators || 0}</dd></div>
              <div><dt>Referidos validados</dt><dd>${snapshot.validatedReferrals || 0}</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  `);
}

function renderAdmin() {
  const activePanel = document.querySelector('[data-dashboard="admin"] [data-dashboard-panel].active')?.dataset.dashboardPanel || "admin-control";
  renderAdminPanel(activePanel);
  if (activePanel === "admin-control" && !adminGrowthSnapshot && !adminGrowthSnapshotPromise) {
    loadAdminGrowthSnapshot().then(() => {
      if (activeDashboardPanelId("admin") === "admin-control") {
        renderAdminControl();
      }
    });
  }
}

function renderAdminPanel(targetId) {
  const map = {
    "admin-control": renderAdminControl,
    "admin-users": renderAdminUsers,
    "admin-athletes": renderAdminAthletes,
    "admin-founders": renderAdminFounders,
    "admin-payment-links": renderAdminPaymentLinks,
    "admin-athlete-notifications": renderAdminAthleteNotifications,
    "admin-events": renderAdminEvents,
    "admin-news": renderAdminNews,
    "admin-partners": renderAdminPartners,
    "admin-corporate-market": renderAdminCorporateMarket,
    "admin-crm": renderAdminCrm,
    "admin-revenue": renderAdminRevenue,
    "admin-payments": renderAdminPayments,
    "admin-uploads": renderAdminUploads,
    "admin-stats": renderAdminStats,
    "admin-settings": () => renderAccountSettings("admin-settings")
  };
  if (map[targetId]) map[targetId]();
  decoratePanelPagination(targetId);
}

const fiscalConfig = {
  ivaRate: 0.16,
  isrRate: 0.30,
  scoutCommissionMonthly: 500
};

const fixedExpenseConfig = [
  {
    id: "vehicle-rent",
    name: "Renta vehiculo",
    amount: 11600,
    frequency: "monthly",
    category: "Movilidad comercial",
    priority: "alta",
    status: "active"
  },
  {
    id: "department-rent",
    name: "Renta departamento",
    amount: 12000,
    frequency: "monthly",
    category: "Vivienda / base operativa",
    priority: "alta",
    status: "active"
  },
  {
    id: "veronica-payment",
    name: "Pago Veronica",
    amount: 5000,
    frequency: "monthly",
    category: "Obligacion financiera",
    priority: "alta",
    status: "active_until_december",
    notes: "Pago mensual hasta diciembre. Despues vienen pagos fuertes por definir."
  }
];

function renderAdminKpis() {
  const host = document.getElementById("adminKpis");
  if (!host) return;
  const snapshot = adminGrowthSnapshot;
  const usersStatus = dashboardPanelLoads.get("admin-users");
  const revenueStatus = dashboardPanelLoads.get("admin-revenue");
  const crmStatus = dashboardPanelLoads.get("admin-crm");
  const pendingUsers = snapshot?.pendingProfiles ?? (state.data.profiles.filter(item => item.status === "pending").length + state.data.companies.filter(item => item.status === "pending").length);
  const paymentRecords = incomePayments(state.data.payments || []);
  const paid = paymentRecords.filter(item => item.status === "paid").reduce((sum, item) => sum + Number(item.amount), 0);
  const pendingRevenue = paymentRecords.filter(item => item.status !== "paid").reduce((sum, item) => sum + Number(item.amount), 0);
  const taxSummary = revenueTaxSummary(paymentRecords);
  const athletes = snapshot?.totalAthletes ?? adminAthleteRecords().length;
  const founders = snapshot?.totalCreators ?? adminFounderRecords().length;
  const companies = snapshot?.totalCompanies ?? state.data.companies.length;
  const listValue = (status, value, label) => !status?.loaded
    ? `Abrir ${label}`
    : status.hasMore ? `${value}+` : value;
  const moneyValue = (status, value) => !status?.loaded || status.hasMore
    ? "Abrir Ingresos"
    : value;
  host.innerHTML = [
    ["Pendientes", snapshot ? pendingUsers : listValue(usersStatus, pendingUsers, "Usuarios")],
    ["Empresas", snapshot ? companies : listValue(usersStatus, companies, "Usuarios")],
    ["Deportistas", snapshot ? athletes : listValue(usersStatus, athletes, "Usuarios")],
    ["Creadores", snapshot ? founders : listValue(usersStatus, founders, "Usuarios")],
    ["Pagos", snapshot ? money(snapshot.paidRevenue) : moneyValue(revenueStatus, `$${paid.toLocaleString("es-MX")}`)],
    ["Pendiente", snapshot ? money(snapshot.pendingRevenue) : moneyValue(revenueStatus, `$${pendingRevenue.toLocaleString("es-MX")}`)],
    [snapshot ? "Pipeline" : "Neto estimado", snapshot ? money(snapshot.sponsorshipPipelineValue) : moneyValue(revenueStatus, money(taxSummary.estimatedNetIncome))],
    ["CRM", listValue(crmStatus, state.data.crm.length, "CRM")]
  ].map(([label, value]) => `<div class="kpi"><span>${label}</span><strong>${value}</strong></div>`).join("");
}

function paymentBaseAmount(payment) {
  return Number(payment.amount || 0);
}

function paymentIvaAmount(payment) {
  return paymentBaseAmount(payment) * fiscalConfig.ivaRate;
}

function paymentTotalWithIva(payment) {
  return paymentBaseAmount(payment) + paymentIvaAmount(payment);
}

function isExpensePayment(payment) {
  return payment.product_key === "manualExpense" || payment.product_key === "fixedExpense";
}

function incomePayments(payments = []) {
  return payments.filter(payment => !isExpensePayment(payment));
}

function expensePayments(payments = []) {
  return payments.filter(isExpensePayment);
}

function isMembershipPayment(payment) {
  return [
    "companyMonthlyMembership",
    "founderMonthlyMembership",
    "athleteMonthlyMembership"
  ].includes(payment.product_key);
}

function isScoutCommissionEligiblePayment(payment) {
  return ["founderMonthlyMembership", "athleteMonthlyMembership"].includes(payment.product_key);
}

function paymentScoutCommission(payment) {
  if (!isScoutCommissionEligiblePayment(payment)) return 0;
  const accountName = String(payment.company || "").toLowerCase();
  const athlete = (state.data.athletes || []).find(item => {
    const name = String(item.name || "").toLowerCase();
    const email = String(item.email || item.contact || "").toLowerCase();
    return (name && accountName.includes(name)) || (email && accountName.includes(email));
  });
  if (athlete?.invited_by_scout_code || athlete?.scout_code || athlete?.scout_active) {
    return fiscalConfig.scoutCommissionMonthly;
  }
  return fiscalConfig.scoutCommissionMonthly;
}

function estimatedDeductibleExpenses() {
  return 0;
}

function monthlyFixedExpenses() {
  return fixedExpenseConfig
    .filter(item => item.status !== "inactive")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function manualMonthlyExpenses(payments = []) {
  return expensePayments(payments)
    .filter(payment => payment.status !== "deleted")
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function totalMonthlyOperatingExpenses(payments = []) {
  return monthlyFixedExpenses() + manualMonthlyExpenses(payments);
}

function revenueTaxSummary(payments = []) {
  const membershipPayments = incomePayments(payments).filter(isMembershipPayment);
  const membershipBaseRevenue = membershipPayments.reduce((sum, payment) => {
    return sum + paymentBaseAmount(payment);
  }, 0);
  const ivaTransferred = membershipPayments.reduce((sum, payment) => {
    return sum + paymentIvaAmount(payment);
  }, 0);
  const totalCollectedWithIva = membershipBaseRevenue + ivaTransferred;
  const scoutCommissions = membershipPayments.reduce((sum, payment) => {
    return sum + paymentScoutCommission(payment);
  }, 0);
  const deductibleExpenses = estimatedDeductibleExpenses();
  const taxableProfit = Math.max(
    0,
    membershipBaseRevenue - scoutCommissions - deductibleExpenses
  );
  const estimatedIsr = taxableProfit * fiscalConfig.isrRate;
  const estimatedNetIncome = membershipBaseRevenue - scoutCommissions - estimatedIsr - deductibleExpenses;
  const totalTaxReserve = ivaTransferred + estimatedIsr;
  return {
    membershipPayments,
    membershipBaseRevenue,
    ivaTransferred,
    totalCollectedWithIva,
    scoutCommissions,
    deductibleExpenses,
    taxableProfit,
    estimatedIsr,
    estimatedNetIncome,
    totalTaxReserve
  };
}

function netCashflowAfterExpenses(payments = []) {
  const taxSummary = revenueTaxSummary(incomePayments(payments));
  const expenses = totalMonthlyOperatingExpenses(payments);

  return {
    ...taxSummary,
    fixedExpenses: monthlyFixedExpenses(),
    manualExpenses: manualMonthlyExpenses(payments),
    totalOperatingExpenses: expenses,
    netAfterOperatingExpenses: taxSummary.estimatedNetIncome - expenses
  };
}

function breakEvenMemberships(payments = []) {
  const averageNetWithScout = 1400;
  const averageNetWithoutScout = 1750;
  const expenses = totalMonthlyOperatingExpenses(payments);

  return {
    conservative: Math.ceil(expenses / averageNetWithScout),
    noScout: Math.ceil(expenses / averageNetWithoutScout)
  };
}

function money(value) {
  return `$${Number(value || 0).toLocaleString("es-MX", { maximumFractionDigits: 0 })} MXN`;
}

function revenueVertical(payment) {
  const key = payment.product_key || "";
  const concept = String(payment.concept || "").toLowerCase();
  if (key === "companyMonthlyMembership") return "Membresia Empresa";
  if (key === "founderMonthlyMembership") return "Membresia Creador";
  if (key === "athleteMonthlyMembership") return "Membresia Athlete";
  if (key === "eventRegistration") return "Eventos";
  if (key.includes("sponsor") || concept.includes("patrocinio")) return "Patrocinios";
  if (key.includes("partner") || key.includes("legacy") || key.includes("strategic")) return "Alianzas / Centro VIP";
  return "Otros ingresos";
}

function revenueDashboardType(payment) {
  const key = payment.product_key || "";
  const concept = String(payment.concept || "").toLowerCase();
  if (key === "companyMonthlyMembership") return "Empresa";
  if (key === "founderMonthlyMembership") return "Creador";
  if (key === "athleteMonthlyMembership") return "Athlete";
  if (key === "eventRegistration") return "Evento";
  if (concept.includes("patrocinio")) return "Sponsor";
  return "General";
}

function revenueStatusLabel(payment) {
  if (payment.status === "paid") return "Pagado";
  if (payment.status === "pending") return "Pendiente";
  if (payment.status === "payment_started") return "Checkout iniciado";
  if (payment.status === "review") return "Revision";
  return payment.status || "Pendiente";
}

async function submitManualExpense(event) {
  event.preventDefault();
  const form = event.currentTarget;

  const record = {
    concept: form.concept.value.trim(),
    amount: Number(form.amount.value || 0),
    company: form.company.value.trim(),
    status: form.status.value,
    product_key: "manualExpense"
  };

  const detailText = [
    `Categoria: ${form.category.value}`,
    `Notas: ${form.notes.value || "Sin notas"}`
  ].join(" | ");

  try {
    await api.insert("payments", { ...record, details: detailText });
  } catch (error) {
    await api.insert("payments", record);
  }

  notify("Finanzas", "Egreso registrado", "El nuevo egreso quedo agregado al control financiero.");
  form.reset();
  renderAdmin();
}

function normalizedAccountEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function accountStatusPriority(statuses = []) {
  const normalized = statuses.map(status => String(status || "").toLowerCase());
  if (normalized.includes("approved")) return "approved";
  if (normalized.includes("pending")) return "pending";
  if (normalized.includes("blocked")) return "blocked";
  if (normalized.includes("rejected")) return "rejected";
  if (normalized.includes("deleted")) return "deleted";
  return statuses[0] || "pending";
}

function accountTypeLabels(account) {
  const labels = [];
  if (account.profile?.role === "admin") labels.push("Admin");
  const founderBase = !account.founder && account.profile?.role === "founder";
  if (account.founder || founderBase) {
    labels.push("Creador");
  } else if (account.athlete) {
    labels.push("Deportista");
  } else if (account.profile?.role === "athlete") {
    labels.push("Deportista");
  }
  if (account.company) labels.push("Empresa");
  if (account.profile && account.profile.role === "client" && !account.company) {
    labels.push("Cliente");
  }
  if (!labels.length && account.profile) labels.push(account.profile.role || "Usuario");
  return [...new Set(labels)];
}

function accountDisplayName(account) {
  return account.company?.name || account.founder?.name || account.athlete?.name || account.profile?.name || account.email || "Usuario ROIS";
}

function accountRecordStatus(account) {
  const statuses = [
    account.profile?.status,
    account.company?.status,
    account.athlete?.status,
    account.founder?.status
  ].filter(Boolean);
  return accountStatusPriority(statuses);
}

function adminAccountRecords() {
  const map = new Map();
  const ensure = email => {
    const normalized = normalizedAccountEmail(email);
    if (!normalized) return null;
    if (!map.has(normalized)) {
      map.set(normalized, { email: normalized, profile: null, company: null, athlete: null, founder: null });
    }
    return map.get(normalized);
  };

  (state.data.profiles || []).forEach(profile => {
    const account = ensure(profile.email);
    if (account) account.profile = profile;
  });

  (state.data.companies || []).forEach(company => {
    const account = ensure(company.contact);
    if (account) account.company = company;
  });

  (state.data.athletes || []).forEach(athlete => {
    const account = ensure(athlete.email || athlete.contact);
    if (account) account.athlete = athlete;
  });

  (state.data.founders || []).forEach(founder => {
    const account = ensure(founder.email);
    if (account) account.founder = founder;
  });

  return [...map.values()].sort((a, b) => {
    const aName = accountDisplayName(a).toLowerCase();
    const bName = accountDisplayName(b).toLowerCase();
    return aName.localeCompare(bName);
  });
}

function renderAdminUsers() {
  const accounts = adminAccountRecords();
  const rows = accounts.map(account => [
    escapeHtml(accountDisplayName(account)),
    escapeHtml(account.email || "Sin correo"),
    accountTypeLabels(account).map(label => badge(label)).join(" "),
    badge(accountRecordStatus(account)),
    accountActions(account)
  ]);
  panel(
    "admin-users",
    "Usuarios",
    "Aprobaciones, bajas y control de cuentas ROIS",
    rows.length ? table(["Nombre", "Correo", "Tipo", "Estado", "Acciones"], rows) : `<div class="empty">No hay usuarios registrados.</div>`
  );
}

function renderAdminAthletesLegacy() {
  const athletes = [...adminAthleteRecords()].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const active = athletes.filter(athlete => !["blocked", "deleted", "rejected"].includes(athlete.status));
  const paid = active.filter(athleteAnnualFeePaid).length;
  const linked = active.filter(athlete => athlete.sponsor_payment_url).length;
  const scoutInvited = active.filter(athlete => athlete.invited_by_scout_code).length;
  panel("admin-athletes", "Deportistas", "GestiÃ³n por Scouts ROIS", `
    <div class="panel-body admin-athlete-summary">
      <div class="scout-metrics">
        <div><span>Activos</span><strong>${active.length}</strong></div>
        <div><span>Con scout</span><strong>${scoutInvited}</strong></div>
        <div><span>Anualidad pagada</span><strong>${paid}</strong></div>
        <div><span>Link mensual</span><strong>${linked}</strong></div>
      </div>
      <p class="hint">Los deportistas ya no se aprueban manualmente en este panel. Ingresan mediante cÃ³digo Scout ROIS y admin solo gestiona anualidad, link mensual de patrocinio, validaciÃ³n de comisiÃ³n y bajas operativas.</p>
    </div>
    ${athletes.length ? table(["Deportista", "Correo", "Scout", "Anualidad", "Perfil", "Pago mensual", "ComisiÃ³n", "Acciones"], athletes.map(athlete => [
      `<strong>${escapeHtml(athlete.name || "Deportista")}</strong><br><span class="hint inline">${escapeHtml(athlete.sport || "Perfil por completar")}</span>`,
      escapeHtml(athlete.email || athlete.contact || "Sin correo"),
      athlete.invited_by_scout_code ? badge(normalizeScoutCode(athlete.invited_by_scout_code)) : badge("sin cÃ³digo"),
      athleteAnnualFeePaid(athlete) ? badge("pagada") : athleteAnnualFeeRequired(athlete) ? badge("solicitada") : badge("no solicitada"),
      athleteProfileCompleteForScout(athlete) ? badge("completo") : badge("pendiente"),
      athlete.sponsor_payment_url ? badge("link activo") : badge("sin link"),
      scoutReferralStatus(athlete).eligible ? badge("validada") : badge(athlete.scout_validation_status || "review"),
      athleteAdminActions(athlete)
    ])) : `<div class="empty">Los deportistas registrados con cÃ³digo Scout ROIS aparecerÃ¡n aquÃ­.</div>`}
  `);
}

function renderAdminAthletes() {
  const athletes = [...adminAthleteRecords()].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const active = athletes.filter(athlete => !["blocked", "deleted", "rejected"].includes(athlete.status));
  const paid = active.filter(athleteAnnualFeePaid).length;
  const linked = active.filter(athlete => athlete.sponsor_payment_url).length;
  const scoutInvited = active.filter(athlete => athlete.invited_by_scout_code).length;
  panel("admin-athletes", "Deportistas", "Gestion por Scouts ROIS", `
    <div class="panel-body admin-athlete-summary">
      <div class="scout-metrics">
        <div><span>Activos</span><strong>${active.length}</strong></div>
        <div><span>Referidos por scout</span><strong>${scoutInvited}</strong></div>
        <div><span>Anualidad pagada</span><strong>${paid}</strong></div>
        <div><span>Link mensual</span><strong>${linked}</strong></div>
      </div>
      <p class="hint">Codigo propio identifica al Scout que puede invitar. Referido por identifica el codigo utilizado para registrar al deportista.</p>
    </div>
    ${athletes.length ? table(["Deportista", "Correo", "Codigo propio", "Referido por", "Anualidad", "Perfil", "Pago mensual", "Comision", "Acciones"], athletes.map(athlete => [
      `<strong>${escapeHtml(athlete.name || "Deportista")}</strong><br><span class="hint inline">${escapeHtml(athlete.sport || "Perfil por completar")}</span>`,
      escapeHtml(athlete.email || athlete.contact || "Sin correo"),
      badge(scoutCodeForAthlete(athlete)),
      athlete.invited_by_scout_code ? badge(normalizeScoutCode(athlete.invited_by_scout_code)) : badge("registro directo"),
      athleteAnnualFeePaid(athlete) ? badge("pagada") : athleteAnnualFeeRequired(athlete) ? badge("solicitada") : badge("no solicitada"),
      athleteProfileCompleteForScout(athlete) ? badge("completo") : badge("pendiente"),
      athlete.sponsor_payment_url ? badge("link activo") : badge("sin link"),
      scoutReferralStatus(athlete).eligible ? badge("validada") : badge(athlete.scout_validation_status || "review"),
      athleteAdminActions(athlete)
    ])) : `<div class="empty">Los deportistas registrados con codigo Scout ROIS apareceran aqui.</div>`}
  `);
}

function athleteAdminActions(athlete) {
  const actions = [
    button(athleteAnnualFeeRequired(athlete) ? "Ocultar anualidad" : "Solicitar anualidad", () => toggleAthleteAnnualFee(athlete))
  ];
  if (sponsorDeckIsReady(athlete)) actions.push(button("Ver Sponsor Deck", () => openSponsorDeckById(athlete.id)));
  if (!athleteAnnualFeePaid(athlete)) actions.push(button("Marcar pago anual", () => markAthleteAnnualPaid(athlete)));
  if (!athlete.scout_active) actions.push(button("Activar scout", () => activateScoutNetwork(athlete)));
  if (athlete.invited_by_scout_code && athlete.scout_commission_status !== "approved") actions.push(button("Validar scout", () => validateScoutCommission(athlete)));
  actions.push(button("Eliminar", () => deleteContent("athletes", athlete)));
  return actionGroup(actions);
}

function founderAdminTraction(founder) {
  const ranking = String(founder.ranking || "").trim();
  if (ranking) return ranking;
  const stats = String(founder.stats || "").trim();
  return stats.length > 96 ? `${stats.slice(0, 96).trim()}...` : (stats || "Por definir");
}

function founderAdminStatus(founder) {
  return `${badge(founder.status || "pending")} ${badge(founder.visual_status || "pendiente visual")}`;
}

function founderAdminActions(founder) {
  const actions = [];
  if (sponsorDeckIsReady(founder)) actions.push(button("Ver Sponsor Deck", () => openSponsorDeckById(founder.id)));
  if (founder.invited_by_scout_code && founder.scout_commission_status !== "approved") {
    actions.push(button("Validar Scout", () => validateScoutCommission(founder, "founders")));
  }
  actions.push(button("Eliminar", () => deleteContent("founders", founder)));
  return actionGroup(actions);
}

function renderAdminFounders() {
  const founders = [...adminFounderRecords()].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const active = founders.filter(founder => !["blocked", "deleted", "rejected"].includes(founder.status));
  const linked = active.filter(founder => founder.sponsor_payment_url).length;
  const measured = active.filter(founder => Number(founder.audience_size || 0) > 0 && Number(founder.engagement_rate || 0) > 0).length;
  panel("admin-founders", "Creadores", "Gestion de artistas, influencers y perfiles creativos patrocinables", `
    <div class="panel-body admin-athlete-summary">
      <div class="scout-metrics">
        <div><span>Creadores activos</span><strong>${active.length}</strong></div>
        <div><span>Link patrocinio</span><strong>${linked}</strong></div>
        <div><span>Metricas completas</span><strong>${measured}</strong></div>
        <div><span>Sponsor Deck</span><strong>${active.filter(founder => sponsorDeckIsReady(founder)).length}</strong></div>
      </div>
      <p class="hint">La tabla tecnica founders se conserva para compatibilidad. Creator type identifica artistas, influencers, musicos y founders legacy.</p>
    </div>
    ${founders.length ? table(["Creador", "Tipo", "Correo", "Referido por", "Categoria", "Plataforma", "Audiencia", "Engagement", "Sponsor Deck", "Estado", "Acciones"], founders.map(founder => [
      `<strong>${escapeHtml(founder.public_name || founder.name || "Creador")}</strong>`,
      badge(creatorTypeLabel(founder.creator_type)),
      escapeHtml(founder.email || "Sin correo"),
      founder.invited_by_scout_code ? badge(normalizeScoutCode(founder.invited_by_scout_code)) : badge("registro directo"),
      escapeHtml(founder.industry || "Por definir"),
      escapeHtml(founder.primary_platform || "Por definir"),
      escapeHtml(creatorAudienceLabel(founder)),
      escapeHtml(creatorEngagementLabel(founder)),
      sponsorDeckIsReady(founder) ? badge("disponible") : badge("pendiente"),
      founderAdminStatus(founder),
      founderAdminActions(founder)
    ])) : `<div class="empty">Aun no hay creadores registrados en ROIS.</div>`}
  `);
}

function athleteStripePaymentInfo(athlete) {
  const monthly = athleteMonthlyTicket(athlete);
  const founder = athlete._profile_table === "founders" || athlete.role === "founder" || isFounderProfile(athlete);
  const profileLabel = founder ? "creador" : "athlete";
  const name = `Patrocinio mensual ROIS - ${athlete.name || (founder ? "Creador" : "Athlete")}`;
  const description = [
    `Patrocinio mensual administrado por ROIS para ${athlete.name || `${profileLabel} ROIS`}.`,
    `${founder ? "Categoria / nicho" : "Disciplina"}: ${athlete.industry || athlete.sport || "Por definir"}.`,
    `${founder ? "Plataforma / etapa" : "Categoria"}: ${athlete.primary_platform || athlete.stage || athlete.category || "Por definir"}.`,
    `Base: ${athlete.city || athlete.location || "Por confirmar"}.`,
    `Ticket mensual sugerido: $${monthly.toLocaleString("es-MX")} MXN.`,
    `Operacion sujeta a contrato de patrocinio y representacion gestionado por ROIS / ${roisLegalEntity}.`
  ].join(" ");
  return {
    name,
    description,
    amount: monthly,
    frequency: "Recurrente mensual",
    currency: "MXN",
    category: "General - Servicios suministrados de forma electronica",
    quantity: "1",
    metadata: `${profileLabel}_id=${athlete.id || ""}; ${profileLabel}_email=${athlete.email || ""}; ${profileLabel}_name=${athlete.name || ""}; rois_product=${profileLabel}_monthly_sponsorship`
  };
}

function athleteStripePaymentText(athlete) {
  const info = athleteStripePaymentInfo(athlete);
  return [
    `Nombre: ${info.name}`,
    `Descripcion: ${info.description}`,
    `Tarifa: ${info.frequency}`,
    `Importe: ${info.amount} ${info.currency}`,
    `Cantidad: ${info.quantity}`,
    `Categoria: ${info.category}`,
    `Metadata interna: ${info.metadata}`,
    `Despues de crear el Payment Link en Stripe, pega el URL en ROIS para activar el boton de patrocinar.`
  ].join("\n");
}

function renderAdminPaymentLinks() {
  const profiles = [
    ...(state.data.athletes || []).map(item => ({ ...item, _profile_table: "athletes", _profile_kind: "Athlete ROIS" })),
    ...(state.data.founders || []).map(item => ({ ...item, _profile_table: "founders", _profile_kind: `${creatorTypeLabel(item.creator_type)} ROIS`, role: "founder" }))
  ].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es"));
  panel("admin-payment-links", "Enlaces de pago", "Configura links mensuales de patrocinio para athletes y creadores", `
    <div class="panel-body">
      <div class="section-minihead">
        <p class="eyebrow">Stripe Payment Links</p>
        <h3>Cada athlete y founder genera los datos de su producto mensual.</h3>
        <p class="hint">En Stripe crea un producto recurrente mensual con la informacion sugerida. Despues pega aqui el link de pago; ese mismo link se abrira desde el boton Patrocinar en el dashboard de empresas.</p>
      </div>
      ${profiles.length ? `<div class="payment-link-grid">${profiles.map(athletePaymentLinkCard).join("")}</div>` : `<div class="empty">Aun no hay athletes o creadores registrados.</div>`}
    </div>
  `);
  document.querySelectorAll("[data-profile-payment-form]").forEach(form => form.addEventListener("submit", submitAthletePaymentLink));
  document.querySelectorAll("[data-copy-payment-info]").forEach(button => button.addEventListener("click", () => copyAthletePaymentInfo(button.dataset.copyPaymentInfo)));
}

function athletePaymentLinkCard(athlete) {
  const info = athleteStripePaymentInfo(athlete);
  const founder = athlete._profile_table === "founders" || athlete.role === "founder" || isFounderProfile(athlete);
  const label = athlete._profile_kind || (founder ? `${creatorTypeLabel(athlete.creator_type)} ROIS` : "Athlete ROIS");
  const monthlyLabel = founder ? "Membresia / patrocinio mensual founder" : "Patrocinio mensual athlete";
  return `
    <article class="payment-link-card">
      <div class="payment-link-card-head">
        <div>
          <p class="eyebrow">${escapeHtml(label)}</p>
          <h3>${escapeHtml(athlete.name || "Deportista")}</h3>
          <p class="hint">${escapeHtml(monthlyLabel)}</p>
        </div>
        ${athlete.sponsor_payment_url ? badge("link activo") : badge("pendiente")}
      </div>
      <div class="stripe-info">
        <div><span>Nombre en Stripe</span><strong>${escapeHtml(info.name)}</strong></div>
        <div><span>Importe</span><strong>$${info.amount.toLocaleString("es-MX")} ${info.currency} / mes</strong></div>
        <div><span>Tipo de tarifa</span><strong>${info.frequency}</strong></div>
        <div><span>Categoria</span><strong>${escapeHtml(info.category)}</strong></div>
        <div class="full"><span>Descripcion</span><p>${escapeHtml(info.description)}</p></div>
        <div class="full"><span>Metadata interna</span><code>${escapeHtml(info.metadata)}</code></div>
      </div>
      <div class="payment-link-actions">
        <button class="btn" type="button" data-copy-payment-info="${escapeAttr(`${athlete._profile_table || "athletes"}:${athlete.id}`)}">Copiar datos Stripe</button>
        ${athlete.sponsor_payment_url ? `<a class="btn" href="${athlete.sponsor_payment_url}" target="_blank" rel="noopener">Probar link</a>` : ""}
      </div>
      <form class="form-grid compact-form" data-profile-payment-form data-profile-table="${escapeAttr(athlete._profile_table || "athletes")}" data-profile-id="${escapeAttr(athlete.id)}">
        <label style="grid-column:1/-1">Link de pago mensual Stripe<input name="sponsor_payment_url" type="url" value="${escapeAttr(athlete.sponsor_payment_url || "")}" placeholder="https://buy.stripe.com/..."></label>
        <button class="btn primary" type="submit">${athlete.sponsor_payment_url ? "Actualizar link" : "Activar link"}</button>
      </form>
    </article>
  `;
}

async function copyAthletePaymentInfo(profileKey) {
  const [table = "athletes", profileId = profileKey] = String(profileKey || "").split(":");
  const record = state.data?.[table]?.find(item => item.id === profileId);
  if (!record) return;
  const profile = table === "founders"
    ? { ...record, _profile_table: "founders", role: "founder" }
    : { ...record, _profile_table: "athletes" };
  const text = athleteStripePaymentText(profile);
  try {
    await navigator.clipboard.writeText(text);
    notify("Stripe", "Datos copiados", "Pega esta informacion en Stripe para crear el producto y el link mensual.");
  } catch {
    notify("Stripe", "Datos del producto", text);
  }
}

async function submitAthletePaymentLink(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const table = form.dataset.profileTable === "founders" ? "founders" : "athletes";
  const profile = state.data?.[table]?.find(item => item.id === form.dataset.profileId);
  if (!profile) return;
  const link = form.sponsor_payment_url.value.trim();
  await api.update(table, profile.id, { sponsor_payment_url: link });
  notify("Enlaces de pago", link ? "Link activado" : "Link retirado", link ? `El boton de patrocinar de ${profile.name} ya abrira este link desde el dashboard de empresas.` : `El perfil quedo sin link mensual activo.`);
  renderAdmin();
  renderClient();
}

function renderAdminAthleteNotifications() {
  const athleteOptions = state.data.athletes
    .filter(athlete => athlete.email)
    .map(athlete => {
      const label = isFounderProfile(athlete) ? "Founder" : "Athlete";
      return `<option value="${escapeAttr(athlete.email || "")}">[${escapeHtml(label)}] ${escapeHtml(athlete.name || "Perfil")} - ${escapeHtml(athlete.email || "")}</option>`;
    })
    .join("");
  const rows = (state.data.athlete_notifications || []).map(item => [
    item.athlete_name || item.athlete_email,
    item.title,
    badge(item.category || "general"),
    badge(item.priority || "normal"),
    badge(item.status || "unread"),
    badge(item.email_status || "pendiente webhook"),
    readableDate(item.created_at)
  ]);
  panel("admin-athlete-notifications", "Notificaciones", "Mensajes directos a deportistas", `
    <div class="panel-body">
      <form id="adminAthleteNotificationForm" class="form-grid">
        <label>Deportista<select name="athlete_email" required><option value="">Selecciona deportista</option>${athleteOptions}</select></label>
        <label>Prioridad<select name="priority"><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></label>
        <label>Categoria<select name="category"><option value="sponsor">Sponsor</option><option value="pago">Pago</option><option value="contrato">Contrato</option><option value="operacion">Operacion</option><option value="general">General</option></select></label>
        <label>Asunto<input name="title" required placeholder="Actualizacion sobre patrocinio"></label>
        <label style="grid-column:1/-1">Mensaje<textarea name="message" required placeholder="Escribe el mensaje que vera el deportista en su dashboard y recibira por correo si el webhook esta activo."></textarea></label>
        <button class="btn primary" type="submit">Enviar notificacion</button>
      </form>
      <p class="hint">La notificacion queda visible en el dashboard del deportista. Para envio real por correo configura notificationEmailWebhook en app-config.js con una Edge Function o servicio transaccional.</p>
    </div>
    ${rows.length ? table(["Deportista", "Asunto", "Categoria", "Prioridad", "Lectura", "Correo", "Fecha"], rows) : `<div class="empty">Aun no hay notificaciones enviadas a deportistas.</div>`}
  `);
  document.getElementById("adminAthleteNotificationForm").addEventListener("submit", submitAdminAthleteNotification);
}

function renderAdminEvents() {
  panel("admin-events", "Eventos", "Alta, visuales y aprobaci\u00f3n", `
    <div class="panel-body">
      <form id="adminEventForm" class="form-grid">
        <label>Evento<input name="name" required placeholder="Nombre del evento"></label>
        <label>Categor\u00eda<input name="category" required placeholder="Ejecutivo, sponsor, membres\u00eda"></label>
        <label>Sede<input name="venue" required placeholder="Sede o ciudad"></label>
        <label>Fecha<input name="date" required placeholder="Por confirmar"></label>
        <label style="grid-column:1/-1">Brochure PDF<input name="brochure_pdf" type="file" accept="application/pdf"></label>
        <label style="grid-column:1/-1">Alcance y posicionamiento del evento<textarea name="event_scope" required placeholder="Resume audiencia, alcance, sectores, tomadores de decisi\u00f3n, medios, impacto esperado y por qu\u00e9 una empresa deber\u00eda considerar este evento."></textarea></label>
        <label style="grid-column:1/-1">Imagen del evento<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <button class="btn primary" type="submit">Crear evento</button>
      </form>
      <p class="hint">El evento y su imagen pasan por revisi\u00f3n antes de publicarse.</p>
    </div>
    ${table(["Visual", "Evento", "Empresa", "Sede", "Success fee", "Brochure", "Estado", "Visual", "Acciones"], state.data.events.map(event => [
      visualThumb(event),
      event.name,
      companyForId(event.company_id)?.name || (event.company_id ? "Empresa registrada" : "ROIS / legacy"),
      event.venue,
      event.success_fee_rate ? `${Number(event.success_fee_rate)}%` : badge("por definir"),
      event.brochure_url ? badge("PDF") : badge("pendiente"),
      badge(event.status),
      badge(event.visual_status || "sin visual"),
      moderationActions("events", event)
    ]))}
  `);
  document.getElementById("adminEventForm").addEventListener("submit", submitAdminEvent);
}

function renderAdminNews() {
  panel("admin-news", "Noticias", "Gesti\u00f3n editorial", `
    <div class="panel-body">
      <form id="newsForm" class="form-grid">
        <label>T\u00edtulo<input name="title" required placeholder="Titular privado"></label>
        <label>Estado<select name="status"><option value="published">Publicado</option><option value="draft">Borrador</option></select></label>
        <label style="grid-column:1/-1">Resumen<textarea name="summary" required placeholder="Resumen para miembros."></textarea></label>
        <label style="grid-column:1/-1">Imagen de noticia<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <button class="btn primary" type="submit">Publicar</button>
      </form>
      <p class="hint">Aunque el texto est\u00e9 publicado, una noticia con imagen no aparece p\u00fablicamente hasta aprobar el visual.</p>
    </div>
    ${table(["Visual", "T\u00edtulo", "Estado", "Visual", "Acciones"], state.data.news.map(item => [
      visualThumb(item), item.title, badge(item.status), badge(item.visual_status || "sin visual"), moderationActions("news", item)
    ]))}
  `);
  document.getElementById("newsForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const image_url = await fileToDataUrl(form.image.files[0]);
    await api.insert("news", { title: form.title.value, summary: form.summary.value, status: form.status.value, image_url, visual_status: image_url ? "pending_review" : "approved" });
    notify("Noticias", "Nota creada", "La nota qued\u00f3 disponible en el m\u00f3dulo editorial.");
    renderAdmin();
    renderPublic();
  });
}

function renderAdminPartners() {
  const vipRows = state.data.partnerships.filter(isVipProduct).map(product => [
    visualThumb(product),
    product.name,
    product.tier || "Precio por confirmar",
    product.url ? `<a class="btn" href="${product.url}" target="_blank" rel="noopener">Link</a>` : badge("sin link"),
    badge(product.status),
    badge(product.visual_status || "sin visual"),
    moderationActions("partnerships", product)
  ]);
  const partnerRows = state.data.partnerships.filter(item => !isVipProduct(item)).map(partner => [
    visualThumb(partner), partner.name, partner.type, partner.tier, badge(partner.status), badge(partner.visual_status || "sin visual"), moderationActions("partnerships", partner)
  ]);
  panel("admin-partners", "Centro VIP", "Productos premium, sponsors clave y red estrategica visible en ROIS", `
    <div class="panel-body">
      <form id="vipProductForm" class="form-grid">
        <label>Nombre del producto<input name="name" required placeholder="F1 Gran Premio de Mexico - Suite privada"></label>
        <label>Precio o ticket<input name="price" required placeholder="$104,500 MXN + IVA"></label>
        <label>Link de pago o brochure<input name="url" type="url" placeholder="https://"></label>
        <label>Estado<select name="status"><option value="approved">Visible en Centro VIP</option><option value="pending">Pendiente</option></select></label>
        <label style="grid-column:1/-1">Descripcion<textarea name="description" required placeholder="Resume el alcance, disponibilidad, beneficios y condiciones principales."></textarea></label>
        <label style="grid-column:1/-1">Imagen del producto<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <button class="btn primary" type="submit">Publicar producto VIP</button>
      </form>
      <p class="hint">Estos productos aparecen dentro del dashboard de empresas en Centro VIP. Usa imagenes limpias, precios claros y links de pago o brochure cuando existan.</p>
    </div>
    ${vipRows.length ? table(["Visual", "Producto", "Precio", "Link", "Estado", "Visual", "Acciones"], vipRows) : `<div class="empty">Aun no hay productos VIP publicados.</div>`}
    <div class="panel-body">
      <form id="partnerForm" class="form-grid">
        <label>Nombre<input name="name" required placeholder="Empresa, sponsor o aliado"></label>
        <label>Tipo<select name="type"><option>Alianza estrat\u00e9gica</option><option>Sponsor principal</option><option>Partner institucional</option><option>Media partner</option></select></label>
        <label>Nivel<select name="tier"><option>Principal</option><option>Estrat\u00e9gico</option><option>Institucional</option><option>Comunidad</option></select></label>
        <label>Sitio web<input name="url" type="url" placeholder="https://empresa.com"></label>
        <label>Estado<select name="status"><option value="approved">Visible en home</option><option value="pending">Pendiente</option></select></label>
        <label style="grid-column:1/-1">Descripci\u00f3n<textarea name="description" required placeholder="Describe la alianza, sponsor o relaci\u00f3n estrat\u00e9gica."></textarea></label>
        <label style="grid-column:1/-1">Logo o visual<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <button class="btn primary" type="submit">Guardar alianza</button>
      </form>
      <p class="hint">Los logos y visuales nuevos quedan en revisi\u00f3n visual antes de mostrarse p\u00fablicamente.</p>
    </div>
    ${partnerRows.length ? table(["Visual", "Nombre", "Tipo", "Nivel", "Estado", "Visual", "Acciones"], partnerRows) : `<div class="empty">No hay sponsors o aliados publicados en home.</div>`}
  `);
  document.getElementById("vipProductForm").addEventListener("submit", submitAdminVipProduct);
  document.getElementById("partnerForm").addEventListener("submit", submitAdminPartner);
}

function companyForId(companyId) {
  return (state.data.companies || []).find(company => company.id === companyId) || null;
}

function subscriptionForCompanyId(companyId) {
  return (state.data.company_subscriptions || []).find(subscription => subscription.company_id === companyId) || null;
}

function adminSubscriptionActions(company, subscription) {
  if (!company) return "Sin empresa";
  return actionGroup([
    button("PRO", () => setCompanyPlan(company, subscription, "pro")),
    button("Business", () => setCompanyPlan(company, subscription, "business")),
    button("Free", () => setCompanyPlan(company, subscription, "free"))
  ]);
}

async function setCompanyPlan(company, subscription, planKey) {
  const plan = companyPlanCatalog[planKey] || companyPlanCatalog.free;
  const active = plan.key !== "free";
  const periodEnd = new Date();
  periodEnd.setMonth(periodEnd.getMonth() + 1);
  const record = {
    company_id: company.id,
    profile_id: company.profile_id || null,
    company_name: company.name || "Empresa ROIS",
    plan: plan.key,
    status: active ? "active" : "inactive",
    current_period_start: active ? new Date().toISOString() : null,
    current_period_end: active ? periodEnd.toISOString() : null,
    listing_limit: plan.listingLimit,
    event_limit_monthly: plan.eventLimitMonthly,
    seats_limit: plan.seatsLimit
  };
  try {
    if (subscription?.id) {
      await api.update("company_subscriptions", subscription.id, record);
    } else {
      await api.insert("company_subscriptions", record);
    }
    notify("Planes empresariales", `Plan ${plan.name}`, `${company.name} quedó ${active ? "activo por un periodo mensual" : "en modalidad gratuita"}.`);
    renderAdminCorporateMarket();
    return true;
  } catch (error) {
    notify("Planes empresariales", "No fue posible actualizar", humanError(error));
    return false;
  }
}

async function approveCompanyPlanRequest(request) {
  const planKey = String(request.details || "").match(/Plan:\s*(pro|business)/i)?.[1]?.toLowerCase();
  const company = (state.data.companies || []).find(item => item.name === request.owner);
  if (!planKey || !company) {
    notify("Planes empresariales", "Solicitud incompleta", "No fue posible identificar empresa y plan en la solicitud.");
    return;
  }
  const updated = await setCompanyPlan(company, subscriptionForCompanyId(company.id), planKey);
  if (updated) {
    await api.update("requests", request.id, { status: "approved" });
    renderAdminCorporateMarket();
  }
}

function adminCompanyListingActions(listing) {
  const sellerSubscription = subscriptionForCompanyId(listing.company_id);
  const sellerBusiness = companySubscriptionIsActive(sellerSubscription) && sellerSubscription.plan === "business";
  const actions = [];
  if (listing.status !== "approved" || listing.visual_status !== "approved") {
    actions.push(button("Aprobar", async () => {
      await api.update("company_listings", listing.id, { status: "approved", visual_status: "approved", visual_notes: "" });
      renderAdminCorporateMarket();
    }));
  }
  if (sellerBusiness && !listing.featured) {
    actions.push(button("Destacar", async () => {
      const featuredUntil = new Date();
      featuredUntil.setDate(featuredUntil.getDate() + 30);
      await api.update("company_listings", listing.id, { featured: true, featured_until: featuredUntil.toISOString() });
      renderAdminCorporateMarket();
    }));
  }
  if (listing.featured) {
    actions.push(button("Quitar destaque", async () => {
      await api.update("company_listings", listing.id, { featured: false, featured_until: null });
      renderAdminCorporateMarket();
    }));
  }
  if (!['rejected', 'archived'].includes(listing.status)) {
    actions.push(button("Rechazar", async () => {
      await api.update("company_listings", listing.id, { status: "rejected", visual_status: "rejected", featured: false });
      renderAdminCorporateMarket();
    }));
  }
  return actionGroup(actions);
}

function renderAdminCorporateMarket() {
  const companies = state.data.companies || [];
  const subscriptions = state.data.company_subscriptions || [];
  const listings = state.data.company_listings || [];
  const leads = state.data.marketplace_leads || [];
  const planRequests = (state.data.requests || []).filter(item => item.type === "Plan empresarial");
  const activePro = subscriptions.filter(item => companySubscriptionIsActive(item) && item.plan === "pro").length;
  const activeBusiness = subscriptions.filter(item => companySubscriptionIsActive(item) && item.plan === "business").length;
  const planRows = companies.map(company => {
    const subscription = subscriptionForCompanyId(company.id);
    const plan = companySubscriptionIsActive(subscription) ? companyPlanCatalog[subscription.plan] || companyPlanCatalog.free : companyPlanCatalog.free;
    return [
      escapeHtml(company.name),
      escapeHtml(company.contact || "Sin correo"),
      badge(plan.name),
      badge(subscription?.status || "inactive"),
      subscription?.current_period_end ? readableDate(subscription.current_period_end) : "Sin periodo",
      `${subscription?.listing_limit ?? plan.listingLimit} / ${subscription?.event_limit_monthly ?? plan.eventLimitMonthly}`,
      adminSubscriptionActions(company, subscription)
    ];
  });
  const listingRows = listings.map(listing => [
    listing.primary_image_url ? `<img class="table-thumb" src="${escapeAttr(listing.primary_image_url)}" alt="" onerror="this.style.display='none'">` : "Sin imagen",
    escapeHtml(listing.company_name || companyForId(listing.company_id)?.name || "Empresa"),
    badge(companyListingTypeLabel(listing.listing_type)),
    escapeHtml(listing.title),
    escapeHtml(companyListingPrice(listing)),
    badge(listing.status),
    badge(listing.visual_status),
    listing.featured ? badge("Destacado") : "Estándar",
    adminCompanyListingActions(listing)
  ]);
  const leadRows = leads.map(lead => {
    const listing = listings.find(item => item.id === lead.listing_id);
    return [
      readableDate(lead.created_at),
      escapeHtml(listing?.title || "Publicación"),
      escapeHtml(lead.requester_company || lead.requester_email),
      escapeHtml(companyForId(lead.seller_company_id)?.name || listing?.company_name || "Empresa oferente"),
      badge(lead.status),
      actionGroup([
        button("Contactado", () => api.update("marketplace_leads", lead.id, { status: "contacted" }).then(renderAdminCorporateMarket)),
        button("Cerrar", () => api.update("marketplace_leads", lead.id, { status: "closed" }).then(renderAdminCorporateMarket))
      ])
    ];
  });
  const planRequestRows = planRequests.map(request => [
    readableDate(request.created_at),
    escapeHtml(request.owner || "Empresa"),
    escapeHtml(request.title || "Activación"),
    badge(request.status),
    request.status === "approved" ? "Atendida" : button("Activar plan", () => approveCompanyPlanRequest(request))
  ]);
  panel("admin-corporate-market", "Mercado Corporativo", "Planes, inventario, moderación y leads empresariales", `
    <div class="panel-body">
      <div class="scout-metrics">
        <div><span>PRO activos</span><strong>${activePro}</strong></div>
        <div><span>Business activos</span><strong>${activeBusiness}</strong></div>
        <div><span>Publicaciones</span><strong>${listings.length}</strong></div>
        <div><span>Leads</span><strong>${leads.length}</strong></div>
      </div>
    </div>
    <div class="panel-body"><div class="section-minihead"><p class="eyebrow">Solicitudes</p><h3>Altas PRO y Business pendientes.</h3></div></div>
    ${planRequestRows.length ? table(["Fecha", "Empresa", "Plan", "Estado", "Acción"], planRequestRows) : `<div class="empty">No hay solicitudes de plan pendientes.</div>`}
    <div class="panel-body"><div class="section-minihead"><p class="eyebrow">Suscripciones</p><h3>Permisos empresariales verificables.</h3></div></div>
    ${planRows.length ? table(["Empresa", "Correo", "Plan", "Estado", "Vigencia", "Listings / Eventos", "Acciones"], planRows) : `<div class="empty">No hay empresas registradas.</div>`}
    <div class="panel-body"><div class="section-minihead"><p class="eyebrow">Moderación</p><h3>Inventario enviado por empresas.</h3></div></div>
    ${listingRows.length ? table(["Visual", "Empresa", "Tipo", "Publicación", "Precio", "Estado", "Visual", "Nivel", "Acciones"], listingRows) : `<div class="empty">Aún no hay publicaciones corporativas.</div>`}
    <div class="panel-body"><div class="section-minihead"><p class="eyebrow">Leads</p><h3>Interés comercial generado.</h3></div></div>
    ${leadRows.length ? table(["Fecha", "Oferta", "Solicitante", "Oferente", "Estado", "Acciones"], leadRows) : `<div class="empty">Aún no hay leads registrados.</div>`}
  `);
}

function renderAdminCrm() {
  panel("admin-crm", "CRM", "Pipeline de relaciones", table(["Categor\u00eda", "Volumen", "Estado", "Acci\u00f3n"], state.data.crm.map(item => [
    item.name, item.volume, badge(item.status), button("Avanzar", () => updateCrm(item.id))
  ])));
}

function renderAdminPayments() {
  const athleteOptions = state.data.athletes.map(athlete => `<option value="${escapeAttr(athlete.email || "")}">${athlete.name} - ${athlete.email || "sin correo"}</option>`).join("");
  const deposits = state.data.athlete_deposits.map(item => [
    item.athlete_name || item.athlete_email,
    item.month || "Periodo",
    `$${Number(item.amount || 0).toLocaleString("es-MX")} MXN`,
    item.proof_url ? `<a class="btn" href="${item.proof_url}" target="_blank" rel="noopener">Comprobante</a>` : badge("pendiente"),
    badge(item.status)
  ]);
  panel("admin-payments", "Pagos", "Stripe, dep\u00f3sitos y comprobantes", `
    <div class="panel-body">
      <form id="adminDepositForm" class="form-grid">
        <label>Deportista<select name="athlete_email" required><option value="">Selecciona deportista</option>${athleteOptions}</select></label>
        <label>Periodo<input name="month" required placeholder="Junio 2026"></label>
        <label>Monto depositado<input name="amount" type="number" min="0" step="0.01" required></label>
        <label>Empresa origen<input name="company" placeholder="Empresa patrocinadora"></label>
        <label style="grid-column:1/-1">Comprobante de dep\u00f3sito<input name="proof" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" required></label>
        <button class="btn primary" type="submit">Cargar dep\u00f3sito</button>
      </form>
    </div>
    ${table(["Concepto", "Monto", "Estado", "Acci\u00f3n"], state.data.payments.map(payment => [
      payment.concept, `$${Number(payment.amount).toLocaleString("es-MX")} MXN`, badge(payment.status), payment.status === "paid" ? "Pagado" : button("Marcar pagado", () => markPaid(payment.id))
    ]))}
    <div class="panel-body"><p class="eyebrow">Dep\u00f3sitos a deportistas</p></div>
    ${deposits.length ? table(["Deportista", "Periodo", "Monto", "Comprobante", "Estado"], deposits) : `<div class="empty">No hay dep\u00f3sitos cargados todav\u00eda.</div>`}
  `);
  document.getElementById("adminDepositForm").addEventListener("submit", submitAdminDeposit);
}


function renderAdminRevenue() {
  const revenueLoad = dashboardPanelLoads.get("admin-revenue");
  const partialNotice = revenueLoad?.hasMore
    ? `<p class="hint">Resumen parcial de los registros cargados. Usa "Cargar mas registros" para completar el historico antes de cerrar cifras.</p>`
    : "";
  const payments = [...(state.data.payments || [])]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const income = incomePayments(payments);
  const expenses = expensePayments(payments);
  const taxSummary = revenueTaxSummary(income);
  const cashflow = netCashflowAfterExpenses(payments);
  const breakEven = breakEvenMemberships(payments);

  const totalPaid = income
    .filter(payment => payment.status === "paid")
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  const totalPending = income
    .filter(payment => payment.status !== "paid")
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  const byVertical = income.reduce((acc, payment) => {
    const vertical = revenueVertical(payment);
    acc[vertical] = acc[vertical] || { count: 0, pending: 0, paid: 0 };
    acc[vertical].count += 1;
    if (payment.status === "paid") {
      acc[vertical].paid += Number(payment.amount || 0);
    } else {
      acc[vertical].pending += Number(payment.amount || 0);
    }
    return acc;
  }, {});

  const verticalCards = Object.entries(byVertical).map(([vertical, data]) => `
    <article class="launch-card revenue-card">
      <p class="eyebrow">${escapeHtml(vertical)}</p>
      <h3>$${Number(data.paid).toLocaleString("es-MX")} MXN</h3>
      <p>Pagado</p>
      <p class="hint">$${Number(data.pending).toLocaleString("es-MX")} MXN pendiente - ${data.count} registros</p>
    </article>
  `).join("");

  const rows = income.map(payment => [
    readableDate(payment.created_at),
    badge(revenueVertical(payment)),
    escapeHtml(payment.company || "Sin nombre"),
    escapeHtml(payment.concept || "Pago ROIS"),
    `$${Number(payment.amount || 0).toLocaleString("es-MX")} MXN`,
    escapeHtml(payment.product_key || "manual"),
    badge(revenueStatusLabel(payment)),
    badge(revenueDashboardType(payment)),
    payment.status === "paid" ? "Pagado" : button("Marcar pagado", () => markPaid(payment.id))
  ]);

  const taxRows = [
    ["Ingreso membresias sin IVA", money(taxSummary.membershipBaseRevenue), "Base comercial antes de IVA"],
    ["IVA trasladado 16%", money(taxSummary.ivaTransferred), "Impuesto cobrado al cliente; reservar para entero mensual"],
    ["Total cobrado con IVA", money(taxSummary.totalCollectedWithIva), "Flujo total recibido por membresias"],
    ["Comisiones Scouts", money(taxSummary.scoutCommissions), "Estimacion de $500 MXN por founder/athlete elegible"],
    ["Gastos deducibles", money(taxSummary.deductibleExpenses), "Placeholder hasta crear modulo de gastos"],
    ["Utilidad estimada para ISR", money(taxSummary.taxableProfit), "Membresias sin IVA - scouts - deducibles"],
    ["ISR estimado 30%", money(taxSummary.estimatedIsr), "Estimacion interna de ISR persona moral"],
    ["Ingreso neto estimado", money(taxSummary.estimatedNetIncome), "Despues de scouts e ISR; no incluye IVA"],
    ["Reserva fiscal total", money(taxSummary.totalTaxReserve), "IVA + ISR estimado"]
  ];

  const fixedExpenseRows = fixedExpenseConfig.map(item => [
    item.name,
    money(item.amount),
    item.frequency,
    item.category,
    item.priority,
    item.notes || "Activo"
  ]);

  const manualExpenseRows = expenses.map(payment => [
    readableDate(payment.created_at),
    escapeHtml(payment.concept || "Egreso"),
    escapeHtml(payment.company || "Sin proveedor"),
    money(payment.amount),
    badge(payment.status || "pending"),
    payment.status === "paid" ? "Pagado" : button("Marcar pagado", () => markPaid(payment.id))
  ]);

  panel("admin-revenue", "Ingresos", "Trazabilidad financiera por vertical de ROIS", `
    <div class="panel-body">
      ${partialNotice}
      <div class="scout-metrics">
        <div><span>Pagado</span><strong>$${totalPaid.toLocaleString("es-MX")}</strong></div>
        <div><span>Pendiente</span><strong>$${totalPending.toLocaleString("es-MX")}</strong></div>
        <div><span>Registros</span><strong>${income.length}</strong></div>
        <div><span>Verticales</span><strong>${Object.keys(byVertical).length}</strong></div>
      </div>
    </div>
    <div class="panel-body">
      ${verticalCards ? `<div class="launch-sponsor-grid revenue-grid">${verticalCards}</div>` : `<div class="empty">Aun no hay ingresos registrados.</div>`}
    </div>
    <div class="panel-body">
      <div class="section-minihead">
        <p class="eyebrow">Impuestos y net revenue</p>
        <h3>Estimacion fiscal sobre membresias ROIS.</h3>
        <p>IVA 16% trasladado al cliente e ISR estimado 30% sobre utilidad antes de impuestos. No sustituye calculo contable final.</p>
      </div>
      <div class="scout-metrics">
        <div><span>Membresias sin IVA</span><strong>${money(taxSummary.membershipBaseRevenue)}</strong></div>
        <div><span>IVA trasladado</span><strong>${money(taxSummary.ivaTransferred)}</strong></div>
        <div><span>Total cobrado</span><strong>${money(taxSummary.totalCollectedWithIva)}</strong></div>
        <div><span>Comisiones Scouts</span><strong>${money(taxSummary.scoutCommissions)}</strong></div>
        <div><span>Utilidad ISR estimada</span><strong>${money(taxSummary.taxableProfit)}</strong></div>
        <div><span>ISR estimado</span><strong>${money(taxSummary.estimatedIsr)}</strong></div>
        <div><span>Reserva fiscal</span><strong>${money(taxSummary.totalTaxReserve)}</strong></div>
        <div><span>Ingreso neto</span><strong>${money(taxSummary.estimatedNetIncome)}</strong></div>
      </div>
    </div>
    ${table(["Concepto", "Monto", "Criterio"], taxRows)}
    <div class="panel-body">
      <div class="section-minihead">
        <p class="eyebrow">Egresos fijos y flujo neto</p>
        <h3>Control de obligaciones operativas mensuales.</h3>
        <p>Incluye vehiculo, departamento, pago a Veronica y egresos manuales registrados.</p>
      </div>
      <div class="scout-metrics">
        <div><span>Egresos fijos</span><strong>${money(cashflow.fixedExpenses)}</strong></div>
        <div><span>Egresos manuales</span><strong>${money(cashflow.manualExpenses)}</strong></div>
        <div><span>Total egresos</span><strong>${money(cashflow.totalOperatingExpenses)}</strong></div>
        <div><span>Flujo libre</span><strong>${money(cashflow.netAfterOperatingExpenses)}</strong></div>
        <div><span>Break-even conservador</span><strong>${breakEven.conservative} membresias</strong></div>
        <div><span>Break-even sin Scout</span><strong>${breakEven.noScout} membresias</strong></div>
      </div>
    </div>
    ${table(["Egreso", "Monto mensual", "Frecuencia", "Categoria", "Prioridad", "Notas"], fixedExpenseRows)}
    <div class="panel-body">
      <div class="section-minihead">
        <p class="eyebrow">Registrar nuevo egreso</p>
        <h3>Pagos operativos fuera de las membresias mensuales.</h3>
      </div>
      <form id="manualExpenseForm" class="form-grid">
        <label>Concepto<input name="concept" required placeholder="Gasolina, contador, pago proveedor..."></label>
        <label>Beneficiario / proveedor<input name="company" required placeholder="Nombre de persona o proveedor"></label>
        <label>Monto<input name="amount" type="number" min="0" step="0.01" required></label>
        <label>Categoria<select name="category">
          <option>Movilidad</option>
          <option>Vivienda / base operativa</option>
          <option>Software</option>
          <option>Fiscal / contador</option>
          <option>Marketing</option>
          <option>Obligacion financiera</option>
          <option>Otro</option>
        </select></label>
        <label>Estado<select name="status">
          <option value="pending">Pendiente</option>
          <option value="paid">Pagado</option>
        </select></label>
        <label style="grid-column:1/-1">Notas<textarea name="notes" placeholder="Periodicidad, vencimiento o contexto del pago."></textarea></label>
        <button class="btn primary" type="submit">Registrar egreso</button>
      </form>
    </div>
    ${manualExpenseRows.length ? table(["Fecha", "Concepto", "Beneficiario", "Monto", "Estado", "Accion"], manualExpenseRows) : `<div class="empty">Aun no hay egresos manuales registrados.</div>`}
    ${rows.length ? table(["Fecha", "Vertical", "Cuenta", "Concepto", "Monto", "Product Key", "Estado", "Dashboard", "Accion"], rows) : `<div class="empty">Aun no hay pagos registrados.</div>`}
  `);
  const manualExpenseForm = document.getElementById("manualExpenseForm");
  if (manualExpenseForm) manualExpenseForm.addEventListener("submit", submitManualExpense);
}

function renderAdminUploads() {
  const homeCovers = homeVisualSlots();
  const selectedCover = homeCovers.find(cover => cover.id === "home_cover") || homeCovers[0];
  const postRows = state.data.athlete_posts.map(item => [
    visualThumb(item),
    item.athlete_name || item.athlete_email,
    item.title,
    item.video_url ? `<a class="btn" href="${item.video_url}" target="_blank" rel="noopener">Video</a>` : badge("sin video"),
    badge(item.status),
    moderationActions("athlete_posts", item)
  ]);
  const resultRows = state.data.athlete_results.map(item => [
    item.athlete_name || item.athlete_email,
    item.month,
    item.summary,
    item.proof_url ? `<a class="btn" href="${item.proof_url}" target="_blank" rel="noopener">Soporte</a>` : badge("sin soporte"),
    badge(item.status),
    actionGroup([button("Aprobar", () => approve("athlete_results", item.id)), button("Eliminar", () => deleteContent("athlete_results", item))])
  ]);
  const expenseRows = state.data.athlete_expenses.map(item => [
    item.athlete_name || item.athlete_email,
    item.category,
    `$${Number(item.amount || 0).toLocaleString("es-MX")} MXN`,
    item.invoice_url ? `<a class="btn" href="${item.invoice_url}" target="_blank" rel="noopener">Factura</a>` : badge("sin factura"),
    item.ticket_url ? `<a class="btn" href="${item.ticket_url}" target="_blank" rel="noopener">Ticket</a>` : badge("sin ticket"),
    badge(item.status),
    actionGroup([button("Aprobar", () => approve("athlete_expenses", item.id)), button("Eliminar", () => deleteContent("athlete_expenses", item))])
  ]);
  panel("admin-uploads", "Uploads", "Moderaci\u00f3n de visuales, reels, resultados y comprobantes", `
    <div class="panel-body">
      <form id="homeCoverForm" class="form-grid">
        <label>Espacio visual<select name="slot">${homeCovers.map(cover => `<option value="${cover.id}">${cover.label}${cover.image_url ? " - activo" : ""}</option>`).join("")}</select></label>
        <label>Titulo interno<input name="title" value="${escapeAttr(selectedCover?.title || "")}" placeholder="Portada publicitaria ROIS"></label>
        <label style="grid-column:1/-1">Nota interna<textarea name="subtitle" placeholder="Uso comercial, patrocinador o campana.">${escapeHtml(selectedCover?.subtitle || "")}</textarea></label>
        <label style="grid-column:1/-1">Imagen del espacio<input name="cover" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <button class="btn primary" type="submit">Publicar visual</button>
        <button class="btn" type="button" id="clearHomeCover">Quitar visual seleccionado</button>
      </form>
      ${homeCovers.some(cover => cover.image_url) ? `
        <div class="admin-cover-grid">
          ${homeCovers.map(cover => cover.image_url ? `
            <div class="cover-admin-preview">
              <img src="${cover.image_url}" alt="Portada ${cover.index}">
              <span>${cover.label}</span>
            </div>
          ` : `<div class="cover-admin-preview empty"><span>${cover.empty}</span></div>`).join("")}
        </div>
      ` : `<p class="hint">Cada recuadro visual del home se publica desde aquÃ­. Usa proporciones horizontales para portada y alianzas, y proporciones editoriales para tarjetas.</p>`}
    </div>
    <div class="panel-body">
      <form id="uploadForm" class="form-grid">
        <label>Archivo visual<input name="file" type="file" accept="image/png,image/jpeg,image/webp" required></label>
        <label>Tipo<select name="type"><option>Evento</option><option>Deportista</option><option>Contrato</option><option>Documento</option></select></label>
        <button class="btn primary" type="submit">Registrar upload</button>
      </form>
      <p class="hint">Los reels y visuales no aparecen a empresas hasta que admin los apruebe.</p>
    </div>
    ${state.data.uploads.length ? table(["Visual", "Archivo", "Tipo", "Estado", "Acciones"], state.data.uploads.map(item => [
      visualThumb(item), item.name, item.type, badge(item.visual_status || item.status), moderationActions("uploads", item)
    ])) : `<div class="empty">No hay archivos registrados.</div>`}
    <div class="panel-body"><p class="eyebrow">Publicaciones</p></div>
    ${postRows.length ? table(["Visual", "Deportista", "T\u00edtulo", "Video", "Estado", "Acciones"], postRows) : `<div class="empty">No hay reels pendientes.</div>`}
    <div class="panel-body"><p class="eyebrow">Resultados mensuales</p></div>
    ${resultRows.length ? table(["Deportista", "Mes", "Resumen", "Soporte", "Estado", "Acciones"], resultRows) : `<div class="empty">No hay resultados enviados.</div>`}
    <div class="panel-body"><p class="eyebrow">Tickets y facturas</p></div>
    ${expenseRows.length ? table(["Deportista", "Categor\u00eda", "Monto", "Factura", "Ticket", "Estado", "Acciones"], expenseRows) : `<div class="empty">No hay comprobantes enviados.</div>`}
  `);
  document.getElementById("uploadForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.file.files[0];
    const image_url = await fileToDataUrl(file);
    await api.insert("uploads", { name: file.name, type: form.type.value, size: file.size, status: "registered", image_url, visual_status: "pending_review" });
    notify("Uploads", "Archivo registrado", "El visual qued\u00f3 pendiente de revisi\u00f3n.");
    renderAdmin();
  });
  const homeCoverForm = document.getElementById("homeCoverForm");
  homeCoverForm.addEventListener("submit", submitHomeCover);
  homeCoverForm.slot.addEventListener("change", () => {
    const slot = homeVisualSlot(homeCoverForm.slot.value);
    homeCoverForm.title.value = slot?.title || "";
    homeCoverForm.subtitle.value = slot?.subtitle || "";
  });
  document.getElementById("clearHomeCover")?.addEventListener("click", clearHomeCover);
}

async function submitHomeCover(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const slot = form.slot.value || "home_cover";
  const existing = siteSetting(slot) || {};
  const file = form.cover.files[0];
  const image_url = file ? await fileToDataUrl(file) : existing.image_url;

  if (!image_url) {
    notify("Portada", "Selecciona una imagen", "Sube una imagen horizontal para publicar el banner del home.");
    return;
  }

  await api.upsert("site_settings", {
    id: slot,
    value: JSON.stringify({
      image_url,
      title: form.title.value.trim(),
      subtitle: form.subtitle.value.trim()
    })
  });
  notify("Portada", "Visual publicado", slot === "home_cover" ? "La portada principal ya aparece en el home y en el dashboard empresarial." : "El visual seleccionado ya aparece en su espacio del home.");
  renderAdmin();
  renderPublic();
  renderClient();
}

async function clearHomeCover() {
  const slot = document.querySelector("#homeCoverForm [name='slot']")?.value || "home_cover";
  await api.remove("site_settings", slot);
  notify("Portada", "Visual retirado", slot === "home_cover" ? "La portada principal ya no aparece en el home." : "El visual seleccionado ya no aparece en ese recuadro.");
  renderAdmin();
  renderPublic();
  renderClient();
}

function renderAdminLaunch() {
  const companies = state.data.companies || [];
  const athletes = state.data.athletes || [];
  const events = state.data.events || [];
  const sponsorships = state.data.sponsorships || [];
  const publicAthletes = athletes.filter(item => item.status === "approved" && visualIsPublic(item));
  const activeSponsors = sponsorships.filter(item => ["review", "pending", "active", "paid"].includes(String(item.status || "").toLowerCase()));
  const approvedEvents = events.filter(item => item.status === "approved" && visualIsPublic(item));
  const launchMessages = {
    athlete: "ROIS abre convocatoria nacional para deportistas competitivos que buscan patrocinio profesional. Crea tu perfil, sube tu plan de trabajo y empieza a presentarte ante empresas.",
    company: "Invitamos a empresas a registrarse en ROIS para revisar deportistas listos para patrocinio institucional desde $5,000 MXN mensuales.",
    sponsor: "ROIS esta construyendo una red nacional de talento deportivo, empresas y eventos privados. Cuando exista traccion inicial, presentaremos oportunidades Partner, Oficial y Legacy."
  };
  const launchRows = [
    ["Academia de golf aliada", "1", badge("prioridad")],
    ["Deportistas registrados", `${athletes.length}/20`, launchProgress(athletes.length, 20)],
    ["Perfiles publicables", `${publicAthletes.length}/10`, launchProgress(publicAthletes.length, 10)],
    ["Empresas registradas", `${companies.length}/30`, launchProgress(companies.length, 30)],
    ["Solicitudes de patrocinio", `${activeSponsors.length}/3`, launchProgress(activeSponsors.length, 3)],
    ["Evento piloto", approvedEvents.length ? "Activo" : "Por disenar", approvedEvents.length ? badge("listo") : badge("semana 3")]
  ];
  const weekRows = [
    ["Dias 1-3", "Mensaje, convocatoria deportistas y academia de golf", "Publicar convocatoria y contactar academia"],
    ["Dias 4-7", "Primeros perfiles deportivos", "Registrar y preparar 5 deportistas"],
    ["Dias 8-10", "Contenido para empresas", "Invitar red personal y negocios premium"],
    ["Dias 11-15", "Conversion a registros", "Contactar 15 a 20 empresas diarias"],
    ["Dias 16-20", "Solicitudes de patrocinio", "Presentar perfiles concretos a interesados"],
    ["Dias 21-24", "ROIS Private Sponsor Session", "Disenar evento piloto hibrido"],
    ["Dias 25-27", "Resumen de traccion", "Preparar evidencia para sponsors oficiales"],
    ["Dias 28-30", "Sponsors oficiales", "Contactar Monex, Klu y Excent Capital"]
  ];
  const contentRows = [
    ["Post 1", "Que es ROIS", "Plataforma privada para conectar empresas con talento deportivo competitivo"],
    ["Post 2", "Convocatoria deportistas", "Registro nacional para deportistas en plan competitivo"],
    ["Post 3", "Convocatoria empresas", "Patrocina talento deportivo desde $5,000 MXN mensuales"],
    ["Reel 1", "Como funciona", "Empresa se registra, revisa perfiles y solicita patrocinio"],
    ["Story fija", "Registro empresas", "CTA directo al registro empresarial"],
    ["Story fija", "Registro deportistas", "CTA directo al registro deportivo"]
  ];
  panel("admin-launch", "Lanzamiento nacional", "Plan operativo online de 30 dias", `
    <div class="launch-hero">
      <div>
        <p class="eyebrow">Mensaje principal</p>
        <h3>Patrocina talento deportivo competitivo desde $5,000 MXN mensuales.</h3>
        <p>Usa Instagram, Facebook y red personal como trafico. La conversion debe ocurrir por registro directo en la plataforma.</p>
      </div>
      <div class="launch-actions">
        ${button("Copiar mensaje deportistas", () => copyLaunchText(launchMessages.athlete))}
        ${button("Copiar mensaje empresas", () => copyLaunchText(launchMessages.company))}
      </div>
    </div>
    <div class="launch-scoreboard">
      ${launchRows.map(([label, value, status]) => `<div><span>${label}</span><strong>${value}</strong>${status}</div>`).join("")}
    </div>
    <div class="launch-grid">
      <div class="launch-card">
        <p class="eyebrow">Embudo deportistas</p>
        <h3>Meta: 50 interesados, 20 registros, 10 publicables.</h3>
        <ul>
          <li>Instagram stories y reels.</li>
          <li>Facebook grupos deportivos.</li>
          <li>Contactos de academia.</li>
          <li>DM a atletas competitivos.</li>
        </ul>
      </div>
      <div class="launch-card">
        <p class="eyebrow">Embudo empresas</p>
        <h3>Meta: 100 contactos, 30 registros, 3 solicitudes.</h3>
        <ul>
          <li>Red personal y referidos.</li>
          <li>Instagram/Facebook ROIS.</li>
          <li>Negocios premium nacionales.</li>
          <li>Registro directo sin costo.</li>
        </ul>
      </div>
      <div class="launch-card">
        <p class="eyebrow">Rutina diaria</p>
        <h3>Una accion debe mover registro o patrocinio.</h3>
        <ul>
          <li>Publicar contenido y responder mensajes.</li>
          <li>Revisar registros y perfiles.</li>
          <li>Prospectar empresas.</li>
          <li>Actualizar plataforma.</li>
          <li>Dar seguimiento comercial.</li>
        </ul>
      </div>
    </div>
    <div class="panel-body">
      <p class="eyebrow">Calendario 30 dias</p>
      ${table(["Periodo", "Objetivo", "Accion"], weekRows)}
    </div>
    <div class="panel-body">
      <p class="eyebrow">Contenido inicial</p>
      ${table(["Pieza", "Tema", "Mensaje"], contentRows)}
    </div>
    <div class="panel-body">
      <p class="eyebrow">Sponsors oficiales</p>
      <div class="launch-sponsor-grid">
        ${["Banco Monex", "Klu", "Excent Capital"].map(name => `
          <article>
            <span>${name}</span>
            <strong>Contactar despues de traccion inicial</strong>
            <p>Usar catalogo visible, empresas registradas, solicitudes de patrocinio y evento piloto como evidencia.</p>
            ${button("Copiar argumento", () => copyLaunchText(`${name}: ROIS esta construyendo una red nacional de talento deportivo, empresas y eventos privados. Buscamos aliados institucionales para activar patrocinios deportivos, presencia en eventos y posicionamiento premium dentro del ecosistema.`))}
          </article>
        `).join("")}
      </div>
    </div>
  `);
}

function launchProgress(value, target) {
  const percent = Math.min(100, Math.round((Number(value || 0) / target) * 100));
  return `<span class="launch-progress"><i style="width:${percent}%"></i><em>${percent}%</em></span>`;
}

async function copyLaunchText(text) {
  try {
    await navigator.clipboard.writeText(text);
    notify("Lanzamiento", "Texto copiado", "Ya puedes pegarlo en Instagram, Facebook o tu red de contactos.");
  } catch (error) {
    notify("Lanzamiento", "Texto listo", text);
  }
}

function renderAdminStats() {
  const approvedUsers = state.data.profiles.filter(item => item.status === "approved").length;
  const totalUsers = state.data.profiles.length || 1;
  const sponsorReview = state.data.sponsorships.filter(item => item.status === "review").length;
  const diagnostics = profileDiagnostics();
  panel("admin-stats", "Estad\u00edsticas", "Indicadores operativos", `
    ${table(["M\u00e9trica", "Valor", "Lectura"], [
      ["Conversi\u00f3n de aprobaci\u00f3n", `${Math.round((approvedUsers / totalUsers) * 100)}%`, badge("estable")],
      ["Demanda de eventos", state.data.requests.length, badge("activa")],
      ["Patrocinios en revisi\u00f3n", sponsorReview, badge("prioridad")],
      ["Alertas de perfiles", diagnostics.length, badge(diagnostics.length ? "revisar" : "sin alertas")]
    ])}
    <div class="panel-body">
      <div class="section-minihead">
        <p class="eyebrow">Diagnostico de perfiles</p>
        <h3>Integridad Athlete y Founder</h3>
        <p>Detecta desalineaciones sin modificar datos automaticamente.</p>
      </div>
      ${diagnostics.length
        ? table(["Tipo", "Correo", "Problema", "Referencia"], diagnostics.map(item => [
            badge(item.type),
            escapeHtml(item.email || "Sin correo"),
            escapeHtml(item.issue),
            escapeHtml(item.reference || "Revisar")
          ]))
        : `<div class="empty">No se detectaron inconsistencias en los perfiles cargados.</div>`}
    </div>
  `);
}

function profileDiagnostics() {
  const diagnostics = [];
  const profiles = state.data?.profiles || [];
  const athletes = state.data?.athletes || [];
  const founders = state.data?.founders || [];
  const normalized = value => String(value || "").trim().toLowerCase();
  const add = (type, email, issue, reference = "") => diagnostics.push({ type, email, issue, reference });
  const profileById = new Map(profiles.filter(item => item.id).map(item => [item.id, item]));
  const seen = new Map();

  profiles.forEach(profile => {
    const email = normalized(profile.email);
    if (!email) add("Profile", "", "Profile sin correo", profile.id);
    const roleRows = profile.role === "founder"
      ? founders
      : profile.role === "athlete"
        ? athletes
        : [];
    if (["founder", "athlete"].includes(profile.role) && !roleRows.some(item =>
      item.profile_id === profile.id ||
      normalized(item.email || item.contact) === email
    )) {
      add(profile.role, email, `Profile sin fila real en ${profile.role === "founder" ? "founders" : "athletes"}`, profile.id);
    }
  });

  [...athletes.map(item => ({ ...item, diagnosticType: "Athlete" })), ...founders.map(item => ({ ...item, diagnosticType: "Founder" }))].forEach(record => {
    const email = normalized(record.email || record.contact);
    const key = `${record.diagnosticType}:${email}`;
    seen.set(key, (seen.get(key) || 0) + 1);
    if (record.is_virtual) add(record.diagnosticType, email, "Perfil virtual en uso", record.id);
    if (!record.profile_id) add(record.diagnosticType, email, "Falta profile_id", record.id);
    if (record.profile_id && !profileById.has(record.profile_id)) add(record.diagnosticType, email, "profile_id no corresponde a un profile cargado", record.profile_id);
    const profile = profileById.get(record.profile_id);
    if (profile && normalized(profile.email) !== email) add(record.diagnosticType, email, "Correo distinto entre profile y ficha", profile.email);
    if (!["approved", "pending", "blocked", "deleted", "rejected"].includes(normalized(record.status))) {
      add(record.diagnosticType, email, "Status invalido", record.status);
    }
    if (!["approved", "pending_review", "rejected", "hidden"].includes(normalized(record.visual_status))) {
      add(record.diagnosticType, email, "visual_status invalido", record.visual_status);
    }
    if (record.image_url?.startsWith("data:")) add(record.diagnosticType, email, "Imagen Base64 pendiente de migrar", record.id);
    if (record.image_url && !record.image_url.startsWith("data:") && !/^https?:\/\//i.test(record.image_url)) {
      add(record.diagnosticType, email, "URL de imagen no valida", record.image_url);
    }
    const required = record.diagnosticType === "Founder"
      ? [record.name, record.industry, record.stage, record.city, record.stats]
      : [record.name, record.sport, record.category, record.location, record.stats];
    if (required.some(value => !String(value || "").trim())) add(record.diagnosticType, email, "Datos obligatorios incompletos", record.id);
  });

  seen.forEach((count, key) => {
    if (count > 1) {
      const [type, email] = key.split(":");
      add(type, email, `Duplicado: ${count} filas`, "Resolver por email/profile_id");
    }
  });
  return diagnostics;
}

function panel(id, kicker, title, content) {
  document.querySelector(`[data-dashboard-panel="${id}"]`).innerHTML = `
    <div class="panel">
      <div class="panel-head"><div><p class="eyebrow">${kicker}</p><h3>${title}</h3></div></div>
      ${content}
    </div>
  `;
}

function table(headers, rows) {
  return `
    <table class="data-table">
      <thead><tr>${headers.map(header => `<th>${header}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
  `;
}

function badge(value) {
  return `<span class="pill">${String(value).replaceAll("_", " ")}</span>`;
}

function button(label, action) {
  const id = `act-${crypto.randomUUID()}`;
  queueMicrotask(() => {
    const element = document.getElementById(id);
    if (element) element.addEventListener("click", action);
  });
  return `<button id="${id}" class="btn" type="button">${label}</button>`;
}

function actionGroup(actions) {
  return `<div class="table-actions">${actions.join("")}</div>`;
}

function accountActions(account) {
  const email = normalizedAccountEmail(account.email);
  const actions = [];
  const status = accountRecordStatus(account);
  if (email === normalizedAccountEmail(state.session?.email)) {
    return "Sesion activa";
  }
  if (status !== "approved") {
    actions.push(button("Aprobar", () => approveAccount(account)));
  }
  if (!["blocked", "deleted"].includes(status)) {
    actions.push(button("Dar de baja", () => blockAccount(account)));
  }
  actions.push(button("Borrar definitivo", () => hardDeleteAccount(account)));
  return actionGroup(actions);
}

function userActions(user, tableName) {
  const actions = [];
  if (user.status !== "approved") {
    actions.push(button("Aprobar", () => approveUser(user, tableName)));
  }
  if (tableName === "profiles" && user.id === state.session?.id) {
    actions.push(`<span class="hint inline">Sesi\u00f3n activa</span>`);
  } else {
    actions.push(button("Dar de baja", () => confirmDeleteUser(user, tableName)));
  }
  return actionGroup(actions);
}

async function createRequest(type, title) {
  await api.insert("requests", { type, title, owner: state.session?.name || "Empresa", status: "review" });
  notify("Solicitud", "Solicitud creada", "ROIS ya recibi\u00f3 el registro para seguimiento operativo.");
  renderClient();
  renderAdmin();
}

function profileFormField(form, name) {
  return form.elements.namedItem(name);
}

function validateProfileForm(form, role) {
  const labels = role === "founder"
    ? { venture_name: "Proyecto o nombre artistico", sport: "Categoria de contenido", category: "Etapa profesional", location: "Ciudad", stats: "Resumen comercial" }
    : { sport: "Disciplina", category: "Categoria", location: "Ciudad", stats: "Resumen deportivo" };
  const required = [
    ["name", "Nombre"],
    ...(role === "founder" ? [["creator_type", "Tipo de creador"], ["venture_name", labels.venture_name], ["primary_platform", "Plataforma principal"]] : []),
    ["sport", labels.sport],
    ["category", labels.category],
    ["location", labels.location],
    ["stats", labels.stats]
  ];
  const missing = required.filter(([name]) => !String(profileFormField(form, name)?.value || "").trim());
  const terms = profileFormField(form, "terms_accepted");
  if (terms && !terms.checked) missing.push(["terms_accepted", "Terminos del perfil"]);
  if (!missing.length) return true;
  notify("Perfil", "Falta completar", missing.map(([, label]) => `- ${label}`).join("\n"));
  const first = profileFormField(form, missing[0][0]);
  first?.focus();
  first?.scrollIntoView({ behavior: "smooth", block: "center" });
  return false;
}

function setSavingState(form, saving) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent;
  button.disabled = saving;
  button.textContent = saving ? "Guardando..." : button.dataset.defaultLabel;
  form.setAttribute("aria-busy", saving ? "true" : "false");
}

async function persistProfileForm(form, options = {}) {
  const context = getCurrentProfileContext();
  if (!context) throw new Error("No encontramos el contexto autenticado del perfil.");
  if (!validateProfileForm(form, context.role)) return null;
  setSavingState(form, true);
  const previous = context.record;
  const mediaErrors = [];
  try {
    const realRecord = await resolveRealProfileRecord(context);
    const resolvedContext = {
      ...context,
      record: realRecord,
      isVirtual: false,
      profileId: context.sessionId || realRecord.profile_id
    };
    const value = name => String(profileFormField(form, name)?.value || "").trim();
    const patch = {
      name: value("name"),
      ...(context.role === "founder" ? {
        creator_type: value("creator_type") || "founder",
        public_name: value("public_name") || value("name"),
        venture_name: value("venture_name"),
        content_categories: value("content_categories"),
        primary_platform: value("primary_platform"),
        audience_size: Number(value("audience_size") || 0),
        engagement_rate: Number(value("engagement_rate") || 0),
        audience_location: value("audience_location"),
        audience_demographics: value("audience_demographics"),
        brand_categories: value("brand_categories"),
        past_collaborations: value("past_collaborations"),
        deliverables: value("deliverables"),
        availability: value("availability") || "available"
      } : {}),
      sport: value("sport"),
      category: value("category"),
      location: value("location"),
      ranking: value("ranking"),
      stats: value("stats"),
      monthly: Number(value("monthly") || (context.role === "founder" ? 2500 : 5000)),
      max_sponsors: Math.min(10, Number(value("max_sponsors") || 10)),
      video_url: value("video_url"),
      instagram_url: value("instagram_url"),
      tiktok_url: value("tiktok_url"),
      facebook_url: value("facebook_url"),
      linkedin_url: value("linkedin_url"),
      terms_accepted: Boolean(profileFormField(form, "terms_accepted")?.checked),
      visual_status: "approved"
    };
    const annualField = profileFormField(form, "annual");
    if (annualField && context.table === "athletes") patch.annual = Number(annualField.value || 1000);

    const imageFile = profileFormField(form, "image")?.files?.[0];
    if (imageFile) {
      try {
        const image = await uploadProfileAsset(imageFile, "avatar", resolvedContext);
        patch.image_url = image.url;
        patch.image_path = image.path;
        patch.image_name = image.name;
        patch.image_mime = image.mime;
      } catch (error) {
        mediaErrors.push(humanError(error));
      }
    }

    const logoFiles = profileFormField(form, "sponsor_logo_files")?.files;
    if (logoFiles?.length) {
      try {
        patch.sponsor_logos = await uploadSponsorLogoPayload(
          logoFiles,
          value("sponsor_logo_names"),
          resolvedContext
        );
      } catch (error) {
        mediaErrors.push(humanError(error));
      }
    }

    const updated = await saveProfileRecord(patch, resolvedContext);
    if (patch.terms_accepted && !previous?.terms_accepted) {
      try {
        await api.insert("terms_acceptances", {
          user_email: state.session.email,
          user_role: context.role,
          version: `${context.role}-profile-media-v1`,
          status: "accepted"
        });
      } catch (error) {
        console.warn("[ROIS profile] No fue posible registrar terminos", humanError(error));
      }
    }
    if (patch.name && patch.name !== state.session?.name) {
      state.session = { ...state.session, name: patch.name };
      saveSession(state.session);
      try {
        await api.update("profiles", state.session.id, { name: patch.name });
      } catch (error) {
        console.warn("[ROIS profile] El perfil se guardo, pero profiles.name no se sincronizo", humanError(error));
      }
    }
    refreshProfileViews(context.role, updated);
    const title = context.role === "founder" ? "Perfil de creador" : options.requirements ? "Expediente deportivo" : "Perfil deportivo";
    if (mediaErrors.length) {
      notify(title, "Perfil guardado con observaciones", `El perfil se guardo, pero algunos medios no pudieron cargarse:\n${mediaErrors.map(message => `- ${message}`).join("\n")}`);
    } else {
      notify(title, "Perfil actualizado", "Los cambios ya estan visibles en tu dashboard y en las tarjetas ROIS.");
    }
    return updated;
  } finally {
    setSavingState(form, false);
  }
}

async function submitAthleteRequirements(event) {
  event.preventDefault();
  try {
    await persistProfileForm(event.currentTarget, { requirements: true });
  } catch (error) {
    notify("Expediente", "No fue posible guardar", humanError(error));
  }
}

async function submitAthleteProfile(event) {
  event.preventDefault();
  try {
    await persistProfileForm(event.currentTarget);
  } catch (error) {
    notify("Perfil", "No fue posible guardar", humanError(error));
  }
}

async function submitAthleteResult(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const athlete = currentAthlete();
  const proof = await fileToDataUrl(form.proof.files[0]);
  await api.insert("athlete_results", {
    athlete_id: athlete?.id,
    athlete_email: state.session.email,
    athlete_name: athlete?.name || state.session.name,
    month: form.month.value,
    event: form.event.value,
    summary: form.summary.value,
    proof_url: proof,
    status: "review"
  });
  notify("Resultados", "Resultado enviado", "ROIS revisar\u00e1 el soporte antes de integrarlo al reporte para patrocinadores.");
  renderAthlete();
}

async function submitAthletePost(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const athlete = currentAthlete();
  const videoFile = form.video_file.files[0];
  if (!videoFile) {
    notify("Entrenamientos", "Video requerido", "Selecciona un archivo de video para publicar tu reel.");
    return;
  }
  if (videoFile.size > 35 * 1024 * 1024) {
    notify("Entrenamientos", "Video demasiado pesado", "Sube un reel corto en MP4, WebM o MOV de hasta 35 MB.");
    return;
  }
  const video_url = await fileToDataUrl(videoFile);
  const image_url = await fileToDataUrl(form.image.files[0]);
  await api.insert("athlete_posts", {
    athlete_id: athlete?.id,
    athlete_email: state.session.email,
    athlete_name: athlete?.name || state.session.name,
    title: form.title.value,
    caption: form.caption.value,
    video_url,
    image_url,
    status: "approved",
    visual_status: "approved"
  });
  notify("Entrenamientos", "Reel publicado", "El contenido ya aparece en el feed de empresas.");
  renderAthlete();
  renderAdmin();
  renderClient();
}

async function submitAthleteExpense(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const athlete = currentAthlete();
  const ticket_url = await fileToDataUrl(form.ticket.files[0]);
  const invoice_url = await fileToDataUrl(form.invoice.files[0]);
  await api.insert("athlete_expenses", {
    athlete_id: athlete?.id,
    athlete_email: state.session.email,
    athlete_name: athlete?.name || state.session.name,
    date: form.date.value,
    category: form.category.value,
    amount: Number(form.amount.value || 0),
    company: form.company.value,
    ticket_url,
    invoice_url,
    notes: form.notes.value,
    status: "review"
  });
  notify("Tickets y facturas", "Comprobantes enviados", "ROIS revisar\u00e1 que los consumos est\u00e9n soportados y facturados correctamente.");
  renderAthlete();
  renderAdmin();
}

async function createEventSponsorshipRequest(event, level) {
  await api.insert("requests", {
    type: "Patrocinio evento",
    title: `${event.name} - ${level.name}`,
    owner: state.session?.name || "Empresa",
    details: `Evento: ${event.name} | Paquete: ${level.name} | Monto: ${level.amount} | Beneficios: ${level.benefits}`,
    priority: level.amount || "Paquete privado",
    status: "review"
  });
  notify("Eventos", "Paquete solicitado", "ROIS revisar\u00e1 disponibilidad, beneficios y condiciones del patrocinio del evento.");
  renderClient();
  renderAdmin();
}

async function createSponsorship(athlete, amount, details = "", paymentUrl = "") {
  const athleteRecord = state.data.athletes.find(item => item.name === athlete);
  const company = currentCompany();
  const companyName = company?.name || state.session?.name || "Empresa";
  await api.insert("sponsorships", {
    athlete,
    athlete_email: athleteRecord?.email || "",
    amount,
    company: companyName,
    details,
    status: paymentUrl ? "payment_started" : "review"
  });
  await api.insert("requests", {
    type: "Patrocinio deportista",
    title: athlete,
    owner: companyName,
    details,
    priority: `$${Number(amount).toLocaleString("es-MX")} MXN`,
    status: paymentUrl ? "payment_started" : "review"
  });
  await api.insert("payments", { concept: `Patrocinio mensual - ${athlete}`, amount, company: companyName, status: "pending", product_key: "" });
  notify("Sponsor", paymentUrl ? "Checkout iniciado" : "Patrocinio solicitado", paymentUrl ? "Abrimos el link de pago mensual y registramos la solicitud en ROIS." : "ROIS asignar\u00e1 el link de pago mensual para completar el patrocinio.");
  renderClient();
  renderAdmin();
}

async function payClientPayment(id) {
  const payment = state.data.payments.find(item => item.id === id);
  if (!payment?.product_key) {
    notify("Stripe", "Pago personalizado", "Este pago requiere invoice o link personalizado del equipo ROIS.");
    return;
  }
  openStripeCheckout(payment.product_key, payment.concept);
}

async function approve(tableName, id) {
  await api.update(tableName, id, { status: "approved" });
  notify("Aprobaci\u00f3n", "Elemento aprobado", "El estado fue actualizado correctamente.");
  renderAdmin();
  renderPublic();
  if (state.session?.role === "client") renderClient();
  if (state.session?.role === "athlete") renderAthlete();
}

async function approveAccount(account) {
  const updates = [];
  if (account.profile) {
    const role = account.profile.role === "admin" ? "admin" : account.founder ? "founder" : account.athlete ? "athlete" : "client";
    updates.push(api.update("profiles", account.profile.id, { status: "approved", role }));
  }
  if (account.company) {
    updates.push(api.update("companies", account.company.id, { status: "approved" }));
  }
  if (account.athlete) {
    updates.push(api.update("athletes", account.athlete.id, { status: "approved", visual_status: account.athlete.visual_status || "approved" }));
  }
  if (account.founder) {
    updates.push(api.update("founders", account.founder.id, { status: "approved", visual_status: account.founder.visual_status || "approved" }));
  }
  await Promise.all(updates);
  notify("Usuarios", "Cuenta aprobada", "La cuenta agrupada quedo aprobada correctamente.");
  renderAdmin();
  renderPublic();
}

async function blockAccount(account) {
  const confirmed = window.confirm(`¿Dar de baja la cuenta "${accountDisplayName(account)}"? El usuario ya no podra ingresar a ROIS.`);
  if (!confirmed) return;
  const updates = [];
  if (account.profile) updates.push(api.update("profiles", account.profile.id, { status: "blocked" }));
  if (account.company) updates.push(api.update("companies", account.company.id, { status: "blocked" }));
  if (account.athlete) updates.push(api.update("athletes", account.athlete.id, { status: "blocked" }));
  if (account.founder) updates.push(api.update("founders", account.founder.id, { status: "blocked" }));
  await Promise.all(updates);
  notify("Usuarios", "Cuenta dada de baja", "La cuenta fue bloqueada en los modulos operativos.");
  renderAdmin();
}

async function hardDeleteAccount(account) {
  const email = normalizedAccountEmail(account.email);
  if (!email) {
    notify("Usuarios", "Correo no encontrado", "No se puede borrar una cuenta sin correo identificable.");
    return;
  }
  if (email === normalizedAccountEmail(state.session?.email)) {
    notify("Usuarios", "Accion bloqueada", "No puedes borrar la cuenta de la sesion activa.");
    return;
  }
  const typed = window.prompt(`Esta accion eliminara definitivamente la cuenta operativa ${email} de profiles, companies, athletes y founders. Escribe BORRAR para confirmar.`);
  if (typed !== "BORRAR") {
    notify("Usuarios", "Borrado cancelado", "No se realizaron cambios.");
    return;
  }
  const removals = [];
  if (account.profile?.id) removals.push(api.remove("profiles", account.profile.id));
  if (account.company?.id) removals.push(api.remove("companies", account.company.id));
  if (account.athlete?.id) removals.push(api.remove("athletes", account.athlete.id));
  if (account.founder?.id) removals.push(api.remove("founders", account.founder.id));
  await Promise.all(removals);
  notify(
    "Usuarios",
    "Cuenta eliminada",
    "La cuenta fue eliminada de profiles, companies, athletes y founders. Los registros financieros y de trazabilidad se conservaron."
  );
  renderAdmin();
  renderPublic();
}

async function approveUser(user, tableName) {
  if (tableName === "profiles") {
    const email = user.email.toLowerCase();
    await api.update("profiles", user.id, {
      status: "approved",
      role: email === adminEmail ? "admin" : user.role === "athlete" ? "athlete" : "client"
    });
    const company = state.data.companies.find(item => (item.contact || "").toLowerCase() === email);
    if (company) await api.update("companies", company.id, { status: "approved" });
  } else {
    const email = (user.contact || "").toLowerCase();
    await api.update("companies", user.id, { status: "approved" });
    const profile = state.data.profiles.find(item => item.email.toLowerCase() === email);
    if (profile) await api.update("profiles", profile.id, { status: "approved", role: "client" });
  }
  notify("Usuarios", "Cliente aprobado", "El acceso qued\u00f3 autorizado para el dashboard de cliente.");
  renderAdmin();
  renderPublic();
}

async function confirmDeleteUser(user, tableName) {
  const confirmed = window.confirm(`\u00bfDar de baja el usuario "${user.name}"? La cuenta ya no podr\u00e1 ingresar a ROIS.`);
  if (!confirmed) return;
  const email = String(user.email || user.contact || "").toLowerCase();
  if (tableName === "profiles") {
    await api.update("profiles", user.id, { status: "blocked" });
    const company = state.data.companies.find(item => String(item.contact || "").toLowerCase() === email);
    if (company) await api.update("companies", company.id, { status: "blocked" });
    const athlete = state.data.athletes.find(item => String(item.email || "").toLowerCase() === email);
    if (athlete) await api.update("athletes", athlete.id, { status: "blocked" });
  } else {
    await api.update("companies", user.id, { status: "blocked" });
    const profile = state.data.profiles.find(item => String(item.email || "").toLowerCase() === email);
    if (profile) await api.update("profiles", profile.id, { status: "blocked" });
  }
  notify("Usuarios", "Cuenta dada de baja", "El usuario qued\u00f3 bloqueado y ya no podr\u00e1 iniciar sesi\u00f3n.");
  renderAdmin();
}

async function updateCrm(id) {
  await api.update("crm", id, { status: "En seguimiento" });
  notify("CRM", "Pipeline actualizado", "El elemento cambi\u00f3 a seguimiento.");
  renderAdmin();
}

async function markPaid(id) {
  await api.update("payments", id, { status: "paid" });
  notify("Pagos", "Pago actualizado", "El pago fue marcado como pagado.");
  renderAdmin();
}

async function sendAthleteNotificationEmail(notification) {
  if (!config.notificationEmailWebhook) {
    return { skipped: true };
  }
  const response = await fetch(config.notificationEmailWebhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: notification.athlete_email,
      athlete_name: notification.athlete_name,
      subject: notification.title,
      message: notification.message,
      category: notification.category,
      priority: notification.priority,
      created_at: notification.created_at
    })
  });
  if (!response.ok) throw new Error("No fue posible enviar el correo de notificacion.");
  return { sent: true };
}

async function submitAdminAthleteNotification(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const athlete = state.data.athletes.find(item => String(item.email || "").toLowerCase() === String(form.athlete_email.value || "").toLowerCase());
  const created_at = new Date().toISOString();
  const notification = {
    athlete_id: athlete?.id,
    athlete_email: form.athlete_email.value,
    athlete_name: athlete?.name || form.athlete_email.value,
    title: form.title.value,
    message: form.message.value,
    category: form.category.value,
    priority: form.priority.value,
    status: "unread",
    email_status: config.notificationEmailWebhook ? "queued" : "pending_webhook",
    sent_by: state.session?.email || "admin",
    created_at
  };
  let emailStatus = "La notificacion quedo visible en el dashboard.";
  if (config.notificationEmailWebhook) {
    try {
      await sendAthleteNotificationEmail(notification);
      notification.email_status = "sent";
      emailStatus = "Tambien se envio el correo al deportista.";
    } catch (error) {
      notification.email_status = "email_error";
      emailStatus = "El dashboard se actualizo, pero el correo requiere revisar el webhook.";
    }
  }
  await api.insert("athlete_notifications", notification);
  notify("Notificaciones", "Mensaje enviado", emailStatus);
  form.reset();
  renderAdmin();
}

async function markAthleteNotificationRead(id) {
  await api.update("athlete_notifications", id, { status: "read", read_at: new Date().toISOString() });
  renderAthlete();
}

async function submitAdminDeposit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const athlete = state.data.athletes.find(item => (item.email || "") === form.athlete_email.value);
  const proof_url = await fileToDataUrl(form.proof.files[0]);
  await api.insert("athlete_deposits", {
    athlete_id: athlete?.id,
    athlete_email: form.athlete_email.value,
    athlete_name: athlete?.name || form.athlete_email.value,
    month: form.month.value,
    amount: Number(form.amount.value || 0),
    company: form.company.value || "ROIS",
    proof_url,
    status: "paid"
  });
  await api.insert("athlete_notifications", {
    athlete_id: athlete?.id,
    athlete_email: form.athlete_email.value,
    athlete_name: athlete?.name || form.athlete_email.value,
    title: "Comprobante de deposito cargado",
    message: `ROIS cargo el comprobante del periodo ${form.month.value} por $${Number(form.amount.value || 0).toLocaleString("es-MX")} MXN.`,
    category: "pago",
    priority: "alta",
    status: "unread",
    email_status: "sistema",
    sent_by: state.session?.email || "admin",
    created_at: new Date().toISOString()
  });
  notify("Dep\u00f3sitos", "Comprobante cargado", "El deportista ya puede ver el comprobante en su dashboard.");
  renderAdmin();
}

async function submitAdminAthlete(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const skippedMedia = Boolean(
    form.image.files[0] ||
    form.sponsor_logo_files.files.length
  );
  await api.insert("athletes", {
    name: form.name.value,
    sport: form.sport.value,
    category: form.category.value,
    location: form.location.value,
    ranking: form.ranking.value,
    stats: form.stats.value,
    annual: Number(form.annual.value || athleteAnnualFeeAmount),
    annual_fee_required: form.annual_fee_required.value === "true",
    monthly: Number(form.monthly.value || 5000),
    max_sponsors: Math.min(10, Number(form.max_sponsors.value || 10)),
    scout_code: makeScoutCode(form.name.value, ""),
    scout_active: false,
    invited_by_scout_code: "",
    scout_terms_accepted: false,
    annual_fee_paid: false,
    scout_validation_status: "pending",
    scout_commission_status: "pending",
    sponsor_payment_url: form.sponsor_payment_url.value,
    sponsor_terms: form.sponsor_terms.value,
    sponsor_logos: "",
    video_url: form.video_url.value,
    status: "pending",
    image_url: "",
    visual_status: "approved"
  });
  notify(
    "Deportistas",
    "Deportista creado",
    skippedMedia
      ? "El perfil fue creado sin copiar archivos Base64. Vincula la cuenta y permite que el athlete cargue sus medios en Storage."
      : "El perfil quedo creado y pendiente de completar por el athlete."
  );
  renderAdmin();
}

async function toggleAthleteAnnualFee(athlete) {
  const next = !athleteAnnualFeeRequired(athlete);
  await api.update("athletes", athlete.id, { annual_fee_required: next, annual: athleteAnnualFeeAmount });
  notify("Anualidad deportista", next ? "Solicitud habilitada" : "Solicitud oculta", next ? `${athlete.name} ya vera el aviso de anualidad con boton de pago en su dashboard.` : `${athlete.name} podra explorar y configurar su dashboard sin aviso de pago anual.`);
  renderAdmin();
  if (state.session?.role === "athlete") renderAthlete();
}

async function activateScoutNetwork(athlete) {
  await api.update("athletes", athlete.id, {
    scout_code: scoutCodeForAthlete(athlete),
    scout_active: true,
    scout_terms_accepted: true
  });
  notify("Scouts ROIS", "Codigo activado", "Ya puedes invitar deportistas. Las comisiones solo se liberan por cuentas pagadas, completas y validadas por ROIS.");
  renderAthlete();
  renderAdmin();
}

async function markAthleteAnnualPaid(athlete) {
  await api.update("athletes", athlete.id, {
    annual_fee_paid: true,
    annual_payment_status: "paid",
    annual: athleteAnnualFeeAmount
  });
  notify("Anualidad", "Pago registrado", "El pago anual quedo marcado para seguimiento interno.");
  renderAdmin();
}

async function validateScoutCommission(record, tableName = "athletes") {
  await api.update(tableName, record.id, {
    scout_validation_status: "validated",
    scout_commission_status: "approved"
  });
  notify("Scouts", "Comision validada", "La cuenta queda elegible para comision si tambien cumple pago y perfil completo.");
  renderAdmin();
}

async function copyScoutCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    notify("Scouts ROIS", "Codigo copiado", "Comparte este codigo con deportistas que cumplan el perfil ROIS.");
  } catch (error) {
    notify("Scouts ROIS", code, "Copia manualmente este codigo para compartirlo.");
  }
}

async function requestScoutCode() {
  const form = document.getElementById("registrationForm");
  const email = form?.email?.value || "";
  const name = form?.name?.value || "";
  await api.insert("requests", {
    type: "Scout ROIS",
    title: "Solicitud de codigo Scout",
    owner: name || email || "Prospecto deportista",
    details: `Prospecto solicita codigo Scout ROIS. Correo: ${email || "pendiente"}`,
    priority: "Alta",
    status: "review"
  });
  notify("Codigo Scout", "Solicitud enviada", "ROIS te asignara un Scout para que puedas completar tu registro deportivo.");
  renderAdmin();
}

async function submitAdminEvent(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const image_url = await fileToDataUrl(form.image.files[0]);
  const brochureFile = form.brochure_pdf.files[0];
  const brochure_url = brochureFile ? await fileToDataUrl(brochureFile) : "";
  await api.insert("events", {
    name: form.name.value,
    category: form.category.value,
    venue: form.venue.value,
    date: form.date.value,
    brochure_url,
    brochure_name: brochureFile?.name || "",
    event_scope: form.event_scope.value,
    status: "pending",
    image_url,
    visual_status: image_url ? "pending_review" : "approved"
  });
  notify("Eventos", "Evento creado", "El evento qued\u00f3 pendiente de aprobaci\u00f3n y revisi\u00f3n visual.");
  renderAdmin();
}

async function submitAdminPartner(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const image_url = await fileToDataUrl(form.image.files[0]);
  await api.insert("partnerships", {
    name: form.name.value,
    type: form.type.value,
    tier: form.tier.value,
    url: form.url.value,
    description: form.description.value,
    status: form.status.value,
    image_url,
    visual_status: image_url ? "pending_review" : "approved"
  });
  notify("Alianzas", "Alianza guardada", "El registro qued\u00f3 disponible para aprobaci\u00f3n y revisi\u00f3n visual.");
  renderAdmin();
  renderPublic();
}

async function submitAdminVipProduct(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const file = form.image.files[0];
  const image_url = file ? await fileToDataUrl(file) : "";
  await api.insert("partnerships", {
    name: form.name.value,
    type: "Centro VIP",
    tier: form.price.value,
    url: form.url.value,
    description: form.description.value,
    status: form.status.value,
    image_url,
    visual_status: image_url ? "pending_review" : "approved"
  });
  notify("Centro VIP", "Producto publicado", "El producto quedo disponible para empresas segun su estado y revision visual.");
  renderAdmin();
  renderClient();
}

async function approveVisual(tableName, item) {
  await api.update(tableName, item.id, { visual_status: "approved", visual_notes: "" });
  notify("Moderaci\u00f3n visual", "Visual aprobado", "El visual ya puede mostrarse en \u00e1reas p\u00fablicas si el contenido tambi\u00e9n est\u00e1 aprobado.");
  renderAdmin();
  renderPublic();
}

async function rejectVisual(tableName, item) {
  await api.update(tableName, item.id, { visual_status: "rejected", status: item.status === "published" ? "draft" : item.status, visual_notes: "Rechazado por revisi\u00f3n manual" });
  notify("Moderaci\u00f3n visual", "Visual rechazado", "El visual qued\u00f3 bloqueado y no se mostrar\u00e1 p\u00fablicamente.");
  renderAdmin();
  renderPublic();
}

async function deleteContent(tableName, item) {
  const confirmed = window.confirm(`\u00bfEliminar "${item.name || item.title}"?`);
  if (!confirmed) return;
  try {
    await api.remove(tableName, item.id);
    notify("Contenido", "Elemento eliminado", "El elemento fue eliminado del dashboard.");
    renderAdmin();
    renderPublic();
    renderClient();
  } catch (error) {
    notify("Contenido", "No fue posible eliminar", humanError(error));
  }
}

async function hideContent(tableName, item) {
  const label = item.name || item.title;
  const confirmed = window.confirm(`\u00bfBajar "${label}" del home y dashboard cliente?`);
  if (!confirmed) return;
  const hiddenStatus = tableName === "news" ? "draft" : "archived";
  try {
    await api.update(tableName, item.id, { status: hiddenStatus });
    notify("Contenido", "Elemento oculto", "Ya no aparece en home ni en el dashboard de clientes.");
    renderAdmin();
    renderPublic();
    renderClient();
  } catch (error) {
    notify("Contenido", "No fue posible ocultar", humanError(error));
  }
}

function moderationActions(tableName, item) {
  const actions = [];
  if (item.status !== "approved" && tableName !== "news" && tableName !== "uploads") {
    actions.push(button("Aprobar contenido", () => approve(tableName, item.id)));
  }
  if (tableName === "news" && item.status !== "published") {
    actions.push(button("Publicar", () => api.update("news", item.id, { status: "published" }).then(() => { renderAdmin(); renderPublic(); })));
  }
  if (
    (tableName === "events" && item.status === "approved") ||
    (tableName === "athletes" && item.status === "approved") ||
    (tableName === "partnerships" && item.status === "approved") ||
    (tableName === "news" && item.status === "published")
  ) {
    actions.push(button("Bajar del home", () => hideContent(tableName, item)));
  }
  if (item.image_url && item.visual_status !== "approved") {
    actions.push(button("Aprobar visual", () => approveVisual(tableName, item)));
  }
  if (item.image_url && item.visual_status !== "rejected") {
    actions.push(button("Rechazar visual", () => rejectVisual(tableName, item)));
  }
  actions.push(button("Eliminar", () => deleteContent(tableName, item)));
  return actionGroup(actions);
}

function visualIsPublic(item) {
  return !item.image_url || item.visual_status === "approved";
}

function visualThumb(item) {
  if (!item.image_url) return `<span class="visual-empty">Sin visual</span>`;
  return safeProfileImageMarkup(item.image_url, `Visual de ${item.name || item.title || "ROIS"}`, profileImageFallback, "visual-thumb");
}

function eventPositioningBlock(event) {
  const scope = event.event_scope || event.sponsor_levels || "Alcance comercial pendiente de publicaci\u00f3n por ROIS.";
  return `
    <div class="event-positioning">
      <p class="eyebrow">Alcance del evento</p>
      <p>${scope}</p>
    </div>
  `;
}

function eventBrochureLink(event) {
  if (!event.brochure_url) return "";
  const filename = event.brochure_name || `${event.name || "brochure-rois"}.pdf`;
  return `<a class="btn" href="${event.brochure_url}" target="_blank" rel="noopener" download="${filename}">Descargar brochure</a>`;
}

function eventClientCard(event) {
  return publishedCard({
    item: event,
    kicker: event.category,
    title: event.name,
    text: `${event.venue || "Sede por confirmar"} - ${event.date || "Fecha por confirmar"}`,
    action: `
      ${eventPositioningBlock(event)}
      <div class="action-row">
        ${event.brochure_url ? eventBrochureLink(event) : `<span class="hint inline">Brochure pendiente</span>`}
        ${button("Solicitar acceso", () => createRequest("Acceso evento", event.name))}
      </div>
    `
  });
}

function newsInteractionCount(news, reaction) {
  return state.data.requests.filter(item =>
    item.type === "Interacci\u00f3n noticia" &&
    item.priority === reaction &&
    String(item.details || "").includes(`news:${news.id}`)
  ).length;
}

function newsInteractionBar(news) {
  return "";
}

async function interactWithNews(news, reaction) {
  let note = "";
  if (reaction === "Comentario") {
    note = window.prompt("Escribe tu comentario para ROIS:") || "";
    if (!note.trim()) return;
  }
  if (reaction === "Compartir") {
    const link = `${window.location.origin}${window.location.pathname}#news`;
    try {
      await navigator.clipboard?.writeText(link);
    } catch (_) {
      // Clipboard can be blocked in some browsers; the interaction is still recorded.
    }
  }
  await api.insert("requests", {
    type: "Interacci\u00f3n noticia",
    title: news.title,
    owner: state.session?.name || "Empresa",
    details: `news:${news.id} | ${reaction}${note ? ` | ${note}` : ""}`,
    priority: reaction,
    status: "recorded"
  });
  notify("Noticias", "Interacci\u00f3n registrada", reaction === "Compartir" ? "Copiamos el enlace de noticias y registramos tu interacci\u00f3n." : "Tu interacci\u00f3n qued\u00f3 registrada para el equipo ROIS.");
  renderClient();
  renderAdmin();
}

function athleteSponsorConditions() {
  return [
    "Logo en uniforme o equipo autorizado",
    "Menci\u00f3n mensual en redes sociales",
    "Video corto de agradecimiento para la marca",
    "Uso de imagen del deportista en campa\u00f1a aprobada",
    "Presencia en evento corporativo o cl\u00ednica deportiva",
    "Reporte trimestral de avances deportivos"
  ];
}

function openAthleteSponsorConfigurator(athlete) {
  const conditions = athlete.sponsor_terms
    ? String(athlete.sponsor_terms).split("\n").map(item => item.trim()).filter(Boolean)
    : athleteSponsorConditions();
  const monthly = athleteMonthlyTicket(athlete);
  notify(
    "Mercado de fichajes",
    `Patrocinar a ${athlete.name}`,
    "Selecciona las condiciones de valor que quieres explorar con ROIS. El acuerdo final se valida cuidando la meta deportiva del atleta.",
    `
      <form id="athleteSponsorForm" class="stack-form">
        <label>Presupuesto mensual
          <select name="amount">
            <option value="${monthly}">$${monthly.toLocaleString("es-MX")} MXN - Ticket sugerido</option>
            <option value="${monthly * 2}">$${(monthly * 2).toLocaleString("es-MX")} MXN - Doble impacto</option>
            <option value="${monthly * 5}">$${(monthly * 5).toLocaleString("es-MX")} MXN - Patrocinio premium</option>
            <option value="50000">$50,000 MXN+ - Personalizado</option>
          </select>
        </label>
        <div class="check-grid">
          ${conditions.map((condition, index) => `
            <label class="check-option">
              <input type="checkbox" name="conditions" value="${condition}" ${index < 2 ? "checked" : ""}>
              <span>${condition}</span>
            </label>
          `).join("")}
        </div>
        <label>Notas para ROIS
          <textarea name="notes" placeholder="Objetivo de marca, giro, restricciones o campa\u00f1a deseada."></textarea>
        </label>
        <label class="check-option">
          <input type="checkbox" name="terms" required>
          <span>Acepto que la solicitud de patrocinio se gestiona por ROIS y que el acuerdo final debe formalizarse mediante contrato de patrocinio administrado por la plataforma.</span>
        </label>
        <button class="btn primary full" type="submit">Enviar y continuar a pago</button>
      </form>
    `
  );
  document.getElementById("athleteSponsorForm").addEventListener("submit", event => submitAthleteSponsorForm(event, athlete));
}

async function submitAthleteSponsorForm(event, athlete) {
  event.preventDefault();
  const form = event.currentTarget;
  const amount = Number(form.amount.value);
  const selected = Array.from(form.querySelectorAll("input[name='conditions']:checked")).map(input => input.value);
  const details = [
    `Condiciones: ${selected.join("; ") || "Por definir"}`,
    `Notas: ${form.notes.value || "Sin notas"}`
  ].join(" | ");
  if (athlete.sponsor_payment_url) {
    openExternalUrl(athlete.sponsor_payment_url, `Patrocinio de ${athlete.name}`);
  }
  closeModals();
  await createSponsorship(athlete.name, amount, details, athlete.sponsor_payment_url || "");
}

function publishedCard({ item, kicker, title, text, action }) {
  const image = item.image_url || "./assets/rois-logo.png";
  return `
    <article class="published-card editorial-card">
      <div class="published-cover editorial-cover">
        <img src="${image}" alt="${escapeAttr(title || "ROIS")}">
      </div>
      <div class="published-content editorial-content">
        <p class="eyebrow">${escapeHtml(kicker || "ROIS")}</p>
        <h3>${escapeHtml(title || "Actualizacion ROIS")}</h3>
        <div class="editorial-body">
          ${formatEditorialBody(text)}
        </div>
        ${action || ""}
      </div>
    </article>
  `;
}

function editorialPreviewText(text = "") {
  const paragraphs = String(text || "")
    .split(/\n\s*\n/)
    .map(item => item.trim())
    .filter(Boolean);
  if (!paragraphs.length) return "Informacion disponible para miembros aprobados.";
  return paragraphs.slice(0, 2).join("\n\n");
}

function editorialNewsCard(item, options = {}) {
  const image = item.image_url || "./assets/rois-logo.png";
  const kicker = options.kicker || "Nota ROIS";
  const title = options.title || item.title || "Actualizacion ROIS";
  const rawText = options.text || item.summary || "Informacion disponible para miembros aprobados.";
  const bodyText = options.preview ? editorialPreviewText(rawText) : rawText;
  const action = options.action || newsInteractionBar(item) || "";

  return `
    <article class="editorial-news-card">
      <div class="editorial-news-cover">
        <img src="${escapeAttr(image)}" alt="${escapeAttr(title || "Nota ROIS")}">
      </div>
      <div class="editorial-news-body">
        <p class="eyebrow">${escapeHtml(kicker)}</p>
        <h2>${escapeHtml(title)}</h2>
        <div class="editorial-body">
          ${formatEditorialBody(bodyText)}
        </div>
        ${action}
      </div>
    </article>
  `;
}

function publicEditorialNewsCard(news) {
  return editorialNewsCard(news, {
    kicker: "Nota ROIS",
    text: news.summary,
    action: `<div class="social-actions public-social"><button class="btn" type="button" data-open-login>Me gusta</button><button class="btn" type="button" data-open-login>Comentar</button><button class="btn" type="button" data-open-login>Compartir</button></div>`
  });
}

function videoEmbedUrl(url = "") {
  const value = String(url || "").trim();
  if (!value) return "";
  const youtube = value.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]+)/);
  if (youtube?.[1]) return `https://www.youtube.com/embed/${youtube[1]}`;
  const vimeo = value.match(/vimeo\.com\/(?:video\/)?([0-9]+)/);
  if (vimeo?.[1]) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return "";
}

function reelMedia(post, athlete, options = {}) {
  const embedUrl = videoEmbedUrl(post.video_url);
  const isFeed = Boolean(options.feed);
  if (post.video_url?.startsWith("data:video")) {
    return `<video src="${post.video_url}" ${isFeed ? "muted loop autoplay" : "controls muted loop"} playsinline preload="${isFeed ? "auto" : "metadata"}" poster="${escapeAttr(post.image_url || athlete?.image_url || "")}"></video>`;
  }
  if (embedUrl) {
    return `<iframe src="${embedUrl}" title="${escapeAttr(post.title || "Reel deportivo")}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
  }
  const image = post.image_url || athlete?.image_url || profileImageFallback;
  const link = post.video_url ? `<a class="btn primary" href="${post.video_url}" target="_blank" rel="noopener">Abrir reel</a>` : "";
  return `
    ${safeProfileImageMarkup(image, post.title || "Reel deportivo")}
    <div class="reel-media-fallback">${link}</div>
  `;
}

function athleteSponsorCta(athlete, label = "") {
  const buttonLabel = label || (athlete.sponsor_payment_url ? "Pagar patrocinio" : "Solicitar patrocinio");
  return `<button class="btn" type="button" data-athlete-sponsor="${escapeAttr(athlete.id)}">${buttonLabel}</button>`;
}

async function startAthleteSponsorPayment(athlete) {
  if (!state.session || state.session.role !== "client") {
    openLogin();
    return;
  }
  try {
    const amount = athleteMonthlyTicket(athlete);
    const details = athlete.sponsor_payment_url
      ? "Pago mensual iniciado desde dashboard empresarial."
      : "Solicitud enviada desde dashboard empresarial. Falta link mensual asignado por ROIS.";
    if (athlete.sponsor_payment_url) {
      openExternalUrl(athlete.sponsor_payment_url, `Patrocinio de ${athlete.name}`);
    } else {
      notify("Patrocinio", "Link mensual pendiente", "ROIS debe asignar el link mensual de este deportista. La solicitud quedara registrada para seguimiento.");
    }
    await createSponsorship(athlete.name, amount, details, athlete.sponsor_payment_url || "");
  } catch (error) {
    notify("Patrocinio", "No fue posible registrar", humanError(error));
  }
}

function athleteFeedCard(post) {
  const athlete = state.data.athletes.find(item => item.id === post.athlete_id || item.email === post.athlete_email || item.name === post.athlete_name);
  return `
    <article class="feed-card reel-card">
      <div class="feed-media reel-media">
        ${reelMedia(post, athlete, { feed: true })}
        ${post.video_url?.startsWith("data:video") ? `<button class="reel-sound-toggle" type="button" data-reel-sound>Activar sonido</button>` : ""}
      </div>
      <div class="feed-content reel-content">
        <div>
          <p class="eyebrow">${athlete?.sport || "Entrenamiento"}</p>
          <h3>${post.title}</h3>
          <p>${post.caption || "Actualizacion deportiva publicada por atleta ROIS."}</p>
          <div class="row-meta">
            <span class="pill">${post.athlete_name || athlete?.name || "Atleta ROIS"}</span>
            ${athlete?.monthly ? `<span class="pill">$${Number(athlete.monthly).toLocaleString("es-MX")} MXN / mes</span>` : ""}
          </div>
        </div>
        <div class="reel-actions">
          ${post.video_url && !post.video_url.startsWith("data:video") ? `<a class="btn" href="${post.video_url}" target="_blank" rel="noopener">Abrir video</a>` : ""}
          ${athlete ? `
            <button class="btn" type="button" data-athlete-profile="${escapeAttr(athlete.id)}">Ver perfil</button>
            ${athleteSponsorCta(athlete)}
          ` : ""}
        </div>
      </div>
    </article>
  `;
}

function athleteOwnReelCard(post) {
  const athlete = currentAthlete() || state.data.athletes.find(item => item.email === post.athlete_email);
  const founder = isFounderProfile(athlete);
  return `
    <article class="feed-card reel-card own-reel-card">
      <div class="feed-media reel-media">
        ${reelMedia(post, athlete)}
      </div>
      <div class="feed-content reel-content">
        <div>
          <p class="eyebrow">${readableDate(post.created_at)}</p>
          <h3>${escapeHtml(post.title || (founder ? "Publicacion de creador" : "Publicacion deportiva"))}</h3>
          <p>${escapeHtml(post.caption || (founder ? "Actualizacion creativa." : "Actualizacion deportiva."))}</p>
        </div>
        <div class="reel-actions">
          ${post.video_url && !post.video_url.startsWith("data:video") ? `<a class="btn" href="${post.video_url}" target="_blank" rel="noopener">Abrir video</a>` : ""}
          <button class="btn danger" type="button" data-athlete-delete-post="${escapeAttr(post.id)}">Eliminar publicacion</button>
          ${badge(post.status || "published")}
        </div>
      </div>
    </article>
  `;
}

function openAthleteProfileView(athlete) {
  const modal = document.getElementById("actionModal");
  const founder = isFounderProfile(athlete);
  modal.dataset.profileRecordId = String(athlete.id || "");
  modal.classList.add("profile-modal");
  notify(
    founder ? "Perfil de creador" : "Perfil deportivo",
    athlete.name || verticalCopy(athlete).profileDefaultName,
    "",
    `<div class="company-athlete-profile">${athleteProfileHero(athlete, athleteSponsorLogos(athlete), { readOnly: true, companyView: true })}</div>`
  );
  modal.classList.add("profile-modal");
  document.querySelectorAll("#actionModal [data-athlete-profile-tab]").forEach(button => {
    button.addEventListener("click", () => activateAthleteProfileTab(button.dataset.athleteProfileTab));
  });
}

async function deleteAthletePost(postId) {
  const post = state.data.athlete_posts.find(item => item.id === postId);
  const email = String(state.session?.email || "").toLowerCase();
  const athlete = currentAthlete() || state.data.athletes.find(item => String(item.email || "").toLowerCase() === email);
  if (!post || String(post.athlete_email || "").toLowerCase() !== email) {
    notify("Publicaciones", "No autorizado", "Solo puedes eliminar contenido publicado desde tu cuenta.");
    return;
  }
  const confirmed = window.confirm(`Â¿Eliminar "${post.title || "este reel"}"?`);
  if (!confirmed) return;
  try {
    await api.remove("athlete_posts", post.id);
    notify("Publicaciones", "Contenido eliminado", `La publicacion fue retirada de tu ${isFounderProfile(athlete) ? "perfil de creador" : "perfil deportivo"} y del feed empresarial.`);
    renderAthlete();
    renderClient();
  } catch (error) {
    notify("Publicaciones", "No fue posible eliminar", humanError(error));
  }
}

function setupReelAutoplay() {
  const videos = [...document.querySelectorAll(".tiktok-feed video")];
  if (!videos.length) return;
  videos.forEach(video => {
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
  });
  if (!("IntersectionObserver" in window)) {
    videos[0]?.play?.().catch(() => {});
    return;
  }
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const video = entry.target;
      if (entry.isIntersecting && entry.intersectionRatio > 0.62) {
        video.play?.().catch(() => {});
      } else {
        video.pause?.();
      }
    });
  }, { threshold: [0, 0.35, 0.62, 0.9] });
  videos.forEach(video => observer.observe(video));
}

function toggleReelSound(button) {
  const card = button.closest(".reel-card");
  const video = card?.querySelector("video");
  if (!video) return;
  const shouldUnmute = video.muted;
  document.querySelectorAll(".tiktok-feed video").forEach(item => {
    if (item !== video) {
      item.muted = true;
      item.setAttribute("muted", "");
      item.closest(".reel-card")?.querySelector("[data-reel-sound]")?.classList.remove("is-on");
      const otherButton = item.closest(".reel-card")?.querySelector("[data-reel-sound]");
      if (otherButton) otherButton.textContent = "Activar sonido";
    }
  });
  video.muted = !shouldUnmute;
  if (shouldUnmute) video.removeAttribute("muted");
  else video.setAttribute("muted", "");
  button.classList.toggle("is-on", shouldUnmute);
  button.textContent = shouldUnmute ? "Sonido activo" : "Activar sonido";
  video.play?.().catch(() => {});
}

function partnerCard(partner) {
  const image = partner.image_url || profileImageFallback;
  const link = partner.url ? `<a class="btn" href="${partner.url}" target="_blank" rel="noopener">Ver aliado</a>` : `<button class="btn" type="button" data-open-login>Solicitar conexi\u00f3n</button>`;
  return `
    <article class="partner-card">
      <div class="partner-mark">
        <img src="${image}" alt="${partner.name}">
      </div>
      <div class="partner-content">
        <div>
          <p class="eyebrow">${partner.tier || "Aliado ROIS"}</p>
          <h3>${partner.name}</h3>
          <p>${partner.description || "Aliado estrat\u00e9gico dentro del ecosistema ROIS."}</p>
        </div>
        <div class="row-meta">
          <span class="pill">${partner.type || "Alianza"}</span>
          ${link}
        </div>
      </div>
    </article>
  `;
}

function clientPartnerCard(partner) {
  const image = partner.image_url || fixedLogoPath;
  return publishedCard({
    item: { ...partner, image_url: image },
    kicker: partner.tier || "Patrocinador oficial",
    title: partner.name,
    text: partner.description || "Sponsor o aliado estrat\u00e9gico publicado por ROIS.",
    action: partner.url
      ? `<a class="btn" href="${partner.url}" target="_blank" rel="noopener">Ver aliado</a>`
      : button("Solicitar conexi\u00f3n", () => createRequest("Conexi\u00f3n sponsor", partner.name))
  });
}

function sponsorTierCard(tier) {
  return `
    <article class="sponsor-tier ${tier.featured ? "featured" : ""}">
      <div>
        <p class="eyebrow">${tier.featured ? "Recomendado" : "Patrocinio mensual"}</p>
        <h3>${tier.name}</h3>
        <strong>${tier.label}</strong>
        <p>${tier.description}</p>
      </div>
      <ul>
        ${tier.benefits.map(benefit => `<li>${benefit}</li>`).join("")}
      </ul>
      <button class="btn ${tier.featured ? "primary" : ""} full" type="button" id="sponsor-${tier.amount}">
        ${stripeLink(tier.productKey) ? "Pagar patrocinio" : "Solicitar link de pago"}
      </button>
    </article>
  `;
}

async function selectRoisSponsorTier(tier) {
  const details = [
    `Nivel: ${tier.name}`,
    `Monto mensual: ${tier.label}`,
    `Beneficios: ${tier.benefits.join("; ")}`
  ].join(" | ");
  const checkoutStarted = stripeLink(tier.productKey) ? openStripeCheckout(tier.productKey, tier.name) : false;
  try {
    await api.insert("requests", {
      type: "Patrocinio ROIS",
      title: tier.name,
      owner: state.session?.name || "Empresa",
      status: "review",
      details,
      priority: tier.amount >= 100000 ? "Direcci\u00f3n ROIS" : "Comercial"
    });
    await api.insert("payments", {
      concept: `${tier.name} - mensualidad`,
      amount: tier.amount,
      company: state.session?.name || "Empresa",
      status: "pending",
      product_key: tier.productKey
    });
    if (!checkoutStarted) {
      notify("Patrocinios ROIS", "Solicitud recibida", `Falta configurar el link de Stripe para ${tier.name}. ROIS preparar\u00e1 la activaci\u00f3n y el cierre comercial.`);
    }
    renderClient();
    renderAdmin();
  } catch (error) {
    notify("Patrocinios ROIS", checkoutStarted ? "Checkout iniciado" : "No fue posible registrar", checkoutStarted ? "Stripe ya fue abierto. Si el registro interno no aparece, admin puede validar el pago desde Stripe." : humanError(error));
  }
}

function athleteInvestment(athlete) {
  return Number(athlete.annual || athlete.monthly || 1000);
}

function athleteMonthlyTicket(athlete) {
  return Number(athlete.monthly || 5000);
}

function athleteSponsorLogos(athlete) {
  if (!athlete.sponsor_logos) return [];
  try {
    const logos = typeof athlete.sponsor_logos === "string" ? JSON.parse(athlete.sponsor_logos) : athlete.sponsor_logos;
    return Array.isArray(logos) ? logos.filter(logo => logo?.image).slice(0, 10) : [];
  } catch {
    return [];
  }
}

function athleteSponsorBubbleStrip(logosOrAthlete, options = {}) {
  const limit = Number(options.limit || 10);
  const logos = (Array.isArray(logosOrAthlete) ? logosOrAthlete : athleteSponsorLogos(logosOrAthlete || {})).slice(0, limit);
  const showEmpty = options.showEmpty !== false;
  const total = showEmpty ? limit : logos.length;
  const compact = options.compact ? " compact" : "";
  if (!total) return "";
  return `<div class="sponsor-bubble-strip${compact}" aria-label="Patrocinadores">
    ${Array.from({ length: total }, (_, index) => {
      const logo = logos[index];
      if (logo) {
        const name = logo.name || `Sponsor ${index + 1}`;
        return `<figure class="sponsor-bubble filled">
          <span>${safeProfileImageMarkup(logo.image, name)}</span>
          <figcaption>${escapeHtml(name)}</figcaption>
        </figure>`;
      }
      return `<figure class="sponsor-bubble empty">
        <span>+</span>
        <figcaption>${escapeHtml(options.emptyLabel || "Disponible")}</figcaption>
      </figure>`;
    }).join("")}
  </div>`;
}

function normalizedSocialUrl(value = "") {
  const url = String(value || "").trim();
  return /^https?:\/\//i.test(url) ? url : "";
}

function profileSocialLinks(profile = {}) {
  return [
    ["Instagram", normalizedSocialUrl(profile.instagram_url)],
    ["TikTok", normalizedSocialUrl(profile.tiktok_url)],
    ["Facebook", normalizedSocialUrl(profile.facebook_url)],
    ["LinkedIn", normalizedSocialUrl(profile.linkedin_url)]
  ].filter(([, url]) => url);
}

function profileSocialLinksMarkup(profile) {
  const links = profileSocialLinks(profile);
  if (!links.length) return "";
  return `
    <details class="market-social-links">
      <summary class="btn">Ver redes sociales</summary>
      <div class="market-social-menu">
        ${links.map(([label, url]) => `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`).join("")}
      </div>
    </details>
  `;
}

function athleteCard(athlete) {
  return marketProfileCard(athlete, { founder: false });
}

function fileToDataUrl(file) {
  if (!file) return Promise.resolve("");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function openRegistration(type) {
  state.registrationType = type;
  const title = type === "company"
    ? "Crear cuenta de empresa"
    : type === "founder"
      ? "Registro de creador"
      : type === "athlete"
        ? "Registro de deportista"
        : "Registro de evento";
  document.getElementById("registrationKicker").textContent = "Registro ROIS";
  document.getElementById("registrationTitle").textContent = title;
  document.getElementById("registrationForm").innerHTML = registrationFields(type);
  if (type === "athlete") setupAthleteAgeGate();
  document.getElementById("registrationModal").classList.add("active");
}

function registrationFields(type) {
  if (type === "company") {
    return `
      <label>Empresa<input name="name" required placeholder="Nombre legal o comercial"></label>
      <label>Correo de acceso<input name="email" type="email" required placeholder="contacto@empresa.com"></label>
      <label>Contacto<input name="contact" required placeholder="Nombre del responsable"></label>
      <label>Inter\u00e9s principal<select name="interest"><option>Eventos</option><option>Sponsors</option><option>Deportistas</option><option>Relaciones estrat\u00e9gicas</option></select></label>
      <label>Contrasena<input name="password" type="password" minlength="8" autocomplete="new-password" required placeholder="Minimo 8 caracteres"></label>
      <label>Confirmar contrasena<input name="confirm" type="password" minlength="8" autocomplete="new-password" required placeholder="Repite tu contrasena"></label>
      <p class="hint">La cuenta se activa como cliente ROIS. Las operaciones premium pueden requerir revisi\u00f3n interna.</p>
      <label class="check-option" style="grid-column:1/-1">
        <input name="terms" type="checkbox" required>
        <span>Acepto que ROIS opera como plataforma de gestion comercial y contractual para oportunidades, patrocinios y relaciones estrategicas. Las operaciones podran requerir contrato de patrocinio administrado por ROIS.</span>
      </label>
      <button class="btn primary full" type="submit">Crear cuenta</button>
    `;
  }
  if (type === "athlete") {
    return `
      <label>Nombre<input name="name" required placeholder="Nombre del deportista"></label>
      <label>Correo de acceso<input name="email" type="email" required placeholder="correo@deportista.com"></label>
      <label style="grid-column:1/-1">Codigo de Scout ROIS<input name="scout_code" required placeholder="ROIS-ABC123"></label>
      <div class="registration-note scout-registration-note" style="grid-column:1/-1">
        <p class="eyebrow">Acceso por invitacion</p>
        <p>Ningun deportista puede registrarse sin codigo de Scout ROIS. La anualidad deportiva es de $${athleteAnnualFeeAmount.toLocaleString("es-MX")} MXN y solo se habilita desde administracion cuando tu perfil avance.</p>
        <button class="btn" type="button" data-request-scout-code>No tienes codigo de scout? Solicita uno y te asignamos un Scout ROIS.</button>
      </div>
      <label>Fecha de nacimiento<input name="birth_date" type="date" required></label>
      <label>Contrasena<input name="password" type="password" minlength="8" autocomplete="new-password" required placeholder="Minimo 8 caracteres"></label>
      <label>Confirmar contrasena<input name="confirm" type="password" minlength="8" autocomplete="new-password" required placeholder="Repite tu contrasena"></label>
      <div class="minor-consent-panel" data-minor-consent hidden style="grid-column:1/-1">
        <p class="eyebrow">Deportista menor de edad</p>
        <p>Para atletas menores de 18 anos, ROIS requiere autorizacion expresa de madre, padre o tutor legal. El perfil podra explorarse, pero no se activaran patrocinios ni representacion comercial sin revision documental.</p>
        <div class="form-grid compact-inner">
          <label>Nombre del tutor legal<input name="guardian_name" placeholder="Nombre completo del tutor"></label>
          <label>Correo del tutor<input name="guardian_email" type="email" placeholder="correo@tutor.com"></label>
          <label>Telefono del tutor<input name="guardian_phone" placeholder="Telefono de contacto"></label>
          <label>Relacion con el deportista<select name="guardian_relationship"><option value="">Selecciona</option><option>Madre</option><option>Padre</option><option>Tutor legal</option></select></label>
        </div>
        <label class="check-option">
          <input name="guardian_consent" type="checkbox">
          <span>Declaro ser madre, padre o tutor legal del deportista menor de edad y autorizo la creacion de su cuenta ROIS, el tratamiento de sus datos deportivos y el contacto de IntelliQuant S.A.P.I. de C.V. para validar documentacion antes de cualquier patrocinio.</span>
        </label>
      </div>
      <div class="registration-note" style="grid-column:1/-1">
        <p class="eyebrow">Alta deportiva</p>
        <p>Despues de crear tu cuenta entraras a tu dashboard para completar expediente, terminos de representacion, foto, ficha tecnica, propuesta, videos y documentos operativos. El pago anual no se solicita hasta que ROIS lo habilite.</p>
      </div>
      <label class="check-option" style="grid-column:1/-1">
        <input name="terms" type="checkbox" required>
        <span>Acepto las condiciones iniciales de ROIS e ${roisLegalEntity}: el perfil deportivo queda sujeto a revision, cualquier patrocinio debe gestionarse por la plataforma y, en caso de menores de edad, se requerira validacion de madre, padre o tutor legal antes de activar representacion comercial.</span>
      </label>
      <button class="btn primary full" type="submit">Crear cuenta athlete</button>
    `;
  }
  if (type === "founder") {
    return `
      <label>Nombre legal<input name="name" required placeholder="Nombre completo"></label>
      <label>Correo<input name="email" type="email" required placeholder="correo@creador.com"></label>
      <label style="grid-column:1/-1">Codigo de Scout ROIS<input name="scout_code" required placeholder="ROIS-ABC123"></label>
      <div class="registration-note scout-registration-note" style="grid-column:1/-1">
        <p class="eyebrow">Acceso por invitacion</p>
        <p>Todo Creador necesita el codigo del Scout ROIS que lo invito. El codigo quedara vinculado al registro para seguimiento y comisiones.</p>
        <button class="btn" type="button" data-request-scout-code>No tienes codigo de Scout? Solicita uno.</button>
      </div>
      <label>Tipo de creador<select name="creator_type" required>${creatorTypeOptionsMarkup("influencer")}</select></label>
      <label>Nombre publico o artistico<input name="public_name" required placeholder="Nombre visible para marcas"></label>
      <label style="grid-column:1/-1">Proyecto, canal o marca personal<input name="venture_name" required placeholder="Nombre del proyecto creativo"></label>
      <label>Categoria o nicho<input name="industry" required placeholder="Musica, moda, gaming, lifestyle..."></label>
      <label>Etapa profesional<input name="stage" required placeholder="Emergente, consolidado, crecimiento..."></label>
      <label>Ciudad<input name="city" required placeholder="Ciudad base"></label>
      <label>Plataforma principal<select name="primary_platform" required><option value="">Selecciona</option><option>Instagram</option><option>TikTok</option><option>YouTube</option><option>Facebook</option><option>LinkedIn</option><option>Twitch</option><option>Spotify</option><option>Podcast</option><option>Eventos en vivo</option><option>Multiplataforma</option></select></label>
      <label>Audiencia total<input name="audience_size" type="number" min="0" step="1" placeholder="Seguidores o suscriptores"></label>
      <label>Engagement promedio %<input name="engagement_rate" type="number" min="0" max="100" step="0.01" placeholder="Ej. 4.8"></label>
      <label style="grid-column:1/-1">Categorias de contenido<input name="content_categories" required placeholder="Musica, entretenimiento, moda, tecnologia..."></label>
      <label>Mercado de audiencia<input name="audience_location" placeholder="Mexico, LATAM, global..."></label>
      <label>Categorias de marca compatibles<input name="brand_categories" placeholder="Consumo, moda, tecnologia..."></label>
      <label>Contrasena<input name="password" type="password" minlength="8" autocomplete="new-password" required placeholder="Minimo 8 caracteres"></label>
      <label>Confirmar contrasena<input name="confirm" type="password" minlength="8" autocomplete="new-password" required placeholder="Repite tu contrasena"></label>
      <div class="registration-note" style="grid-column:1/-1">
        <p class="eyebrow">Creator Marketplace ROIS</p>
        <p>Despues de entrar podras crear tu Sponsor Deck ROIS con IA, completar redes, audiencia, resultados, entregables para marcas y codigo de referidos.</p>
      </div>
      <label class="check-option" style="grid-column:1/-1">
        <input name="terms" type="checkbox" required>
        <span>Acepto las condiciones iniciales de ROIS e ${roisLegalEntity}: mi perfil creativo, metricas y medios quedan sujetos a revision y cualquier relacion comercial o patrocinio se gestiona dentro de la plataforma.</span>
      </label>
      <button class="btn primary full" type="submit">Crear cuenta de creador</button>
    `;
  }
  return `
    <label>Evento<input name="name" required placeholder="Nombre del evento"></label>
    <label>Categor\u00eda<input name="category" required placeholder="Ejecutivo, sponsor, membresia, networking"></label>
    <label>Sede<input name="venue" required placeholder="Sede o ciudad"></label>
    <label>Fecha<input name="date" required placeholder="Por confirmar"></label>
    <label style="grid-column:1/-1">Descripcion comercial del evento<textarea name="event_scope" required placeholder="Audiencia, alcance, sectores, tomadores de decision, medios, impacto esperado y por que una empresa deberia patrocinar este evento."></textarea></label>
    <label style="grid-column:1/-1">Paquetes o patrocinio buscado<textarea name="sponsor_levels" placeholder="Describe niveles, tickets, beneficios o tipo de sponsor buscado."></textarea></label>
    ${eventSuccessFeeSelectMarkup()}
    <div class="registration-note" style="grid-column:1/-1">
      <p class="eyebrow">Modelo de success fee ROIS</p>
        <p>La publicacion de eventos requiere una cuenta empresarial PRO o Business. Si ROIS participa en la atraccion, presentacion, desarrollo comercial, negociacion o cierre, podra aplicar un success fee del 5% al 20%.</p>
      <p class="hint">El success fee aplica unicamente sobre sponsors, patrocinios o ingresos comerciales cerrados mediante presentacion, gestion o intervencion comercial de ROIS. Las condiciones finales podran documentarse en contrato o acuerdo comercial especifico.</p>
    </div>
    <label style="grid-column:1/-1">Imagen del evento<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
    <p class="hint">Inicia sesion con una empresa PRO o Business para enviar el evento a revision. No existe un fee individual adicional; aplican los limites del plan y el success fee seleccionado.</p>
    <button class="btn primary full" type="submit">Enviar evento a revision ROIS</button>
  `;
}

function profileImageUrl(url, fallback = profileImageFallback) {
  const value = String(url || "").trim();
  if (!value) return fallback;
  if (value.startsWith("data:") && !/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(value)) {
    console.warn("[ROIS media] Base64 de imagen invalido");
    return fallback;
  }
  return value;
}

function safeProfileImageMarkup(url, name = "Perfil ROIS", fallback = profileImageFallback, className = "") {
  return `<img${className ? ` class="${escapeAttr(className)}"` : ""} data-profile-image data-fallback="${escapeAttr(fallback)}" src="${escapeAttr(profileImageUrl(url, fallback))}" alt="${escapeAttr(name)}">`;
}

function sanitizedStorageFilename(name = "archivo") {
  return String(name || "archivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "archivo";
}

function validateProfileAsset(file, kind) {
  if (!file) return;
  const imageTypes = ["image/jpeg", "image/png", "image/webp"];
  const rules = kind === "sponsor"
    ? { types: imageTypes, max: 3 * 1024 * 1024, message: "Un logo supera 3 MB." }
    : { types: imageTypes, max: 5 * 1024 * 1024, message: "La imagen supera 5 MB." };
  if (!rules.types.includes(file.type)) {
    throw new Error("Usa una imagen JPG, PNG o WEBP.");
  }
  if (file.size > rules.max) throw new Error(rules.message);
}

async function resizeProfileImage(file, maxDimension = 1600) {
  if (!file || !file.type.startsWith("image/")) return file;
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("No fue posible leer la imagen."));
      element.src = objectUrl;
    });
    const largest = Math.max(image.naturalWidth, image.naturalHeight);
    if (largest <= maxDimension) return file;
    const scale = maxDimension / largest;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    const outputType = file.type === "image/png" ? "image/png" : "image/webp";
    const blob = await new Promise(resolve => canvas.toBlob(resolve, outputType, 0.86));
    if (!blob) return file;
    const extension = outputType === "image/png" ? "png" : "webp";
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.${extension}`, { type: outputType });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function uploadProfileAsset(file, kind, context = getCurrentProfileContext()) {
  if (!file) return null;
  if (!context?.profileId || !context?.table) throw new Error("No encontramos el registro real del perfil.");
  validateProfileAsset(file, kind);
  const preparedFile = await resizeProfileImage(file);
  const folder = kind === "sponsor" ? "sponsors" : kind === "deck" ? "sponsor-deck" : "avatar";
  const filename = `${crypto.randomUUID()}-${sanitizedStorageFilename(preparedFile.name)}`;
  const path = `${context.table}/${context.profileId}/${folder}/${filename}`;
  const response = await withTimeout(fetch(`${config.supabaseUrl}/storage/v1/object/${profileMediaBucket}/${path}`, {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${state.session?.token || config.supabaseAnonKey}`,
      "Content-Type": preparedFile.type,
      "x-upsert": "true"
    },
    body: preparedFile
  }), operationTimeoutMs, "La red esta tardando demasiado al subir el archivo.");
  if (!response.ok) {
    const detail = await response.text();
    if (/row-level security|rls|unauthorized/i.test(detail)) throw new Error("Supabase bloqueo la operacion por RLS.");
    throw new Error(kind === "sponsor" ? "No fue posible subir el logo." : "No fue posible subir la foto.");
  }
  return {
    url: `${config.supabaseUrl}/storage/v1/object/public/${profileMediaBucket}/${path}`,
    path,
    name: file.name,
    mime: preparedFile.type
  };
}

async function uploadSponsorLogoPayload(fileList, namesValue = "", context = getCurrentProfileContext()) {
  const files = Array.from(fileList || []);
  if (files.length > 10) throw new Error("Puedes cargar un maximo de 10 logos.");
  if (!files.length) return "";
  const names = String(namesValue || "").split("\n").map(name => name.trim());
  const logos = [];
  for (let index = 0; index < files.length; index += 1) {
    const uploaded = await uploadProfileAsset(files[index], "sponsor", context);
    logos.push({
      name: names[index] || files[index].name.replace(/\.[^.]+$/, ""),
      image: uploaded.url,
      path: uploaded.path,
      mime: uploaded.mime,
      original_name: uploaded.name
    });
  }
  return JSON.stringify(logos);
}

async function submitRegistrationLegacy(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const type = state.registrationType;
  let paymentAction = null;
  try {
    if (type === "company") {
      if (form.password.value !== form.confirm.value) {
        notify("Registro", "Las contrase\u00f1as no coinciden", "Confirma la contrase\u00f1a para crear tu cuenta.");
        return;
      }
      const signup = await api.signupCompany({
        company: form.name.value,
        email: form.email.value,
        contact: form.contact.value,
        interest: form.interest.value,
        password: form.password.value
      });
      closeModals();
      if (signup.confirmed) {
        state.session = signup.session;
        saveSession(state.session);
        await api.insert("terms_acceptances", { user_email: form.email.value, user_role: "client", version: "company-sponsorship-v1", status: "accepted" });
        renderSession();
        renderClient();
        showView("client");
        notify("Cuenta creada", "Bienvenido a ROIS", "Tu dashboard de cliente ya est\u00e1 activo.");
      } else {
        showVerificationNotice(signup.email || form.email.value);
      }
      renderAdmin();
      renderPublic();
      return;
    } else if (type === "athlete") {
      if (form.password.value !== form.confirm.value) {
        notify("Registro", "Las contrase\u00f1as no coinciden", "Confirma la contrase\u00f1a para crear tu cuenta de deportista.");
        return;
      }
      const scoutCode = normalizeScoutCode(form.scout_code.value);
      if (!scoutCode) {
        notify("Codigo Scout", "Codigo requerido", "Para crear una cuenta emprendedora necesitas ingresar el codigo del Scout ROIS que te invito.", scoutCodeRequestActions());
        form.scout_code.focus();
        return;
      }
      const scoutValidation = await api.validateScoutCode(scoutCode);
      if (!scoutValidation.valid) {
        notify("Codigo Scout", "Codigo no valido", `El codigo ${scoutCode} no esta activo para registrar deportistas. Revisa que este escrito correctamente o solicita que ROIS te asigne un Scout.`, scoutCodeRequestActions());
        form.scout_code.focus();
        return;
      }
      const age = calculateAge(form.birth_date.value);
      if (age === null || age < 0) {
        notify("Registro", "Fecha de nacimiento invÃ¡lida", "Ingresa una fecha de nacimiento vÃ¡lida para continuar.");
        return;
      }
      const isMinor = age < 18;
      if (isMinor && (!form.guardian_name.value.trim() || !form.guardian_email.value.trim() || !form.guardian_phone.value.trim() || !form.guardian_relationship.value || !form.guardian_consent.checked)) {
        notify("Registro", "AutorizaciÃ³n de tutor requerida", "Para registrar a un deportista menor de edad necesitamos datos y consentimiento expreso de madre, padre o tutor legal.");
        return;
      }
      const signup = await api.signupAthlete({
        email: form.email.value,
        password: form.password.value,
        name: form.name.value,
        scoutCode,
        birthDate: form.birth_date.value,
        isMinor,
        guardianName: isMinor ? form.guardian_name.value.trim() : "",
        guardianEmail: isMinor ? form.guardian_email.value.trim() : "",
        guardianPhone: isMinor ? form.guardian_phone.value.trim() : "",
        guardianRelationship: isMinor ? form.guardian_relationship.value : "",
        guardianConsent: isMinor ? form.guardian_consent.checked : false,
        termsAccepted: form.terms.checked,
        sport: "Por definir",
        category: "",
        location: "",
        stats: ""
      });
      closeModals();
      if (signup.confirmed) {
        state.session = signup.session;
        saveSession(state.session);
        await api.insert("terms_acceptances", { user_email: form.email.value, user_role: isMinor ? "athlete_minor_guardian" : "athlete", version: isMinor ? "athlete-minor-guardian-consent-v1-intelliquant" : "athlete-registration-v1-intelliquant", status: "accepted" });
        renderSession();
        renderAthlete();
        showView("athlete");
        notify("Perfil deportivo", "Bienvenido a ROIS", isMinor ? "Cuenta creada con autorizaciÃ³n de tutor. ROIS revisarÃ¡ la documentaciÃ³n antes de activar patrocinios." : "Explora tu dashboard y completa tu perfil profesional. ROIS habilitara el pago anual desde admin cuando corresponda.");
      } else {
        showVerificationNotice(signup.email || form.email.value);
      }
      renderAdmin();
      renderPublic();
      return;
    } else if (type === "founder") {
      if (form.password.value !== form.confirm.value) {
        notify("Registro", "Las contrase\u00f1as no coinciden", "Confirma la contrasena para crear tu cuenta de creador.");
        return;
      }
      const scoutCode = normalizeScoutCode(form.scout_code.value);
      if (!scoutCode) {
        notify("Codigo Scout", "Codigo requerido", "Para crear una cuenta de Creador necesitas ingresar el codigo del Scout ROIS que te invito.", scoutCodeRequestActions());
        form.scout_code.focus();
        return;
      }
      const scoutValidation = await api.validateScoutCode(scoutCode);
      if (!scoutValidation.valid) {
        notify("Codigo Scout", "Codigo no valido", `El codigo ${scoutCode} no esta activo para registrar Creadores. Revisa que este escrito correctamente o solicita que ROIS te asigne un Scout.`, scoutCodeRequestActions());
        form.scout_code.focus();
        return;
      }
      const founderIndustry = form.industry.value.trim() || "Contenido y entretenimiento";
      const founderStage = form.stage.value.trim();
      const founderCity = form.city.value.trim();
      const ventureName = form.venture_name.value.trim();
      const creatorType = form.creator_type.value;
      const publicName = form.public_name.value.trim() || form.name.value.trim();
      const founderStats = `${creatorTypeLabel(creatorType)} ROIS. Proyecto: ${ventureName}. Categoria: ${founderIndustry}. Etapa: ${founderStage}. Ciudad: ${founderCity}.`;
      const signup = await api.signupFounder({
        email: form.email.value,
        password: form.password.value,
        name: form.name.value,
        profileType: "founder",
        vertical: "founder",
        scoutCode,
        ventureName,
        creatorType,
        publicName,
        industry: founderIndustry,
        stage: founderStage,
        city: founderCity,
        primaryPlatform: form.primary_platform.value,
        audienceSize: Number(form.audience_size.value || 0),
        engagementRate: Number(form.engagement_rate.value || 0),
        contentCategories: form.content_categories.value.trim(),
        audienceLocation: form.audience_location.value.trim(),
        brandCategories: form.brand_categories.value.trim(),
        termsAccepted: form.terms.checked,
        stats: founderStats
      });
      closeModals();
      if (signup.confirmed) {
        state.session = signup.session;
        saveSession(state.session);
        await api.insert("terms_acceptances", { user_email: form.email.value, user_role: "athlete", version: "founder-registration-v1-intelliquant", status: "accepted" });
        renderSession();
        renderAthlete();
        showView("athlete");
        notify("Perfil de creador", "Bienvenido a ROIS", "Tu cuenta ya puede crear su Sponsor Deck ROIS, completar audiencia, redes y resultados para marcas dentro del dashboard.");
      } else {
        showVerificationNotice(signup.email || form.email.value);
      }
      renderAdmin();
      renderPublic();
      return;
    } else {
      closeModals();
      notify("Eventos", "Cuenta empresarial requerida", "Inicia sesión con una empresa y activa PRO o Business para enviar eventos a revisión ROIS.");
      if (state.session?.role === "client") {
        showView("client");
        showDashboardPanel("client-register");
      } else {
        openLogin();
      }
      return;
    }
  } catch (error) {
    if (type === "founder" && isUserAlreadyExistsError(error)) {
      try {
        await api.recoverPassword(form.email.value);
      } catch (recoveryError) {
        // Si el correo ya existe pero recovery falla, dejamos el mensaje principal para seguir el flujo manual.
      }
      closeModals();
      notify(
        "Registro founder",
        "Correo ya existente",
        "Ese correo ya existe en ROIS Auth. Te enviamos un enlace de recuperacion para reactivar la cuenta con ese mismo correo. Despues de cambiar la contrasena, inicia sesion con ese correo y tu perfil founder podra volver a operar normalmente."
      );
      return;
    }
    notify("Registro", "No fue posible registrar", humanError(error));
  }
}



async function submitRegistration(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const type = state.registrationType;
  let paymentAction = null;
  try {
    if (type === "company") {
      if (form.password.value !== form.confirm.value) {
        notify("Registro", "Las contrase\u00f1as no coinciden", "Confirma la contrase\u00f1a para crear tu cuenta.");
        return;
      }
      const signup = await api.signupCompany({
        company: form.name.value,
        email: form.email.value,
        contact: form.contact.value,
        interest: form.interest.value,
        password: form.password.value
      });
      closeModals();
      if (signup.confirmed) {
        state.session = signup.session;
        saveSession(state.session);
        await api.insert("terms_acceptances", { user_email: form.email.value, user_role: "client", version: "company-sponsorship-v1", status: "accepted" });
        renderSession();
        renderClient();
        showView("client");
        notify("Cuenta creada", "Bienvenido a ROIS", "Tu cuenta empresarial ya puede explorar el ecosistema. Activa PRO o Business para publicar inventario corporativo y enviar eventos a revision.");
      } else {
        showVerificationNotice(signup.email || form.email.value);
      }
      renderAdmin();
      renderPublic();
      return;
    } else if (type === "athlete") {
      if (form.password.value !== form.confirm.value) {
        notify("Registro", "Las contrase\u00f1as no coinciden", "Confirma la contrase\u00f1a para crear tu cuenta de deportista.");
        return;
      }
      const scoutCode = normalizeScoutCode(form.scout_code.value);
      if (!scoutCode) {
        notify("Codigo Scout", "Codigo requerido", "Para crear una cuenta emprendedora necesitas ingresar el codigo del Scout ROIS que te invito.", scoutCodeRequestActions());
        form.scout_code.focus();
        return;
      }
      const scoutValidation = await api.validateScoutCode(scoutCode);
      if (!scoutValidation.valid) {
        notify("Codigo Scout", "Codigo no valido", `El codigo ${scoutCode} no esta activo para registrar deportistas. Revisa que este escrito correctamente o solicita que ROIS te asigne un Scout.`, scoutCodeRequestActions());
        form.scout_code.focus();
        return;
      }
      const age = calculateAge(form.birth_date.value);
      if (age === null || age < 0) {
        notify("Registro", "Fecha de nacimiento inv\u00e1lida", "Ingresa una fecha de nacimiento v\u00e1lida para continuar.");
        return;
      }
      const isMinor = age < 18;
      if (isMinor && (!form.guardian_name.value.trim() || !form.guardian_email.value.trim() || !form.guardian_phone.value.trim() || !form.guardian_relationship.value || !form.guardian_consent.checked)) {
        notify("Registro", "Autorizaci\u00f3n de tutor requerida", "Para registrar a un deportista menor de edad necesitamos datos y consentimiento expreso de madre, padre o tutor legal.");
        return;
      }
      const signup = await api.signupAthlete({
        email: form.email.value,
        password: form.password.value,
        name: form.name.value,
        scoutCode,
        birthDate: form.birth_date.value,
        isMinor,
        guardianName: isMinor ? form.guardian_name.value.trim() : "",
        guardianEmail: isMinor ? form.guardian_email.value.trim() : "",
        guardianPhone: isMinor ? form.guardian_phone.value.trim() : "",
        guardianRelationship: isMinor ? form.guardian_relationship.value : "",
        guardianConsent: isMinor ? form.guardian_consent.checked : false,
        termsAccepted: form.terms.checked,
        sport: "Por definir",
        category: "",
        location: "",
        stats: ""
      });
      closeModals();
      if (signup.confirmed) {
        state.session = signup.session;
        saveSession(state.session);
        await api.insert("terms_acceptances", { user_email: form.email.value, user_role: isMinor ? "athlete_minor_guardian" : "athlete", version: isMinor ? "athlete-minor-guardian-consent-v1-intelliquant" : "athlete-registration-v1-intelliquant", status: "accepted" });
        const membershipPayment = await registerMembershipPayment("athlete", {
          name: form.name.value,
          email: form.email.value
        });
        renderSession();
        renderAthlete();
        showView("athlete");
        if (membershipPayment) openStripeCheckout(membershipPayment.productKey, membershipPayment.title);
        notify("Perfil deportivo", "Bienvenido a ROIS", "Tu dashboard ya est\u00e1 activo. Completa el pago mensual en Stripe para activar tu membres\u00eda Athlete ROIS.");
      } else {
        showVerificationNotice(signup.email || form.email.value);
      }
      renderAdmin();
      renderPublic();
      return;
    } else if (type === "founder") {
      if (form.password.value !== form.confirm.value) {
        notify("Registro", "Las contrase\u00f1as no coinciden", "Confirma la contrasena para crear tu cuenta de creador.");
        return;
      }
      const scoutCode = normalizeScoutCode(form.scout_code.value);
      if (!scoutCode) {
        notify("Codigo Scout", "Codigo requerido", "Para crear una cuenta de Creador necesitas ingresar el codigo del Scout ROIS que te invito.", scoutCodeRequestActions());
        form.scout_code.focus();
        return;
      }
      const scoutValidation = await api.validateScoutCode(scoutCode);
      if (!scoutValidation.valid) {
        notify("Codigo Scout", "Codigo no valido", `El codigo ${scoutCode} no esta activo para registrar Creadores. Revisa que este escrito correctamente o solicita que ROIS te asigne un Scout.`, scoutCodeRequestActions());
        form.scout_code.focus();
        return;
      }
      const founderIndustry = form.industry.value.trim() || "Contenido y entretenimiento";
      const founderStage = form.stage.value.trim();
      const founderCity = form.city.value.trim();
      const ventureName = form.venture_name.value.trim();
      const creatorType = form.creator_type.value;
      const publicName = form.public_name.value.trim() || form.name.value.trim();
      const founderStats = `${creatorTypeLabel(creatorType)} ROIS. Proyecto: ${ventureName}. Categoria: ${founderIndustry}. Etapa: ${founderStage}. Ciudad: ${founderCity}.`;
      const signup = await api.signupFounder({
        email: form.email.value,
        password: form.password.value,
        name: form.name.value,
        profileType: "founder",
        vertical: "founder",
        scoutCode,
        ventureName,
        creatorType,
        publicName,
        industry: founderIndustry,
        stage: founderStage,
        city: founderCity,
        primaryPlatform: form.primary_platform.value,
        audienceSize: Number(form.audience_size.value || 0),
        engagementRate: Number(form.engagement_rate.value || 0),
        contentCategories: form.content_categories.value.trim(),
        audienceLocation: form.audience_location.value.trim(),
        brandCategories: form.brand_categories.value.trim(),
        termsAccepted: form.terms.checked,
        stats: founderStats
      });
      closeModals();
      if (signup.confirmed) {
        state.session = signup.session;
        saveSession(state.session);
        await api.insert("terms_acceptances", { user_email: form.email.value, user_role: "founder", version: "founder-registration-v1-intelliquant", status: "accepted" });
        const membershipPayment = await registerMembershipPayment("founder", {
          name: form.name.value,
          email: form.email.value
        });
        renderSession();
        renderAthlete();
        showView("athlete");
        if (membershipPayment) openStripeCheckout(membershipPayment.productKey, membershipPayment.title);
        notify("Perfil de creador", "Bienvenido a ROIS", "Tu dashboard de creador ya esta activo. Completa el pago mensual en Stripe para activar tu membresia Creador ROIS.");
      } else {
        showVerificationNotice(signup.email || form.email.value);
      }
      renderAdmin();
      renderPublic();
      return;
    } else {
      closeModals();
      notify("Eventos", "Cuenta empresarial requerida", "Inicia sesión con una empresa y activa PRO o Business para enviar eventos a revisión ROIS.");
      if (state.session?.role === "client") {
        showView("client");
        showDashboardPanel("client-register");
      } else {
        openLogin();
      }
      return;
    }
  } catch (error) {
    notify("Registro", "No fue posible registrar", humanError(error));
  }
}

