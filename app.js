const config = window.ROIS_CONFIG || {};
const roisBuild = "20260630-entrepreneur-speed-v77";
const roisLegalEntity = "IntelliQuant S.A.P.I. de C.V.";
const athleteAnnualExemptEmails = ["saidr1521@gmail.com"];
const athleteAnnualFeeAmount = 2500;
const scoutCommissionAmount = 500;
const demoMode = config.demoMode !== false || !config.supabaseUrl || !config.supabaseAnonKey;
const storeKey = "rois_demo_data_v2";
const sessionKey = "rois_session_v2";
const configuredDemoAdmin = config.demoAdminEmail && config.demoAdminPassword;
const adminEmail = (config.adminEmail || config.demoAdminEmail || "").toLowerCase();
const fixedLogoPath = config.logoDataUrl || "./assets/rois-logo.png";
const dataCacheKey = "rois_runtime_data_cache_v2";

const state = {
  session: readSession(),
  pendingSession: null,
  registrationType: null,
  data: null
};

let coverCarouselTimers = [];
const coverCacheKey = "rois_cover_cache_v1";
let adminDataHydrated = false;

const seed = {
  profiles: configuredDemoAdmin ? [
    { id: "u-admin", email: config.demoAdminEmail, password: config.demoAdminPassword, role: "admin", name: "Administrador ROIS", status: "approved", mustChangePassword: true }
  ] : [],
  companies: [],
  athletes: [],
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
  terms_acceptances: []
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

function readDataCache() {
  try {
    const cached = sessionStorage.getItem(dataCacheKey);
    return cached ? normalizeLoadedData(JSON.parse(cached)) : null;
  } catch (error) {
    return null;
  }
}

function writeDataCache(data) {
  try {
    sessionStorage.setItem(dataCacheKey, JSON.stringify(cacheSafeData(data)));
  } catch (error) {
    // Large media payloads can exceed browser storage. The app should keep working without cache.
  }
}

function cacheSafeData(data) {
  const normalized = normalizeLoadedData(data);
  return {
    ...normalized,
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
  if (role === "athlete") return "athlete";
  if (role !== "admin") return "client";
  if (!demoMode) return "admin";
  return adminEmail && email?.toLowerCase() === adminEmail ? "admin" : "client";
}

function dashboardViewForRole(role) {
  return role === "admin" ? "admin" : role === "athlete" ? "athlete" : "client";
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
  if (isCompany && state.session.role !== "athlete") {
    state.session = { ...state.session, role: "client" };
  }
}

function currentCompany() {
  if (!state.session || !state.data?.companies) return null;
  const email = state.session.email?.toLowerCase();
  return state.data.companies.find(company => (company.contact || "").toLowerCase() === email) || null;
}

function sessionLogoPath() {
  return currentCompany()?.logo_url || currentAthlete()?.image_url || "./assets/rois-isotipo-cropped.png";
}

function currentAthlete() {
  if (!state.session || !state.data?.athletes) return null;
  const email = String(state.session.email || "").toLowerCase();
  const sessionId = state.session.id;
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
  return (state.data?.athletes || []).filter(athlete => athlete.scout_active && scoutCodeForAthlete(athlete));
}

function adminAthleteRecords() {
  return (state.data?.athletes || []).filter(item => !isFounderProfile(item));
}

function adminFounderRecords() {
  return (state.data?.athletes || []).filter(item => isFounderProfile(item));
}

function scoutCanInvite(athlete) {
  if (!athlete) return false;
  if (["blocked", "deleted", "rejected"].includes(athlete.status)) return false;
  return athlete.scout_active === true || athlete.status === "approved";
}

function findScoutCandidateByCode(code) {
  const normalized = scoutCodeKey(code);
  if (!normalized) return null;
  return (state.data?.athletes || []).find(athlete => scoutCodeKey(scoutCodeForAthlete(athlete)) === normalized) || null;
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

function scoutReferralStatus(athlete) {
  const paid = athleteAnnualFeePaid(athlete);
  const profile = athleteProfileCompleteForScout(athlete);
  const validated = athlete?.scout_validation_status === "validated" || athlete?.scout_commission_status === "approved";
  const eligible = Boolean(athlete?.invited_by_scout_code && paid && profile && validated && !["blocked", "deleted", "rejected"].includes(athlete.status));
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
  const cachedData = readDataCache();
  const shouldRefreshInBackground = Boolean(cachedData);
  state.data = cachedData || await loadInitialData();
  state.dataSignature = runtimeDataSignature(state.data);
  if (state.session && sessionIsBlocked()) {
    state.session = null;
    clearSession();
  }
  const recoverySession = await recoverySessionFromUrl();
  if (recoverySession) {
    state.pendingSession = recoverySession;
    state.session = null;
    clearSession();
  }
  enforceCompanyClientSession();
  if (state.session) saveSession(state.session);
  document.body.dataset.activeView = state.session ? dashboardViewForRole(state.session.role) : "home";
  applyBranding();
  handleMissingImages();
  bindGlobalEvents();
  renderPublic();
  renderSession();
  optimizeRenderedMedia();
  if (state.pendingSession) {
    showView("home");
    document.getElementById("passwordModal").classList.add("active");
    return;
  }
  if (state.session) showView(dashboardViewForRole(state.session.role));
  if (shouldRefreshInBackground) refreshDataInBackground();
}

async function loadInitialData() {
  try {
    return await api.loadAll();
  } catch (error) {
    return state.data || readDataCache() || normalizeLoadedData({});
  }
}

async function refreshDataInBackground() {
  try {
    const nextData = normalizeLoadedData(await api.loadAll({ background: true }));
    const nextSignature = runtimeDataSignature(nextData);
    if (nextSignature !== state.dataSignature) {
      state.data = nextData;
      state.dataSignature = nextSignature;
      writeDataCache(state.data);
      renderPublic();
      renderSession();
      optimizeRenderedMedia();
    }
  } catch (error) {
    // Cached data is enough to keep the interface usable while the network recovers.
  }
}

function sessionIsBlocked() {
  const email = String(state.session?.email || "").toLowerCase();
  const profile = state.data?.profiles?.find(item => String(item.email || "").toLowerCase() === email || item.id === state.session?.id);
  const company = state.data?.companies?.find(item => String(item.contact || "").toLowerCase() === email);
  const athlete = state.data?.athletes?.find(item => String(item.email || "").toLowerCase() === email);
  if (!profile && (company || athlete)) return true;
  return [profile, company, athlete].some(item => ["blocked", "deleted", "rejected"].includes(item?.status));
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
    image.src = logo;
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
      data.companies.unshift({ id: crypto.randomUUID(), name: company, contact: email, owner: contact, interest, status: "approved" });
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
        birth_date: payload.birthDate,
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
    const response = await fetch(`${config.supabaseUrl}${path}`, options);
    if (!response.ok) throw new Error(await response.text());
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  return {
    async loadAll(options = {}) {
      const lightweight = options.lightweight !== false;
      const adminMode = options.admin === true || state.session?.role === "admin";
      const mainLimit = adminMode ? 1000 : 180;
      const mediumLimit = adminMode ? 500 : 120;
      const smallLimit = adminMode ? 300 : 80;
      const tableQueries = {
        profiles: `select=*&order=created_at.desc&limit=${mainLimit}`,
        companies: `select=*&order=created_at.desc&limit=${mainLimit}`,
        athletes: `select=*&order=created_at.desc&limit=${mainLimit}`,
        events: `select=*&order=created_at.desc&limit=${mediumLimit}`,
        requests: `select=*&order=created_at.desc&limit=${mediumLimit}`,
        sponsorships: `select=*&order=created_at.desc&limit=${mediumLimit}`,
        news: `select=*&order=created_at.desc&limit=${smallLimit}`,
        partnerships: `select=*&order=created_at.desc&limit=${smallLimit}`,
        site_settings: lightweight ? `select=id,value,created_at,updated_at&limit=${Math.min(smallLimit, 80)}` : `select=*&limit=${smallLimit}`,
        crm: `select=*&order=created_at.desc&limit=${mediumLimit}`,
        payments: `select=*&order=created_at.desc&limit=${mediumLimit}`,
        uploads: lightweight ? `select=id,type,status,title,name,created_at,updated_at&order=created_at.desc&limit=${Math.min(smallLimit, 80)}` : `select=*&order=created_at.desc&limit=${mediumLimit}`,
        athlete_posts: `select=*&order=created_at.desc&limit=${mediumLimit}`,
        athlete_results: `select=*&order=created_at.desc&limit=${mediumLimit}`,
        athlete_expenses: `select=*&order=created_at.desc&limit=${mediumLimit}`,
        athlete_deposits: `select=*&order=created_at.desc&limit=${mediumLimit}`,
        athlete_notifications: `select=*&order=created_at.desc&limit=${mediumLimit}`,
        terms_acceptances: `select=*&order=created_at.desc&limit=${mediumLimit}`
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
      const preferredAthlete = athleteAnnualFeeExempt(email);
      const auth = await request("/auth/v1/token?grant_type=password", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ email, password })
      });
      const companies = await request(`/rest/v1/companies?select=*&contact=eq.${encodeURIComponent(email)}&limit=1`, {
        headers: headers(auth.access_token)
      });
      let athletes = await request(`/rest/v1/athletes?select=*&email=eq.${encodeURIComponent(email)}&limit=1`, {
        headers: headers(auth.access_token)
      });
      const profiles = await request(`/rest/v1/profiles?select=*&id=eq.${auth.user.id}&limit=1`, {
        headers: headers(auth.access_token)
      });
      if (!profiles.length && (companies.length || athletes.length) && !preferredAthlete) {
        throw new Error("Esta cuenta fue dada de baja o requiere reactivaci\u00f3n por ROIS.");
      }
      const profile = preferredAthlete ? await this.ensureAthleteAccount(auth, { forceRole: true }) : profiles[0] || (auth.user.user_metadata?.role === "athlete" ? await this.ensureAthleteAccount(auth) : await this.ensureClientAccount(auth));
      if (profile.role === "athlete" && !athletes.length) {
        try {
          await this.ensureAthleteAccount(auth, { forceRole: true });
          athletes = await request(`/rest/v1/athletes?select=*&email=eq.${encodeURIComponent(email)}&limit=1`, {
            headers: headers(auth.access_token)
          });
        } catch (error) {
          athletes = [];
        }
      }
      if (["blocked", "deleted", "rejected"].includes(profile.status)) throw new Error("Esta cuenta fue dada de baja por ROIS.");
      if (profile.status !== "approved") throw new Error("Este usuario a\u00fan no est\u00e1 aprobado.");
      if (!preferredAthlete && companies.some(company => ["blocked", "deleted", "rejected"].includes(company.status))) throw new Error("Esta empresa fue dada de baja por ROIS.");
      if (athletes.some(athlete => ["blocked", "deleted", "rejected"].includes(athlete.status))) throw new Error("Esta cuenta emprendedora fue dada de baja por ROIS.");
      const role = preferredAthlete ? "athlete" : profile.role === "athlete" ? "athlete" : companies.length ? "client" : normalizedRole(email, profile.role);
      return { id: profile.id, email, role, name: profile.name, token: auth.access_token, mustChangePassword: !!profile.must_change_password };
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
      state.data = await this.loadAll();
      return {
        confirmed: true,
        session: { id: profile.id, email, role: "client", name: profile.name, token: accessToken, mustChangePassword: false }
      };
    },
    async signupAthlete(payload) {
      const auth = await request("/auth/v1/signup", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          email: payload.email,
          password: payload.password,
          data: {
            name: payload.name,
            role: "athlete"
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
            birth_date: payload.birthDate,
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
        return { confirmed: false, email: payload.email };
      }
      const profileRecord = {
        id: authUser.id,
        email: payload.email,
        role: "athlete",
        name: payload.name,
        status: "approved",
        must_change_password: false
      };
      await request("/rest/v1/profiles?on_conflict=id", {
        method: "POST",
        headers: { ...headers(accessToken), Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(profileRecord)
      });
      await request("/rest/v1/athletes", {
        method: "POST",
        headers: { ...headers(accessToken), Prefer: "return=minimal" },
        body: JSON.stringify({
          profile_id: authUser.id,
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
          birth_date: payload.birthDate,
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
      state.data = await this.loadAll();
      return {
        confirmed: true,
        session: { id: authUser.id, email: payload.email, role: "athlete", name: payload.name, token: accessToken, mustChangePassword: false }
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
      let profiles = [];
      try {
        profiles = await request(`/rest/v1/profiles?select=*&id=eq.${user.id}&limit=1`, {
          headers: headers(accessToken)
        });
      } catch (error) {
        profiles = [];
      }
      let profile = profiles[0] || null;
      if (!profile) {
        try {
          profile = user.user_metadata?.role === "athlete"
            ? await this.ensureAthleteAccount({ user, access_token: accessToken })
            : await this.ensureClientAccount({ user, access_token: accessToken });
        } catch (error) {
          profile = {
            id: user.id,
            email: user.email,
            role: user.user_metadata?.role === "athlete" ? "athlete" : "client",
            name: user.user_metadata?.name || user.email?.split("@")[0] || "Perfil ROIS",
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
      const role = profile.role === "athlete" ? "athlete" : companies.length ? "client" : normalizedRole(user.email, profile.role);
      return { id: profile.id || user.id, email: user.email, role, name: profile.name || user.user_metadata?.name || user.email?.split("@")[0] || "Perfil ROIS", token: accessToken, mustChangePassword: true };
    },
    async ensureClientAccount(auth, fallback = {}) {
      const token = auth.access_token || auth.session?.access_token;
      const email = auth.user.email;
      const meta = auth.user.user_metadata || {};
      const company = fallback.company || meta.company_name || meta.name || email.split("@")[0];
      const contact = fallback.contact || meta.contact_name || company;
      const interest = fallback.interest || meta.interest || "Relaciones estrat\u00e9gicas";
      const profileRecord = {
        id: auth.user.id,
        email,
        role: "client",
        name: company,
        status: "approved",
        must_change_password: false
      };
      await request("/rest/v1/profiles?on_conflict=id", {
        method: "POST",
        headers: { ...headers(token), Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(profileRecord)
      });
      const existingCompanies = await request(`/rest/v1/companies?select=id&contact=eq.${encodeURIComponent(email)}&limit=1`, {
        headers: headers(token)
      });
      if (!existingCompanies.length) {
        await request("/rest/v1/companies", {
          method: "POST",
          headers: { ...headers(token), Prefer: "return=minimal" },
          body: JSON.stringify({ name: company, contact: email, owner: contact, interest, status: "approved" })
        });
        await request("/rest/v1/crm", {
          method: "POST",
          headers: { ...headers(token), Prefer: "return=minimal" },
          body: JSON.stringify({ name: company, volume: 0, status: "Nuevo cliente" })
        });
      }
      return profileRecord;
    },
    async ensureAthleteAccount(auth, options = {}) {
      const token = auth.access_token || auth.session?.access_token;
      const email = auth.user.email;
      const meta = auth.user.user_metadata || {};
      const name = meta.name || email.split("@")[0];
      const profileRecord = {
        id: auth.user.id,
        email,
        role: "athlete",
        name,
        status: "approved",
        must_change_password: false
      };
      await request("/rest/v1/profiles?on_conflict=id", {
        method: "POST",
        headers: { ...headers(token), Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(profileRecord)
      });
      if (options.forceRole) {
        try {
          await request(`/rest/v1/profiles?id=eq.${auth.user.id}`, {
            method: "PATCH",
            headers: { ...headers(token), Prefer: "return=minimal" },
            body: JSON.stringify({ role: "athlete", status: "approved" })
          });
        } catch (error) {
          // If RLS blocks the self-update, the manual admin SQL below will own the role correction.
        }
      }
      const existingAthletes = await request(`/rest/v1/athletes?select=id&email=eq.${encodeURIComponent(email)}&limit=1`, {
        headers: headers(token)
      });
      if (options.forceRole && existingAthletes.length) {
        try {
          await request(`/rest/v1/athletes?id=eq.${existingAthletes[0].id}`, {
            method: "PATCH",
            headers: { ...headers(token), Prefer: "return=minimal" },
            body: JSON.stringify({ profile_id: auth.user.id, status: "approved", visual_status: "approved", annual: 0 })
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
            profile_id: auth.user.id,
            email,
            name,
            sport: meta.sport || "Por definir",
            category: meta.category || "",
            location: meta.location || "",
            ranking: meta.ranking || "",
            annual: athleteAnnualFeeAmount,
            annual_fee_required: false,
            monthly: 5000,
            max_sponsors: 10,
            scout_code: makeScoutCode(name, email),
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
      return profileRecord;
    },
    async insert(table, record) {
      const rows = await request(`/rest/v1/${table}`, {
        method: "POST",
        headers: { ...headers(), Prefer: "return=minimal" },
        body: JSON.stringify(record)
      });
      state.data = await this.loadAll();
      return Array.isArray(rows) ? rows[0] : rows;
    },
    async update(table, id, patch) {
      const rows = await request(`/rest/v1/${table}?id=eq.${id}`, {
        method: "PATCH",
        headers: { ...headers(), Prefer: "return=representation" },
        body: JSON.stringify(patch)
      });
      state.data = await this.loadAll();
      return rows[0];
    },
    async remove(table, id) {
      await request(`/rest/v1/${table}?id=eq.${id}`, {
        method: "DELETE",
        headers: { ...headers(), Prefer: "return=minimal" }
      });
      state.data = await this.loadAll();
      return true;
    },
    async upsert(table, record) {
      const rows = await request(`/rest/v1/${table}?on_conflict=id`, {
        method: "POST",
        headers: { ...headers(), Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(record)
      });
      state.data = await this.loadAll();
      return rows[0];
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
      state.data = await this.loadAll();
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
  const logoutButton = event.target.closest("[data-logout]");
  if (logoutButton) {
    logout();
    return;
  }
  const sponsorButton = event.target.closest("[data-athlete-sponsor]");
  if (sponsorButton) {
    const athlete = state.data?.athletes?.find(item => item.id === sponsorButton.dataset.athleteSponsor);
    if (athlete) startAthleteSponsorPayment(athlete);
    return;
  }
  const profileButton = event.target.closest("[data-athlete-profile]");
  if (profileButton) {
    const athlete = state.data?.athletes?.find(item => item.id === profileButton.dataset.athleteProfile);
    if (athlete) openAthleteProfileView(athlete);
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
  const requestScoutButton = event.target.closest("[data-request-scout-code]");
  if (requestScoutButton) {
    requestScoutCode();
    return;
  }
}

function showView(name) {
  document.body.dataset.activeView = name;
  document.querySelectorAll("[data-view]").forEach(view => view.classList.toggle("active", view.dataset.view === name));
  if (name === "client") renderClient();
  if (name === "athlete") renderAthlete();
  if (name === "admin") {
    renderAdmin();
    if (!adminDataHydrated) {
      adminDataHydrated = true;
      api.loadAll({ lightweight: false, admin: true }).then(data => {
        state.data = normalizeLoadedData(data);
        writeDataCache(state.data);
        renderAdmin();
      }).catch(() => {
        // Keep the current admin view responsive even if the background refresh fails.
      });
    }
  }
  optimizeRenderedMedia();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showDashboardPanel(targetId) {
  const targetPanel = document.querySelector(`[data-dashboard-panel="${targetId}"]`);
  if (!targetPanel) return;
  const workspace = targetPanel.closest("[data-dashboard]");
  const nav = document.querySelector(`[data-dashboard-nav="${workspace.dataset.dashboard}"]`);
  if (workspace.dataset.dashboard === "admin") renderAdminPanel(targetId);
  workspace.querySelectorAll("[data-dashboard-panel]").forEach(panel => panel.classList.toggle("active", panel === targetPanel));
  nav.querySelectorAll("[data-dashboard-target]").forEach(button => button.classList.toggle("active", button.dataset.dashboardTarget === targetId));
  optimizeRenderedMedia(targetPanel);
  closeMobileDashboardMenus();
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
    const session = await api.login(form.email.value, form.password.value);
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
    saveSession(state.session);
    closeModals();
    renderSession();
    showView(dashboardViewForRole(state.session.role));
  } catch (error) {
    if (String(error.message).toLowerCase().includes("email not confirmed")) {
      showVerificationNotice(form.email.value);
      return;
    }
    notify("Acceso", "No fue posible iniciar sesi\u00f3n", error.message);
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
  state.session = null;
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
  });
}

function closeModalFromButton(event) {
  const modal = event.currentTarget.closest(".modal");
  const registrationModal = document.getElementById("registrationModal");
  if (modal?.id === "actionModal" && registrationModal?.classList.contains("active")) {
    modal.classList.remove("active");
    modal.classList.remove("profile-modal");
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
    : "Selecciona el tipo de cuenta que quieres crear dentro del ecosistema ROIS.";
  notify(
    "Acceso ROIS",
    "Crea tu cuenta para continuar",
    copy,
    `<div class="modal-actions">
      <button class="btn primary" type="button" data-registration="company">Crear cuenta empresarial</button>
      <button class="btn" type="button" data-registration="athlete">Registro deportista</button>
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
  if (type === "company") {
    return {
      productKey: "companyMonthlyMembership",
      title: "Membresia mensual Empresa ROIS",
      concept: "Membresia mensual Empresa ROIS",
      amount: 5000,
      payer: payload.company || payload.name || payload.email || "Empresa ROIS"
    };
  }

  if (type === "founder") {
    return {
      productKey: "founderMonthlyMembership",
      title: "Membresia mensual Founder ROIS",
      concept: "Membresia mensual Founder ROIS",
      amount: 2500,
      payer: payload.name || payload.email || "Founder ROIS"
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

function humanError(error) {
  const message = typeof error?.message === "string" ? error.message : JSON.stringify(error);
  if (message.includes("over_email_send_rate_limit") || message.includes("email rate limit exceeded") || message.includes("429")) {
    return "Supabase limit\u00f3 temporalmente el env\u00edo de correos de verificaci\u00f3n por demasiados intentos. Para el lanzamiento, desactiva la confirmaci\u00f3n por correo en Supabase o espera unos minutos antes de intentar de nuevo.";
  }
  if (message.includes("row-level security") || message.includes("42501")) {
    return "La base de datos todav\u00eda est\u00e1 bloqueando este registro. Actualiza las pol\u00edticas de Supabase y vuelve a intentarlo.";
  }
  return message || "Ocurri\u00f3 un error inesperado.";
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
      <button class="btn primary nav-create-account" type="button" data-registration="company">Crear cuenta</button>
      <button class="btn subtle" type="button" data-open-login>Acceso</button>
    `;
    area.querySelector("[data-registration]").addEventListener("click", () => openRegistration("company"));
    area.querySelector("[data-open-login]").addEventListener("click", openLogin);
    return;
  }
  area.innerHTML = `
    <span class="pill">${state.session.role === "admin" ? "Admin" : state.session.name}</span>
    <button class="btn subtle" type="button" data-panel-link>${state.session.role === "admin" ? "Panel admin" : state.session.role === "athlete" ? "Panel deportista" : "Panel cliente"}</button>
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
      ${publicNews.map(news => publishedCard({
        item: news,
        kicker: "Nota ROIS",
        title: news.title,
        text: news.summary,
        action: `<div class="social-actions public-social"><button class="btn" type="button" data-open-login>Me gusta</button><button class="btn" type="button" data-open-login>Comentar</button><button class="btn" type="button" data-open-login>Compartir</button></div>`
      })).join("")}
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
  renderClientOverview();
  renderClientEvents();
  renderClientFeed();
  renderClientNews();
  renderClientSponsors();
  renderClientMarketplace();
  renderClientRegister();
  renderClientPayments();
  renderAccountSettings("client-settings");
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
    return `<img src="${company.logo_url}" alt="${escapeAttr(company.name || "Empresa")}">`;
  }
  return `
    <button class="company-logo-upload-prompt" type="button" data-dashboard-shortcut="client-settings" aria-label="Subir logo de empresa">
      <span>+</span>
      <small>Subir logo</small>
    </button>
  `;
}

function renderClientOverview() {
  const coverSlot = document.getElementById("clientDashboardCover");
  if (coverSlot) {
    coverSlot.innerHTML = "";
    coverSlot.hidden = true;
    coverSlot.setAttribute("aria-hidden", "true");
  }
  document.querySelector(`[data-dashboard-panel="client-overview"]`).innerHTML = clientAdvertisingOverviewMarkup();
  setupReelAutoplay();
}

function clientAdvertisingOverviewMarkup() {
  const company = currentCompany();
  const posts = state.data.athlete_posts
    .filter(post => post.status === "approved")
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const news = state.data.news
    .filter(item => item.status === "published" && visualIsPublic(item))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const athletes = state.data.athletes.filter(item => item.status === "approved" && visualIsPublic(item));
  const events = state.data.events.filter(item => item.status === "approved" && visualIsPublic(item));
  const companyName = company?.name || state.session?.name || "Empresa ROIS";
  const interest = company?.interest || "Oportunidades premium";
  const description = company?.description || "Cuenta empresarial habilitada para revisar Centro VIP, talento deportivo, eventos privados y productos administrados por ROIS.";

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
            <button class="btn primary" type="button" data-dashboard-shortcut="client-sponsors">Explorar Centro VIP</button>
            <button class="btn" type="button" data-dashboard-shortcut="client-marketplace">Ver deportistas</button>
            <button class="btn" type="button" data-dashboard-shortcut="client-settings">Editar perfil</button>
          </div>
        </div>
      </section>

      <div class="client-priority-grid">
        <section class="client-priority-card client-reels-priority">
          <div class="section-minihead">
            <p class="eyebrow">Feed de oportunidades</p>
            <h3>Publicaciones de perfiles listos para patrocinio.</h3>
            <p>Contenido publicado por atletas para que las empresas evaluen talento, narrativa y oportunidad comercial.</p>
          </div>
          ${posts.length ? `
            <div class="reels-feed tiktok-feed compact-reels" aria-label="Reels deportivos ROIS">
              ${posts.slice(0, 5).map(post => athleteFeedCard(post)).join("")}
            </div>
          ` : `<div class="empty slim">Los reels publicados por deportistas apareceran aqui.</div>`}
        </section>

        <section class="client-priority-card">
          <div class="section-minihead">
            <p class="eyebrow">Noticias ROIS</p>
            <h3>Actualizaciones publicadas por administracion.</h3>
            <p>Mensajes, aperturas de inventario, alianzas y oportunidades que requieren atencion empresarial.</p>
          </div>
          ${news.length ? `<div class="client-news-stack">${news.slice(0, 4).map(clientNewsPreviewCard).join("")}</div>` : `<div class="empty slim">Las noticias publicadas por admin apareceran aqui.</div>`}
        </section>
      </div>

      <section class="company-operations-card">
        <div class="section-minihead">
          <p class="eyebrow">Centro de operaciones</p>
          <h3>Accesos principales para activar oportunidades.</h3>
        </div>
        <div class="company-action-grid">
          ${clientOperationCard("Centro VIP", "Productos con imagen derivados de alianzas estrategicas.", "client-sponsors", "Ver productos")}
          ${clientOperationCard("Marketplace", `${athletes.length} perfiles deportivos para evaluar.`, "client-marketplace", "Revisar")}
          ${clientOperationCard("Eventos", `${events.length} oportunidades privadas publicadas por ROIS.`, "client-events", "Calendario")}
          ${clientOperationCard("Pagos", "Stripe, solicitudes y compromisos activos.", "client-payments", "Ver pagos")}
        </div>
      </section>
    </div>
  `;
}

function clientNewsPreviewCard(news) {
  return `
    <article class="client-news-preview">
      ${news.image_url ? `<img src="${news.image_url}" alt="${escapeAttr(news.title)}">` : ""}
      <div>
        <p class="eyebrow">Nota ROIS</p>
        <h4>${escapeHtml(news.title)}</h4>
        <p>${escapeHtml(news.summary || "Actualizacion disponible para empresas registradas.")}</p>
        ${newsInteractionBar(news)}
      </div>
    </article>
  `;
}

function clientExperienceOverviewMarkup() {
  const company = currentCompany();
  const cover = featuredAdvertisingCover();
  const posts = state.data.athlete_posts
    .filter(post => post.status === "approved")
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const alliances = premiumAllianceCatalog();
  const events = state.data.events.filter(item => item.status === "approved" && visualIsPublic(item));
  const athletes = state.data.athletes.filter(item => item.status === "approved" && visualIsPublic(item));
  const news = state.data.news.filter(item => item.status === "published" && visualIsPublic(item));
  const companyName = company?.name || state.session?.name || "Empresa ROIS";
  const interest = company?.interest || "Patrocinios, eventos y talento deportivo";
  const description = company?.description || "Cuenta empresarial habilitada para revisar oportunidades, solicitar patrocinios, acceder a eventos privados y operar alianzas premium dentro del ecosistema ROIS.";

  return `
    <div class="company-profile-layout">
      <section class="company-profile-card executive-company-card">
          <div class="company-cover">
            ${cover?.image_url ? `<img src="${cover.image_url}" alt="Portada ROIS">` : `<div class="company-cover-fallback"><span>ROIS</span><small>Strategic partnerships · athletes · investment</small></div>`}
          </div>
          <button class="btn company-cover-logout" type="button" data-logout>Cerrar sesión</button>
          <div class="company-profile-body">
            <div class="company-profile-logo">${clientCompanyLogoMarkup(company)}</div>
            <div class="company-profile-copy">
              <p class="eyebrow">Centro privado de oportunidades</p>
              <h2>${escapeHtml(companyName)}</h2>
              <p><strong>${escapeHtml(interest)}</strong></p>
              <p>${escapeHtml(description)}</p>
              <div class="company-profile-actions">
                <button class="btn primary" type="button" data-dashboard-shortcut="client-alliances">Explorar alianzas premium</button>
                <button class="btn" type="button" data-dashboard-shortcut="client-marketplace">Ver deportistas</button>
                <button class="btn" type="button" data-dashboard-shortcut="client-settings">Editar perfil</button>
              </div>
            </div>
          </div>
          <div class="company-signal-strip">
            <div><span>${alliances.length}</span><small>Alianzas activas</small></div>
            <div><span>${events.length}</span><small>Eventos privados</small></div>
            <div><span>${athletes.length}</span><small>Deportistas</small></div>
            <div><span>${news.length}</span><small>Noticias ROIS</small></div>
          </div>
      </section>

      <div class="company-profile-main">
        <section class="premium-command-panel">
          <div class="section-minihead">
            <p class="eyebrow">Mesa de oportunidades</p>
            <h3>Productos privados listos para evaluación empresarial.</h3>
            <p>ROIS concentra alianzas, inventario deportivo y eventos premium para que tu empresa pueda solicitar disponibilidad, recibir seguimiento y cerrar operaciones desde un solo lugar.</p>
          </div>
          <div class="premium-alliance-grid command">
            ${alliances.slice(0, 2).map(alliance => allianceCard(alliance, true)).join("")}
          </div>
        </section>

        <section class="client-decision-board">
          <div class="section-minihead">
            <p class="eyebrow">Ruta de decisión</p>
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
              <h4>Evalua talento deportivo</h4>
              <p>Consulta perfiles, reels, resultados y tickets mensuales antes de solicitar patrocinio.</p>
              <button class="btn" type="button" data-dashboard-shortcut="client-marketplace">Ver deportistas</button>
            </article>
            <article>
              <span>03</span>
              <h4>Solicita y activa</h4>
              <p>ROIS valida disponibilidad, contratos, pagos y seguimiento operativo con el aliado o deportista.</p>
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
            ${clientOperationCard("Talento deportivo", `${athletes.length} perfiles listos para evaluacion.`, "client-marketplace", "Revisar")}
            ${clientOperationCard("Eventos privados", `${events.length} oportunidades publicadas por ROIS.`, "client-events", "Calendario")}
            ${clientOperationCard("Pagos y cierre", "Consulta pagos, solicitudes y proximos pasos de operacion.", "client-payments", "Ver pagos")}
          </div>
        </section>
      </div>

      <aside class="company-profile-aside">
        <div class="client-next-steps">
          <p class="eyebrow">Siguiente mejor accion</p>
          <h3>Revisa las alianzas premium y solicita disponibilidad.</h3>
          <p>Para empresas nuevas, el camino mas eficiente es elegir un producto de F1, Los 300 o un deportista y abrir una solicitud. ROIS hace el seguimiento comercial.</p>
          <div>
            <button class="btn primary" type="button" data-dashboard-shortcut="client-alliances">Ver productos</button>
            <button class="btn" type="button" data-dashboard-shortcut="client-feed">Ver feed</button>
          </div>
        </div>
        <div class="company-reels-widget">
          <div class="section-minihead">
            <p class="eyebrow">Señales del ecosistema</p>
            <h3>Reels de atletas listos para patrocinio.</h3>
          </div>
          ${posts.length ? `
            <div class="reels-feed tiktok-feed compact-reels" aria-label="Reels deportivos ROIS">
              ${posts.slice(0, 6).map(post => athleteFeedCard(post)).join("")}
            </div>
          ` : `<div class="empty slim">Los reels publicados por deportistas apareceran aqui.</div>`}
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
  panel("client-feed", "Feed de oportunidades", "Publicaciones de perfiles listos para patrocinio", posts.length ? `
    <div class="panel-body reels-panel-body">
      <div class="reels-feed tiktok-feed" aria-label="Reels deportivos ROIS">
        ${posts.map(post => athleteFeedCard(post)).join("")}
      </div>
    </div>
  ` : `<div class="empty">Los reels publicados por deportistas apareceran aqui.</div>`);
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
  const events = state.data.events.filter(item => item.status === "approved" && visualIsPublic(item)).length;
  const athletes = state.data.athletes.filter(item => item.status === "approved" && visualIsPublic(item)).length;
  const news = state.data.news.filter(item => item.status === "published" && visualIsPublic(item)).length;
  document.getElementById("clientKpis").innerHTML = [
    ["Eventos", events],
    ["Deportistas", athletes],
    ["Noticias", news],
    ["Pagos", state.data.payments.filter(item => item.status !== "paid").length]
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
        ${news.map(item => publishedCard({
          item,
          kicker: "Publicaci\u00f3n ROIS",
          title: item.title,
          text: item.summary,
          action: newsInteractionBar(item)
        })).join("")}
      </div>
    </div>
  ` : `<div class="empty">Las noticias publicadas por admin aparecer\u00e1n aqu\u00ed.</div>`);
}

function renderClientSponsors() {
  const products = vipProducts();
  panel("client-sponsors", "Centro VIP", "Productos privados publicados por administracion", `
    <div class="panel-body">
      ${products.length ? `
        <div class="vip-product-grid">
          ${products.map(vipProductCard).join("")}
        </div>
      ` : `<div class="empty">Los productos del Centro VIP apareceran aqui cuando administracion los publique.</div>`}
    </div>
  `);
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
  const athletes = state.data.athletes.filter(item => item.status === "approved" && visualIsPublic(item));
  panel("client-marketplace", "Marketplace Deportistas", "Perfiles aprobados para sponsor", athletes.length ? `
    <div class="panel-body">
      <div class="athlete-showcase compact">
        ${athletes.map(athlete => athleteCard(athlete, athleteSponsorCta(athlete))).join("")}
      </div>
    </div>
  ` : `<div class="empty">A\u00fan no hay deportistas aprobados para patrocinio.</div>`);
}

function renderClientRegister() {
  panel("client-register", "Registrar Evento", "Env\u00edo a revisi\u00f3n", `
    <div class="panel-body">
      <form id="eventForm" class="form-grid">
        <label>Nombre<input name="name" required placeholder="T\u00edtulo del evento"></label>
        <label>Sede<input name="venue" required placeholder="Sede o ciudad"></label>
        <label>Categor\u00eda<input name="category" required placeholder="Ejecutivo, patrocinio, membres\u00eda"></label>
        <label>Fecha<input name="date" required placeholder="Por confirmar"></label>
        <button class="btn primary" type="submit">Registrar y pagar evento</button>
      </form>
    </div>
  `);
  document.getElementById("eventForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    await api.insert("events", { name: form.name.value, venue: form.venue.value, category: form.category.value, date: form.date.value, status: "pending" });
    openStripeCheckout("eventRegistration", "Registro de Evento ROIS");
    notify("Eventos", "Evento registrado", "El evento fue enviado a revisi\u00f3n del administrador.");
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
  panel("client-payments", "Pagos", "Stripe y compromisos activos", rows.length ? table(["Concepto", "Monto", "Estado", "Acci\u00f3n"], rows) : `
    <div class="panel-body">
      <div class="empty">No hay pagos registrados todav\u00eda. Las solicitudes de patrocinio generar\u00e1n pagos pendientes para Stripe.</div>
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
              ${company.logo_url ? `<img src="${company.logo_url}" alt="${company.name || "Empresa"}">` : `<div class="company-logo-empty">Logo</div>`}
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
  renderAthleteNotifications();
  renderAthleteProfile();
  renderAthleteSponsorships();
  renderAthleteScouts();
  renderAthleteResults();
  renderAccountSettings("athlete-settings");
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
  const image = post.image_url || athlete?.image_url || "./assets/rois-isotipo-cropped.png";
  if (post.video_url?.startsWith("data:video")) {
    return `<video src="${post.video_url}" muted loop playsinline preload="metadata" poster="${escapeAttr(image)}"></video>`;
  }
  return `<img src="${image}" alt="${escapeAttr(post.title || "Reel deportivo")}">`;
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
        <p>${escapeHtml(post.caption || (founder ? "Actualizacion emprendedora ROIS." : "Actualizacion deportiva ROIS."))}</p>
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
    { key: "proposal", label: "Propuesta comercial PDF para sponsors", done: Boolean(athlete?.proposal_url) },
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

const profileVerticalOverrides = {
  "saidr1521@gmail.com": "athlete",
  "saidr1521@outlook.es": "founder"
};

function profileVertical(profile) {
  const email = String(profile?.email || profile?.contact || state.session?.email || "").toLowerCase();
  if (profileVerticalOverrides[email]) return profileVerticalOverrides[email];
  if (!profile) return "athlete";
  const directType = String(profile.profile_type || profile.vertical || "").trim().toLowerCase();
  if (directType === "founder") return "founder";
  const normalize = value => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const profileText = [profile.sport, profile.category, profile.stats, profile.ranking].map(normalize).join(" ");
  const founderSignals = ["founder", "founders", "emprendimiento", "emprendedor", "startup", "empresa", "negocio", "industria", "venture", "founder rois"];
  return founderSignals.some(signal => profileText.includes(signal)) ? "founder" : "athlete";
}

function isFounderProfile(profile) {
  return profileVertical(profile) === "founder";
}

function verticalCopy(profile) {
  const founder = isFounderProfile(profile);
  return founder ? {
    accountEyebrow: "Cuenta emprendedora",
    profileDefaultName: "Founder ROIS",
    primaryFieldLabel: "Industria",
    secondaryFieldLabel: "Etapa",
    locationLabel: "Ciudad / base operativa",
    rankingLabel: "Indicador clave / traccion",
    summaryLabel: "Resumen emprendedor",
    summaryPlaceholder: "Vision, producto, mercado, traccion, aprendizajes y siguiente paso para sponsors.",
    proposalLabel: "Propuesta para sponsors PDF",
    videoLabel: "Video o demo del emprendimiento",
    profileEmptyText: "No encontramos una ficha emprendedora vinculada a tu correo. Contacta a ROIS para asociarla.",
    resultsTitle: "Resultados empresariales",
    resultsSubtitle: "Hitos, avances y evidencia para sponsors",
    resultMonthPlaceholder: "Junio 2026",
    resultEventPlaceholder: "Lanzamiento, venta, alianza, cliente, comunidad o avance de producto",
    resultSummaryPlaceholder: "Resultado, aprendizaje, avance comercial y siguiente objetivo.",
    sponsorshipsTitle: "Patrocinios",
    sponsorshipsSubtitle: "Empresas que respaldan tu vision emprendedora",
    scoutsTitle: "Scouts",
    scoutsSubtitle: "Invita founders, comunidades y oportunidades estrategicas",
    postsEmptyText: "Tus publicaciones apareceran aqui. Comparte avances, evidencia, hitos y contenido util para que las empresas evalúen tu emprendimiento.",
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
    proposalLabel: "Propuesta para sponsors PDF",
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
    postsEmptyText: "Tus publicaciones apareceran aqui. Comparte avances, evidencia, hitos y contenido util para que las empresas evalúen tu perfil.",
    profileStatusLabel: "Estado del perfil"
  };
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
  const sponsorships = state.data.sponsorships.filter(item => item.athlete === athlete.name || item.athlete_email === email);
  const results = state.data.athlete_results.filter(item => item.athlete_email === email);
  const profilePhoto = athlete.image_url
    ? `<img src="${athlete.image_url}" alt="${escapeAttr(athlete.name)}">`
    : `<span>${profileInitials(athlete.name)}</span>`;
  const sponsorHighlights = logos.slice(0, 10);
  const hasPosts = posts.length > 0;
  const hasResults = results.length > 0;
  const hasSponsorships = sponsorships.length > 0;
  const primaryValue = athlete.sport || (founder ? "Industria por definir" : "Disciplina por definir");
  const secondaryValue = athlete.category || (founder ? "Etapa por definir" : "Categoria por definir");
  const locationValue = athlete.location || (founder ? "Base por confirmar" : "Ciudad por confirmar");
  const summaryFallback = founder
    ? "Perfil emprendedor en construccion. Sube tu vision, avances, resultados empresariales y publicaciones para presentar una propuesta atractiva a sponsors."
    : "Perfil deportivo en construccion. Sube tu plan de trabajo, resultados y publicaciones para presentar una propuesta atractiva a patrocinadores.";
  const postsEmptyText = readOnly ? "Este perfil aun no ha publicado contenido." : copy.postsEmptyText;
  const resultsEmptyText = founder
    ? "Tus resultados empresariales apareceran aqui. Sube evidencia mensual para fortalecer la confianza de sponsors."
    : "Tus resultados documentados apareceran aqui. Sube evidencia mensual para construir confianza con patrocinadores.";
  const sponsorshipEmptyText = founder
    ? "Aun no hay sponsors o respaldos activos vinculados a tu cuenta."
    : "Aun no hay solicitudes o patrocinios activos vinculados a tu cuenta.";
  const sponsorShowcaseText = founder
    ? "Cuando se formaliza un patrocinio, puedes subir el logotipo autorizado para mostrar el respaldo visible a tu emprendimiento."
    : "Cuando se formaliza un patrocinio, el deportista debe subir el logotipo autorizado para mostrarlo en su perfil.";
  const videoCtaLabel = founder ? "Ver mi emprendimiento" : "Ver plan deportivo";
  const videoPendingLabel = founder ? "Emprendimiento pendiente" : "Plan deportivo pendiente";
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
            <div><strong>${companyView ? sponsorHighlights.length : sponsorships.length}</strong><span>sponsors</span></div>
            <div><strong>${results.length}</strong><span>resultados</span></div>
          </div>
          <p><strong>${escapeHtml(primaryValue)}</strong> / ${escapeHtml(secondaryValue)} / ${escapeHtml(locationValue)}</p>
          <p>${escapeHtml(athlete.stats || summaryFallback)}</p>
          <div class="athlete-social-actions">
            ${readOnly ? `
              ${athleteSponsorCta(athlete, "Solicitar fichaje")}
              ${athleteProposalLink(athlete)}
            ` : `
            ${button("Editar perfil", () => {
              const details = document.getElementById("athleteEditProfile");
              if (details) {
                details.open = !details.open;
                if (details.open) details.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            })}
            ${athlete.proposal_url ? athleteProposalLink(athlete) : `<span class="pill">Propuesta pendiente</span>`}
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
        <button type="button" data-athlete-profile-tab="sponsorships">Patrocinios</button>
      </div>

      <div class="athlete-social-tab-content active" data-athlete-tab-panel="posts">
        ${hasPosts ? `
          <div class="athlete-social-grid">
            ${posts.map(post => athleteSocialPostTile(post, athlete, { canDelete: !readOnly })).join("")}
          </div>
        ` : `<div class="empty athlete-social-empty">Tus publicaciones apareceran aqui. Comparte avances, evidencia, hitos y contenido util para que las empresas evalúen tu perfil.</div>`}
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

      <div class="athlete-social-tab-content" data-athlete-tab-panel="sponsorships">
        <div class="athlete-sponsor-showcase">
          <div>
            <p class="eyebrow">Vitrina de sponsors</p>
            <h4>${sponsorHighlights.length}/10 logos publicados</h4>
            <p>${sponsorShowcaseText}</p>
          </div>
          ${athleteSponsorBubbleStrip(sponsorHighlights, { limit: 10, emptyLabel: "Disponible" })}
        </div>
        ${hasSponsorships ? `
          <div class="athlete-social-info-grid">
            ${sponsorships.map(item => athleteSponsorshipTile(item)).join("")}
          </div>
        ` : `<div class="empty athlete-social-empty">${sponsorshipEmptyText}</div>`}
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
        <label>${copy.primaryFieldLabel}<input name="sport" required value="${escapeAttr(athlete.sport === "Por definir" ? "" : athlete.sport || "")}" placeholder="${escapeAttr(founder ? "Industria principal" : "Disciplina principal")}"></label>
        <label>${copy.secondaryFieldLabel}<input name="category" value="${escapeAttr(athlete.category || "")}"></label>
        <label>${copy.locationLabel}<input name="location" value="${escapeAttr(athlete.location || "")}"></label>
        <label>${copy.rankingLabel}<input name="ranking" value="${escapeAttr(athlete.ranking || "")}"></label>
        <label>Ticket mensual objetivo<input name="monthly" type="number" min="0" value="${Number(athlete.monthly || 5000)}"></label>
        <label>M\u00e1ximo de patrocinadores<input name="max_sponsors" type="number" min="1" value="${Number(athlete.max_sponsors || 10)}"></label>
        <label>Foto de perfil<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <label style="grid-column:1/-1">${copy.summaryLabel}<textarea name="stats" required placeholder="${escapeAttr(copy.summaryPlaceholder)}">${escapeHtml(athlete.stats || "")}</textarea></label>
        <label style="grid-column:1/-1">${copy.proposalLabel}<input name="proposal_pdf" type="file" accept="application/pdf"></label>
        <label style="grid-column:1/-1">${copy.videoLabel} opcional<input name="video_url" type="url" value="${escapeAttr(athlete.video_url || "")}" placeholder="YouTube, Vimeo, Drive o video publicado"></label>
        <label style="grid-column:1/-1">Logos de sponsors actuales opcional<input name="sponsor_logo_files" type="file" accept="image/png,image/jpeg,image/webp" multiple></label>
        <label style="grid-column:1/-1">Nombre de marcas patrocinadoras opcional<textarea name="sponsor_logo_names" placeholder="Una marca por linea, en el mismo orden de los logos."></textarea></label>
        <div class="profile-status-grid" style="grid-column:1/-1">
          <div>
            <span>${copy.profileStatusLabel}</span>
            <strong>${athlete.proposal_url ? "Cargado" : "Pendiente"}</strong>
            ${athleteProposalLink(athlete)}
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
  if (annualRequired) document.querySelector("[data-stripe-key='athleteAnnualProfile']")?.addEventListener("click", () => openStripeCheckout("athleteAnnualProfile", founder ? "Anualidad Emprendedora ROIS" : "Anualidad Deportiva ROIS"));
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
  const referredLabel = founder ? "Founder" : "Deportista";
  const referredPlural = founder ? "founders" : "deportistas";
  const talentLabel = founder ? "talento emprendedor" : "talento deportivo";
  if (!athlete) {
    panel("athlete-scouts", copy.scoutsTitle, "Red de invitacion ROIS", `<div class="empty">${copy.profileEmptyText}</div>`);
    return;
  }
  const code = scoutCodeForAthlete(athlete);
  const referrals = (state.data.athletes || []).filter(item => normalizeScoutCode(item.invited_by_scout_code) === code);
  const weekStart = currentWeekStart();
  const eligibleRows = referrals.filter(item => scoutReferralStatus(item).eligible);
  const weeklyRows = eligibleRows.filter(item => new Date(item.created_at || 0) >= weekStart);
  const rows = referrals.map(item => {
    const status = scoutReferralStatus(item);
    return [
      escapeHtml(item.name || referredLabel),
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
    ${rows.length ? table([referredLabel, "Registro", "Pago", "Perfil", "Validacion", "Comision"], rows) : `<div class="empty">Aun no hay ${referredPlural} registrados con tu codigo.</div>`}
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

function renderAdmin() {
  renderAdminKpis();
  const activePanel = document.querySelector('[data-dashboard="admin"] [data-dashboard-panel].active')?.dataset.dashboardPanel || "admin-users";
  renderAdminPanel(activePanel);
}

function renderAdminPanel(targetId) {
  const map = {
    "admin-users": renderAdminUsers,
    "admin-athletes": renderAdminAthletes,
    "admin-founders": renderAdminFounders,
    "admin-payment-links": renderAdminPaymentLinks,
    "admin-athlete-notifications": renderAdminAthleteNotifications,
    "admin-events": renderAdminEvents,
    "admin-news": renderAdminNews,
    "admin-partners": renderAdminPartners,
    "admin-crm": renderAdminCrm,
    "admin-revenue": renderAdminRevenue,
    "admin-payments": renderAdminPayments,
    "admin-uploads": renderAdminUploads,
    "admin-launch": renderAdminLaunch,
    "admin-stats": renderAdminStats,
    "admin-settings": () => renderAccountSettings("admin-settings")
  };
  if (map[targetId]) map[targetId]();
}

function renderAdminKpis() {
  const pendingUsers = state.data.profiles.filter(item => item.status === "pending").length + state.data.companies.filter(item => item.status === "pending").length;
  const paid = state.data.payments.filter(item => item.status === "paid").reduce((sum, item) => sum + Number(item.amount), 0);
  const pendingRevenue = state.data.payments.filter(item => item.status !== "paid").reduce((sum, item) => sum + Number(item.amount), 0);
  const athletes = adminAthleteRecords().length;
  const founders = adminFounderRecords().length;
  const companies = state.data.companies.length;
  document.getElementById("adminKpis").innerHTML = [
    ["Pendientes", pendingUsers],
    ["Empresas", companies],
    ["Deportistas", athletes],
    ["Founders", founders],
    ["Pagos", `$${paid.toLocaleString("es-MX")}`],
    ["Pendiente", `$${pendingRevenue.toLocaleString("es-MX")}`],
    ["CRM", state.data.crm.length]
  ].map(([label, value]) => `<div class="kpi"><span>${label}</span><strong>${value}</strong></div>`).join("");
}

function revenueVertical(payment) {
  const key = payment.product_key || "";
  const concept = String(payment.concept || "").toLowerCase();
  if (key === "companyMonthlyMembership") return "Membresia Empresa";
  if (key === "founderMonthlyMembership") return "Membresia Founder";
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
  if (key === "founderMonthlyMembership") return "Founder";
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

function renderAdminUsers() {
  const profileRows = state.data.profiles.map(user => [
    user.name,
    user.email,
    badge(user.role === "admin" ? "admin" : user.role === "athlete" ? "deportista" : "cliente"),
    badge(user.status),
    userActions(user, "profiles")
  ]);
  const companyRows = state.data.companies.map(company => [
    company.name,
    company.contact || "Sin correo",
    badge("empresa"),
    badge(company.status),
    userActions(company, "companies")
  ]);
  panel("admin-users", "Usuarios", "Aprobaciones y control de clientes", table(["Nombre", "Correo", "Tipo", "Estado", "Acciones"], [...profileRows, ...companyRows]));
}

function renderAdminAthletes() {
  const athletes = [...adminAthleteRecords()].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const active = athletes.filter(athlete => !["blocked", "deleted", "rejected"].includes(athlete.status));
  const paid = active.filter(athleteAnnualFeePaid).length;
  const linked = active.filter(athlete => athlete.sponsor_payment_url).length;
  const scoutInvited = active.filter(athlete => athlete.invited_by_scout_code).length;
  panel("admin-athletes", "Deportistas", "Gestión por Scouts ROIS", `
    <div class="panel-body admin-athlete-summary">
      <div class="scout-metrics">
        <div><span>Activos</span><strong>${active.length}</strong></div>
        <div><span>Con scout</span><strong>${scoutInvited}</strong></div>
        <div><span>Anualidad pagada</span><strong>${paid}</strong></div>
        <div><span>Link mensual</span><strong>${linked}</strong></div>
      </div>
      <p class="hint">Los deportistas ya no se aprueban manualmente en este panel. Ingresan mediante código Scout ROIS y admin solo gestiona anualidad, link mensual de patrocinio, validación de comisión y bajas operativas.</p>
    </div>
    ${athletes.length ? table(["Deportista", "Correo", "Scout", "Anualidad", "Perfil", "Pago mensual", "Comisión", "Acciones"], athletes.map(athlete => [
      `<strong>${escapeHtml(athlete.name || "Deportista")}</strong><br><span class="hint inline">${escapeHtml(athlete.sport || "Perfil por completar")}</span>`,
      escapeHtml(athlete.email || athlete.contact || "Sin correo"),
      athlete.invited_by_scout_code ? badge(normalizeScoutCode(athlete.invited_by_scout_code)) : badge("sin código"),
      athleteAnnualFeePaid(athlete) ? badge("pagada") : athleteAnnualFeeRequired(athlete) ? badge("solicitada") : badge("no solicitada"),
      athleteProfileCompleteForScout(athlete) ? badge("completo") : badge("pendiente"),
      athlete.sponsor_payment_url ? badge("link activo") : badge("sin link"),
      scoutReferralStatus(athlete).eligible ? badge("validada") : badge(athlete.scout_validation_status || "review"),
      athleteAdminActions(athlete)
    ])) : `<div class="empty">Los deportistas registrados con código Scout ROIS aparecerán aquí.</div>`}
  `);
}

function athleteAdminActions(athlete) {
  const actions = [
    button(athleteAnnualFeeRequired(athlete) ? "Ocultar anualidad" : "Solicitar anualidad", () => toggleAthleteAnnualFee(athlete))
  ];
  if (!athleteAnnualFeePaid(athlete)) actions.push(button("Marcar pago anual", () => markAthleteAnnualPaid(athlete)));
  if (!athlete.scout_active) actions.push(button("Activar scout", () => activateScoutNetwork(athlete)));
  if (athlete.invited_by_scout_code && athlete.scout_commission_status !== "approved") actions.push(button("Validar scout", () => validateScoutCommission(athlete)));
  actions.push(button("Eliminar", () => deleteContent("athletes", athlete)));
  return actionGroup(actions);
}

function founderAdminTraction(athlete) {
  const ranking = String(athlete.ranking || "").trim();
  if (ranking) return ranking;
  const stats = String(athlete.stats || "").trim();
  return stats.length > 96 ? `${stats.slice(0, 96).trim()}...` : (stats || "Por definir");
}

function founderAdminStatus(athlete) {
  return `${badge(athlete.status || "pending")} ${badge(athlete.visual_status || "pendiente visual")}`;
}

function renderAdminFounders() {
  const founders = [...adminFounderRecords()].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const active = founders.filter(founder => !["blocked", "deleted", "rejected"].includes(founder.status));
  const linked = active.filter(founder => founder.sponsor_payment_url).length;
  panel("admin-founders", "Founders", "Gestion administrativa de perfiles founder con compatibilidad tecnica athlete", `
    <div class="panel-body admin-athlete-summary">
      <div class="scout-metrics">
        <div><span>Founders activos</span><strong>${active.length}</strong></div>
        <div><span>Link mensual</span><strong>${linked}</strong></div>
        <div><span>Industria definida</span><strong>${active.filter(founder => founder.sport && founder.sport !== "Por definir").length}</strong></div>
        <div><span>Etapa definida</span><strong>${active.filter(founder => founder.category).length}</strong></div>
      </div>
      <p class="hint">Los founders viven tecnicamente en athletes. Esta vista solo separa administrativamente los perfiles detectados como founder dentro de ROIS.</p>
    </div>
    ${founders.length ? table(["Founder", "Correo", "Industria", "Etapa", "Traccion", "Ticket mensual", "Sponsors", "Estado", "Acciones"], founders.map(founder => [
      `<strong>${escapeHtml(founder.name || "Founder")}</strong>`,
      escapeHtml(founder.email || founder.contact || "Sin correo"),
      escapeHtml(founder.sport || "Por definir"),
      escapeHtml(founder.category || "Por definir"),
      escapeHtml(founderAdminTraction(founder)),
      `$${Number(founder.monthly || 0).toLocaleString("es-MX")} MXN`,
      escapeHtml(String(founder.max_sponsors || 0)),
      founderAdminStatus(founder),
      athleteAdminActions(founder)
    ])) : `<div class="empty">Aun no hay founders registrados en ROIS.</div>`}
  `);
}

function athleteStripePaymentInfo(athlete) {
  const monthly = athleteMonthlyTicket(athlete);
  const name = `Patrocinio mensual ROIS - ${athlete.name || "Deportista"}`;
  const description = [
    `Patrocinio mensual administrado por ROIS para ${athlete.name || "deportista ROIS"}.`,
    `Disciplina: ${athlete.sport || "Por definir"}.`,
    `Categoria: ${athlete.category || "Por definir"}.`,
    `Base: ${athlete.location || "Por confirmar"}.`,
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
    metadata: `athlete_id=${athlete.id || ""}; athlete_email=${athlete.email || ""}; athlete_name=${athlete.name || ""}; rois_product=athlete_monthly_sponsorship`
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
  const athletes = state.data.athletes || [];
  panel("admin-payment-links", "Enlaces de pago", "Configura links mensuales de patrocinio por deportista", `
    <div class="panel-body">
      <div class="section-minihead">
        <p class="eyebrow">Stripe Payment Links</p>
        <h3>Cada deportista genera automaticamente los datos del producto mensual.</h3>
        <p class="hint">En Stripe crea un producto recurrente mensual con la informacion sugerida. Despues pega aqui el link de pago; ese mismo link se abrira desde el boton Patrocinar en el dashboard de empresas.</p>
      </div>
      ${athletes.length ? `<div class="payment-link-grid">${athletes.map(athletePaymentLinkCard).join("")}</div>` : `<div class="empty">Aun no hay deportistas registrados. Cuando crees un deportista, su ficha de pago aparecera aqui automaticamente.</div>`}
    </div>
  `);
  document.querySelectorAll("[data-athlete-payment-form]").forEach(form => form.addEventListener("submit", submitAthletePaymentLink));
  document.querySelectorAll("[data-copy-payment-info]").forEach(button => button.addEventListener("click", () => copyAthletePaymentInfo(button.dataset.copyPaymentInfo)));
}

function athletePaymentLinkCard(athlete) {
  const info = athleteStripePaymentInfo(athlete);
  const founder = isFounderProfile(athlete);
  const label = founder ? "Founder ROIS" : "Athlete ROIS";
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
        <button class="btn" type="button" data-copy-payment-info="${escapeAttr(athlete.id)}">Copiar datos Stripe</button>
        ${athlete.sponsor_payment_url ? `<a class="btn" href="${athlete.sponsor_payment_url}" target="_blank" rel="noopener">Probar link</a>` : ""}
      </div>
      <form class="form-grid compact-form" data-athlete-payment-form data-athlete-id="${escapeAttr(athlete.id)}">
        <label style="grid-column:1/-1">Link de pago mensual Stripe<input name="sponsor_payment_url" type="url" value="${escapeAttr(athlete.sponsor_payment_url || "")}" placeholder="https://buy.stripe.com/..."></label>
        <button class="btn primary" type="submit">${athlete.sponsor_payment_url ? "Actualizar link" : "Activar link"}</button>
      </form>
    </article>
  `;
}

async function copyAthletePaymentInfo(athleteId) {
  const athlete = state.data.athletes.find(item => item.id === athleteId);
  if (!athlete) return;
  const text = athleteStripePaymentText(athlete);
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
  const athlete = state.data.athletes.find(item => item.id === form.dataset.athleteId);
  if (!athlete) return;
  const link = form.sponsor_payment_url.value.trim();
  await api.update("athletes", athlete.id, { sponsor_payment_url: link });
  notify("Enlaces de pago", link ? "Link activado" : "Link retirado", link ? `El boton de patrocinar de ${athlete.name} ya abrira este link desde el dashboard de empresas.` : `El deportista quedo sin link mensual activo.`);
  state.data = await api.loadAll();
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
    ${table(["Visual", "Evento", "Sede", "Brochure", "Estado", "Visual", "Acciones"], state.data.events.map(event => [
      visualThumb(event), event.name, event.venue, event.brochure_url ? badge("PDF") : badge("pendiente"), badge(event.status), badge(event.visual_status || "sin visual"), moderationActions("events", event)
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

function renderAdminCrm() {
  panel("admin-crm", "CRM", "Pipeline de relaciones", table(["Categor\u00eda", "Volumen", "Estado", "Acci\u00f3n"], state.data.crm.map(item => [
    item.name, item.volume, badge(item.status), button("Avanzar", () => updateCrm(item.id))
  ])));
}

function renderAdminPayments() {
  panel("admin-payments", "Pagos", "Resumen financiero conectado a Stripe", table(["Concepto", "Monto", "Estado", "Acci\u00f3n"], state.data.payments.map(payment => [
    payment.concept, `$${Number(payment.amount).toLocaleString("es-MX")} MXN`, badge(payment.status), payment.status === "paid" ? "Pagado" : button("Marcar pagado", () => markPaid(payment.id))
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
  const payments = [...(state.data.payments || [])]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  const totalPaid = payments
    .filter(payment => payment.status === "paid")
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  const totalPending = payments
    .filter(payment => payment.status !== "paid")
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  const byVertical = payments.reduce((acc, payment) => {
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
      <p class="hint">$${Number(data.pending).toLocaleString("es-MX")} MXN pendiente · ${data.count} registros</p>
    </article>
  `).join("");

  const rows = payments.map(payment => [
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

  panel("admin-revenue", "Ingresos", "Trazabilidad financiera por vertical de ROIS", `
    <div class="panel-body">
      <div class="scout-metrics">
        <div><span>Pagado</span><strong>$${totalPaid.toLocaleString("es-MX")}</strong></div>
        <div><span>Pendiente</span><strong>$${totalPending.toLocaleString("es-MX")}</strong></div>
        <div><span>Registros</span><strong>${payments.length}</strong></div>
        <div><span>Verticales</span><strong>${Object.keys(byVertical).length}</strong></div>
      </div>
    </div>
    <div class="panel-body">
      ${verticalCards ? `<div class="launch-sponsor-grid revenue-grid">${verticalCards}</div>` : `<div class="empty">Aun no hay ingresos registrados.</div>`}
    </div>
    ${rows.length ? table(["Fecha", "Vertical", "Cuenta", "Concepto", "Monto", "Product Key", "Estado", "Dashboard", "Accion"], rows) : `<div class="empty">Aun no hay pagos registrados.</div>`}
  `);
}

function renderAdminRevenue() {
  const payments = [...(state.data.payments || [])]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  const totalPaid = payments
    .filter(payment => payment.status === "paid")
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  const totalPending = payments
    .filter(payment => payment.status !== "paid")
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  const byVertical = payments.reduce((acc, payment) => {
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

  const rows = payments.map(payment => [
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

  panel("admin-revenue", "Ingresos", "Trazabilidad financiera por vertical de ROIS", `
    <div class="panel-body">
      <div class="scout-metrics">
        <div><span>Pagado</span><strong>$${totalPaid.toLocaleString("es-MX")}</strong></div>
        <div><span>Pendiente</span><strong>$${totalPending.toLocaleString("es-MX")}</strong></div>
        <div><span>Registros</span><strong>${payments.length}</strong></div>
        <div><span>Verticales</span><strong>${Object.keys(byVertical).length}</strong></div>
      </div>
    </div>
    <div class="panel-body">
      ${verticalCards ? `<div class="launch-sponsor-grid revenue-grid">${verticalCards}</div>` : `<div class="empty">Aun no hay ingresos registrados.</div>`}
    </div>
    ${rows.length ? table(["Fecha", "Vertical", "Cuenta", "Concepto", "Monto", "Product Key", "Estado", "Dashboard", "Accion"], rows) : `<div class="empty">Aun no hay pagos registrados.</div>`}
  `);
}

function renderAdminUploads() {
  panel("admin-uploads", "Uploads", "Biblioteca y moderaci\u00f3n visual", `
    <div class="panel-body">
      <form id="uploadForm" class="form-grid">
        <label>Archivo visual<input name="file" type="file" accept="image/png,image/jpeg,image/webp" required></label>
        <label>Tipo<select name="type"><option>Evento</option><option>Deportista</option><option>Contrato</option><option>Documento</option></select></label>
        <button class="btn primary" type="submit">Registrar upload</button>
      </form>
      <p class="hint">Todo visual subido queda bloqueado hasta revisi\u00f3n manual. En producci\u00f3n debe sumarse moderaci\u00f3n autom\u00e1tica.</p>
    </div>
    ${state.data.uploads.length ? table(["Visual", "Archivo", "Tipo", "Estado", "Acciones"], state.data.uploads.map(item => [
      visualThumb(item), item.name, item.type, badge(item.visual_status || item.status), moderationActions("uploads", item)
    ])) : `<div class="empty">No hay archivos registrados.</div>`}
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
      ` : `<p class="hint">Cada recuadro visual del home se publica desde aquí. Usa proporciones horizontales para portada y alianzas, y proporciones editoriales para tarjetas.</p>`}
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
  state.data = await api.loadAll();
  renderAdmin();
  renderPublic();
  renderClient();
}

async function clearHomeCover() {
  const slot = document.querySelector("#homeCoverForm [name='slot']")?.value || "home_cover";
  await api.remove("site_settings", slot);
  notify("Portada", "Visual retirado", slot === "home_cover" ? "La portada principal ya no aparece en el home." : "El visual seleccionado ya no aparece en ese recuadro.");
  state.data = await api.loadAll();
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
  panel("admin-stats", "Estad\u00edsticas", "Indicadores operativos", table(["M\u00e9trica", "Valor", "Lectura"], [
    ["Conversi\u00f3n de aprobaci\u00f3n", `${Math.round((approvedUsers / totalUsers) * 100)}%`, badge("estable")],
    ["Demanda de eventos", state.data.requests.length, badge("activa")],
    ["Patrocinios en revisi\u00f3n", sponsorReview, badge("prioridad")]
  ]));
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

async function submitAthleteRequirements(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const athlete = currentAthlete();
  if (!athlete) return;
  const imageFile = form.image.files[0];
  const proposalFile = form.proposal_pdf.files[0];
  const sponsorLogos = await sponsorLogoPayload(form.sponsor_logo_files.files, form.sponsor_logo_names.value);
  const patch = {
    name: form.name.value.trim(),
    sport: form.sport.value.trim(),
    category: form.category.value.trim(),
    location: form.location.value.trim(),
    ranking: form.ranking.value.trim(),
    stats: form.stats.value.trim(),
    monthly: Number(form.monthly.value || 5000),
    annual: Number(form.annual.value || 1000),
    max_sponsors: Number(form.max_sponsors.value || 10),
    video_url: form.video_url.value.trim(),
    terms_accepted: Boolean(form.terms_accepted.checked)
  };
  if (imageFile) {
    patch.image_url = await fileToDataUrl(imageFile);
    patch.visual_status = "approved";
  }
  if (proposalFile) {
    patch.proposal_url = await fileToDataUrl(proposalFile);
    patch.proposal_name = proposalFile.name;
  }
  if (sponsorLogos) patch.sponsor_logos = sponsorLogos;
  await api.update("athletes", athlete.id, patch);
  if (!athlete.terms_accepted && patch.terms_accepted) {
    await api.insert("terms_acceptances", {
      user_email: state.session.email,
      user_role: "athlete",
      version: "athlete-representation-v2-intelliquant",
      status: "accepted"
    });
  }
  state.session = { ...state.session, name: patch.name };
  saveSession(state.session);
  notify("Expediente deportivo", "Requisitos guardados", "Tu foto de perfil quedo activa. ROIS seguira revisando documentos sensibles cuando aplique.");
  renderAthlete();
  renderAdmin();
  renderPublic();
}

async function submitAthleteProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const athlete = currentAthlete();
  const founder = isFounderProfile(athlete);
  if (!athlete) return;
  const imageFile = form.image.files[0];
  const proposalFile = form.proposal_pdf.files[0];
  const sponsorLogos = await sponsorLogoPayload(form.sponsor_logo_files.files, form.sponsor_logo_names.value);
  const patch = {
    name: form.name.value.trim(),
    sport: form.sport.value.trim(),
    category: form.category.value.trim(),
    location: form.location.value.trim(),
    ranking: form.ranking.value.trim(),
    monthly: Number(form.monthly.value || 5000),
    max_sponsors: Number(form.max_sponsors.value || 10),
    stats: form.stats.value.trim(),
    video_url: form.video_url.value.trim()
  };
  if (imageFile) {
    patch.image_url = await fileToDataUrl(imageFile);
    patch.visual_status = "approved";
  }
  if (proposalFile) {
    patch.proposal_url = await fileToDataUrl(proposalFile);
    patch.proposal_name = proposalFile.name;
  }
  if (sponsorLogos) patch.sponsor_logos = sponsorLogos;
  await api.update("athletes", athlete.id, patch);
  state.session = { ...state.session, name: patch.name };
  saveSession(state.session);
  notify(founder ? "Perfil emprendedor" : "Perfil deportivo", "Perfil actualizado", imageFile ? `Tu nueva foto ya esta visible en tu ${founder ? "perfil emprendedor" : "perfil deportivo"}.` : `Tu ${founder ? "perfil emprendedor" : "perfil deportivo"} fue actualizado.`);
  renderAthlete();
  renderPublic();
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
  state.data = await api.loadAll();
  renderAdmin();
}

async function markAthleteNotificationRead(id) {
  await api.update("athlete_notifications", id, { status: "read", read_at: new Date().toISOString() });
  state.data = await api.loadAll();
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
  const image_url = await fileToDataUrl(form.image.files[0]);
  const proposalFile = form.proposal_pdf.files[0];
  const proposal_url = proposalFile ? await fileToDataUrl(proposalFile) : "";
  const sponsor_logos = await sponsorLogoPayload(form.sponsor_logo_files.files, form.sponsor_logo_names.value);
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
    max_sponsors: Number(form.max_sponsors.value || 10),
    scout_code: makeScoutCode(form.name.value, ""),
    scout_active: false,
    invited_by_scout_code: "",
    scout_terms_accepted: false,
    annual_fee_paid: false,
    scout_validation_status: "pending",
    scout_commission_status: "pending",
    sponsor_payment_url: form.sponsor_payment_url.value,
    sponsor_terms: form.sponsor_terms.value,
    sponsor_logos,
    proposal_url,
    proposal_name: proposalFile?.name || "",
    video_url: form.video_url.value,
    status: "pending",
    image_url,
    visual_status: image_url ? "pending_review" : "approved"
  });
  notify("Deportistas", "Deportista creado", "El perfil qued\u00f3 pendiente de aprobaci\u00f3n y revisi\u00f3n visual.");
  renderAdmin();
}

async function toggleAthleteAnnualFee(athlete) {
  const next = !athleteAnnualFeeRequired(athlete);
  await api.update("athletes", athlete.id, { annual_fee_required: next, annual: athleteAnnualFeeAmount });
  notify("Anualidad deportista", next ? "Solicitud habilitada" : "Solicitud oculta", next ? `${athlete.name} ya vera el aviso de anualidad con boton de pago en su dashboard.` : `${athlete.name} podra explorar y configurar su dashboard sin aviso de pago anual.`);
  state.data = await api.loadAll();
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
  state.data = await api.loadAll();
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
  state.data = await api.loadAll();
  renderAdmin();
}

async function validateScoutCommission(athlete) {
  await api.update("athletes", athlete.id, {
    scout_validation_status: "validated",
    scout_commission_status: "approved"
  });
  notify("Scouts", "Comision validada", "La cuenta queda elegible para comision si tambien cumple pago y perfil completo.");
  state.data = await api.loadAll();
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
  return `<img class="visual-thumb" src="${item.image_url}" alt="Visual de ${item.name || item.title || "ROIS"}">`;
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
  const reactions = [
    ["Like", "Me gusta"],
    ["Inter\u00e9s", "Me interesa"],
    ["Compartir", "Compartir"],
    ["Comentario", "Comentar"]
  ];
  return `
    <div class="social-actions">
      ${reactions.map(([reaction, label]) => button(`${label} ${newsInteractionCount(news, reaction) || ""}`.trim(), () => interactWithNews(news, reaction))).join("")}
    </div>
  `;
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
    "Marketplace Deportistas",
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
  const image = item.image_url || "./assets/rois-isotipo-cropped.png";
  return `
    <article class="published-card">
      <div class="published-media">
        <img src="${image}" alt="${title}">
      </div>
      <div class="published-content">
        <p class="eyebrow">${kicker || "ROIS"}</p>
        <h3>${title}</h3>
        <p>${text || "Informaci\u00f3n disponible para miembros aprobados."}</p>
        ${action || ""}
      </div>
    </article>
  `;
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
  const image = post.image_url || athlete?.image_url || "./assets/rois-isotipo-cropped.png";
  const link = post.video_url ? `<a class="btn primary" href="${post.video_url}" target="_blank" rel="noopener">Abrir reel</a>` : "";
  return `
    <img src="${image}" alt="${escapeAttr(post.title || "Reel deportivo")}">
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
          <h3>${escapeHtml(post.title || (founder ? "Publicacion emprendedora" : "Publicacion deportiva"))}</h3>
          <p>${escapeHtml(post.caption || (founder ? "Actualizacion emprendedora." : "Actualizacion deportiva."))}</p>
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
  modal.classList.add("profile-modal");
  notify(
    founder ? "Perfil emprendedor" : "Perfil deportivo",
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
  const confirmed = window.confirm(`¿Eliminar "${post.title || "este reel"}"?`);
  if (!confirmed) return;
  try {
    await api.remove("athlete_posts", post.id);
    notify("Publicaciones", "Contenido eliminado", `La publicacion fue retirada de tu ${isFounderProfile(athlete) ? "perfil emprendedor" : "perfil deportivo"} y del feed empresarial.`);
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
  const image = partner.image_url || "./assets/rois-isotipo-cropped.png";
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
          <span><img src="${escapeAttr(logo.image)}" alt="${escapeAttr(name)}"></span>
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

function athleteProposalLink(athlete) {
  if (!athlete.proposal_url) return "";
  const filename = athlete.proposal_name || `${athlete.name || "plan-de-trabajo"}.pdf`;
  return `<a class="btn" href="${athlete.proposal_url}" target="_blank" rel="noopener" download="${filename}">Ver propuesta para sponsors</a>`;
}

function athleteCard(athlete, action) {
  const image = athlete.image_url || "./assets/rois-isotipo-cropped.png";
  const annual = athleteInvestment(athlete).toLocaleString("es-MX");
  const monthly = athleteMonthlyTicket(athlete).toLocaleString("es-MX");
  const logos = athleteSponsorLogos(athlete);
  const maxSponsors = Number(athlete.max_sponsors || 10);
  const proposalButton = athleteProposalLink(athlete);
  return `
    <article class="athlete-card">
      <div class="athlete-media">
        <img src="${image}" alt="${athlete.name}">
        <span class="pill media-pill">${athlete.sport}</span>
      </div>
      <div class="athlete-info">
        <div>
          <p class="eyebrow">Perfil de patrocinio</p>
          <h3>${athlete.name}</h3>
          <p class="athlete-summary">${athlete.stats || "Perfil deportivo en evaluaci\u00f3n."}</p>
          <div class="athlete-sponsor-brands">
            <span>Patrocinadores actuales</span>
            ${athleteSponsorBubbleStrip(logos, { limit: 10, emptyLabel: "Disponible", compact: true })}
          </div>
        </div>
        <div class="athlete-technical">
          <div><span>Deporte</span><strong>${athlete.sport || "Por definir"}</strong></div>
          <div><span>Categor\u00eda</span><strong>${athlete.category || "Semilla"}</strong></div>
          <div><span>Base</span><strong>${athlete.location || "Por confirmar"}</strong></div>
          <div><span>Ranking / marca</span><strong>${athlete.ranking || "En evaluaci\u00f3n"}</strong></div>
        </div>
        <div class="athlete-metrics">
          <div><span>Ticket mensual</span><strong>$${monthly} MXN</strong></div>
          <div><span>Cupos de sponsor</span><strong>${logos.length}/${maxSponsors}</strong></div>
        </div>
        <div class="athlete-decision">
          <p>Ideal para marcas que buscan visibilidad temprana, narrativa deportiva y relaci\u00f3n directa con talento en crecimiento. Inversi\u00f3n anual de perfil: $${annual} MXN.</p>
          <div class="athlete-actions">${proposalButton}${action}</div>
        </div>
      </div>
    </article>
  `;
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

async function sponsorLogoPayload(fileList, namesValue = "") {
  const files = Array.from(fileList || []).slice(0, 10);
  if (!files.length) return "";
  const names = String(namesValue || "").split("\n").map(name => name.trim());
  const logos = await Promise.all(files.map(async (file, index) => ({
    name: names[index] || file.name.replace(/\.[^.]+$/, ""),
    image: await fileToDataUrl(file)
  })));
  return JSON.stringify(logos);
}

function openRegistration(type) {
  state.registrationType = type;
  const title = type === "company"
    ? "Crear cuenta de empresa"
    : type === "founder"
      ? "Registro de founder"
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
      <label>Nombre del founder<input name="name" required placeholder="Nombre del founder"></label>
      <label>Correo<input name="email" type="email" required placeholder="correo@founder.com"></label>
      <label style="grid-column:1/-1">Nombre del emprendimiento<input name="venture_name" required placeholder="Nombre del proyecto o empresa"></label>
      <label>Industria<input name="industry" required placeholder="Tecnologia, salud, consumo, fintech..."></label>
      <label>Etapa<input name="stage" required placeholder="Idea, MVP, traccion, crecimiento"></label>
      <label>Ciudad<input name="city" required placeholder="Ciudad base"></label>
      <label>Contrasena<input name="password" type="password" minlength="8" autocomplete="new-password" required placeholder="Minimo 8 caracteres"></label>
      <label>Confirmar contrasena<input name="confirm" type="password" minlength="8" autocomplete="new-password" required placeholder="Repite tu contrasena"></label>
      <div class="registration-note" style="grid-column:1/-1">
        <p class="eyebrow">Membresia founder</p>
        <p>Tu cuenta founder usa compatibilidad tecnica con el perfil ROIS actual. Despues de entrar podras completar tu propuesta para sponsors, avances, resultados y activar tu codigo de referidos.</p>
      </div>
      <label class="check-option" style="grid-column:1/-1">
        <input name="terms" type="checkbox" required>
        <span>Acepto las condiciones iniciales de ROIS e ${roisLegalEntity}: mi perfil emprendedor queda sujeto a revision y cualquier relacion comercial o patrocinio se gestiona dentro de la plataforma.</span>
      </label>
      <button class="btn primary full" type="submit">Crear cuenta founder</button>
    `;
  }
  return `
    <label>Evento<input name="name" required placeholder="Nombre del evento"></label>
    <label>Categor\u00eda<input name="category" required placeholder="Ejecutivo, patrocinio, membres\u00eda"></label>
    <label>Sede<input name="venue" required placeholder="Sede o ciudad"></label>
    <label>Fecha<input name="date" required placeholder="Por confirmar"></label>
    <label style="grid-column:1/-1">Imagen del evento<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
    <button class="btn primary full" type="submit">Enviar y pagar evento</button>
  `;
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
        notify("Registro", "Fecha de nacimiento inválida", "Ingresa una fecha de nacimiento válida para continuar.");
        return;
      }
      const isMinor = age < 18;
      if (isMinor && (!form.guardian_name.value.trim() || !form.guardian_email.value.trim() || !form.guardian_phone.value.trim() || !form.guardian_relationship.value || !form.guardian_consent.checked)) {
        notify("Registro", "Autorización de tutor requerida", "Para registrar a un deportista menor de edad necesitamos datos y consentimiento expreso de madre, padre o tutor legal.");
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
        notify("Perfil deportivo", "Bienvenido a ROIS", isMinor ? "Cuenta creada con autorización de tutor. ROIS revisará la documentación antes de activar patrocinios." : "Explora tu dashboard y completa tu perfil profesional. ROIS habilitara el pago anual desde admin cuando corresponda.");
      } else {
        showVerificationNotice(signup.email || form.email.value);
      }
      renderAdmin();
      renderPublic();
      return;
    } else if (type === "founder") {
      if (form.password.value !== form.confirm.value) {
        notify("Registro", "Las contrase\u00f1as no coinciden", "Confirma la contrase\u00f1a para crear tu cuenta founder.");
        return;
      }
      const founderIndustry = form.industry.value.trim() || "Founder ROIS";
      const founderStage = form.stage.value.trim();
      const founderCity = form.city.value.trim();
      const ventureName = form.venture_name.value.trim();
      const founderStats = `Founder ROIS. Emprendimiento: ${ventureName}. Industria: ${founderIndustry}. Etapa: ${founderStage}. Ciudad: ${founderCity}.`;
      const signup = await api.signupAthlete({
        email: form.email.value,
        password: form.password.value,
        name: form.name.value,
        scoutCode: "",
        birthDate: "",
        isMinor: false,
        guardianName: "",
        guardianEmail: "",
        guardianPhone: "",
        guardianRelationship: "",
        guardianConsent: false,
        termsAccepted: form.terms.checked,
        sport: founderIndustry || "Founder ROIS",
        category: founderStage,
        location: founderCity,
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
        notify("Perfil founder", "Bienvenido a ROIS", "Tu cuenta founder ya puede completar perfil, propuesta para sponsors y resultados dentro del dashboard.");
      } else {
        showVerificationNotice(signup.email || form.email.value);
      }
      renderAdmin();
      renderPublic();
      return;
    } else {
      const image_url = await fileToDataUrl(form.image.files[0]);
      await api.insert("events", { name: form.name.value, category: form.category.value, venue: form.venue.value, date: form.date.value, status: "pending", image_url, visual_status: image_url ? "pending_review" : "approved" });
      paymentAction = ["eventRegistration", "Registro de Evento ROIS"];
    }
    closeModals();
    notify("Registro", "Solicitud recibida", "El registro qued\u00f3 pendiente de aprobaci\u00f3n en el panel administrador.");
    if (paymentAction) {
      openStripeCheckout(paymentAction[0], paymentAction[1]);
    }
    renderAdmin();
    renderPublic();
  } catch (error) {
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
        const membershipPayment = await registerMembershipPayment("company", {
          company: form.name.value,
          email: form.email.value
        });
        renderSession();
        renderClient();
        showView("client");
        if (membershipPayment) openStripeCheckout(membershipPayment.productKey, membershipPayment.title);
        notify("Cuenta creada", "Bienvenido a ROIS", "Tu dashboard de cliente ya est\u00e1 activo. Completa el pago mensual en Stripe para activar tu membres\u00eda.");
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
        notify("Registro", "Las contrase\u00f1as no coinciden", "Confirma la contrase\u00f1a para crear tu cuenta founder.");
        return;
      }
      const founderIndustry = form.industry.value.trim() || "Founder ROIS";
      const founderStage = form.stage.value.trim();
      const founderCity = form.city.value.trim();
      const ventureName = form.venture_name.value.trim();
      const founderStats = `Founder ROIS. Emprendimiento: ${ventureName}. Industria: ${founderIndustry}. Etapa: ${founderStage}. Ciudad: ${founderCity}.`;
      const signup = await api.signupAthlete({
        email: form.email.value,
        password: form.password.value,
        name: form.name.value,
        scoutCode: "",
        birthDate: "",
        isMinor: false,
        guardianName: "",
        guardianEmail: "",
        guardianPhone: "",
        guardianRelationship: "",
        guardianConsent: false,
        termsAccepted: form.terms.checked,
        sport: founderIndustry || "Founder ROIS",
        category: founderStage,
        location: founderCity,
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
        notify("Perfil founder", "Bienvenido a ROIS", "Tu dashboard founder ya est\u00e1 activo. Completa el pago mensual en Stripe para activar tu membres\u00eda Founder ROIS.");
      } else {
        showVerificationNotice(signup.email || form.email.value);
      }
      renderAdmin();
      renderPublic();
      return;
    } else {
      const image_url = await fileToDataUrl(form.image.files[0]);
      await api.insert("events", { name: form.name.value, category: form.category.value, venue: form.venue.value, date: form.date.value, status: "pending", image_url, visual_status: image_url ? "pending_review" : "approved" });
      paymentAction = ["eventRegistration", "Registro de Evento ROIS"];
    }
    closeModals();
    notify("Registro", "Solicitud recibida", "El registro qued\u00f3 pendiente de aprobaci\u00f3n en el panel administrador.");
    if (paymentAction) {
      openStripeCheckout(paymentAction[0], paymentAction[1]);
    }
    renderAdmin();
    renderPublic();
  } catch (error) {
    notify("Registro", "No fue posible registrar", humanError(error));
  }
}

