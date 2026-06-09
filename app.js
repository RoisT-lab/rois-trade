const config = window.ROIS_CONFIG || {};
const roisBuild = "20260608-athlete-onboarding-v16";
const roisLegalEntity = "IntelliQuant S.A.P.I. de C.V.";
const demoMode = config.demoMode !== false || !config.supabaseUrl || !config.supabaseAnonKey;
const storeKey = "rois_demo_data_v2";
const sessionKey = "rois_session_v2";
const configuredDemoAdmin = config.demoAdminEmail && config.demoAdminPassword;
const adminEmail = (config.adminEmail || config.demoAdminEmail || "").toLowerCase();
const fixedLogoPath = config.logoDataUrl || "./assets/rois-logo.png";

const state = {
  session: readSession(),
  pendingSession: null,
  registrationType: null,
  data: null
};

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
  terms_acceptances: []
};

const api = demoMode ? demoApi() : supabaseApi();

init();

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

async function recoverySessionFromUrl() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, "") || window.location.search.replace(/^\?/, ""));
  const isRecovery = params.get("type") === "recovery";
  const token = params.get("access_token");
  if (!isRecovery || !token) return null;
  history.replaceState(null, document.title, window.location.pathname);
  try {
    return await api.recoverySession(token);
  } catch (error) {
    notify("RecuperaciÃ³n", "Enlace no vÃ¡lido", "Solicita un nuevo enlace para cambiar tu contraseÃ±a.");
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
  const email = state.session.email?.toLowerCase();
  return state.data.athletes.find(athlete => (athlete.email || athlete.contact || "").toLowerCase() === email) || null;
}

async function init() {
  state.session = normalizeSession(state.session);
  state.data = await api.loadAll();
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
  if (state.pendingSession) {
    showView("home");
    document.getElementById("passwordModal").classList.add("active");
    return;
  }
  if (state.session) showView(dashboardViewForRole(state.session.role));
}

function applyBranding() {
  document.querySelectorAll(".brand-logo, .side-logo").forEach(image => {
    image.src = fixedLogoPath;
    image.hidden = false;
    image.closest(".brand, .sidebar")?.classList.remove("logo-fallback");
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
  document.querySelectorAll(".brand-logo, .side-logo").forEach(image => {
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
    async login(email, password) {
      const data = read();
      const user = data.profiles.find(item => item.email.toLowerCase() === email.toLowerCase() && item.password === password);
      if (!user) throw new Error("Credenciales invÃ¡lidas.");
      if (user.status !== "approved") throw new Error("Este usuario aÃºn no estÃ¡ aprobado.");
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
        sport: "Por definir",
        category: "",
        location: "",
        ranking: "",
        stats: "",
        annual: 1000,
        monthly: 5000,
        max_sponsors: 3,
        terms_accepted: false,
        status: "pending",
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
    async loadAll() {
      const tables = ["profiles", "companies", "athletes", "events", "requests", "sponsorships", "news", "partnerships", "site_settings", "crm", "payments", "uploads", "athlete_posts", "athlete_results", "athlete_expenses", "athlete_deposits", "terms_acceptances"];
      const result = {};
      await Promise.all(tables.map(async table => {
        try {
          result[table] = await request(`/rest/v1/${table}?select=*`, { headers: headers() });
        } catch (error) {
          result[table] = [];
        }
      }));
      return result;
    },
    async login(email, password) {
      const auth = await request("/auth/v1/token?grant_type=password", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ email, password })
      });
      const profiles = await request(`/rest/v1/profiles?select=*&id=eq.${auth.user.id}&limit=1`, {
        headers: headers(auth.access_token)
      });
      const profile = profiles[0] || (auth.user.user_metadata?.role === "athlete" ? await this.ensureAthleteAccount(auth) : await this.ensureClientAccount(auth));
      if (profile.status !== "approved") throw new Error("Este usuario aÃºn no estÃ¡ aprobado.");
      const companies = await request(`/rest/v1/companies?select=id&contact=eq.${encodeURIComponent(email)}&limit=1`, {
        headers: headers(auth.access_token)
      });
      const role = profile.role === "athlete" ? "athlete" : companies.length ? "client" : normalizedRole(email, profile.role);
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
            sport: "Por definir",
            category: "",
            location: "",
            ranking: "",
            stats: "",
            annual: 1000,
            monthly: 5000,
            max_sponsors: 3,
            terms_accepted: false,
            status: "pending",
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
          sport: "Por definir",
          category: "",
          location: "",
          ranking: "",
          stats: "",
          annual: 1000,
          monthly: 5000,
          max_sponsors: 3,
          terms_accepted: false,
          status: "pending",
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
    async recoverySession(accessToken) {
      const user = await request("/auth/v1/user", {
        headers: headers(accessToken)
      });
      const profiles = await request(`/rest/v1/profiles?select=*&id=eq.${user.id}&limit=1`, {
        headers: headers(accessToken)
      });
      const profile = profiles[0] || (user.user_metadata?.role === "athlete" ? await this.ensureAthleteAccount({ user, access_token: accessToken }) : await this.ensureClientAccount({ user, access_token: accessToken }));
      const companies = await request(`/rest/v1/companies?select=id&contact=eq.${encodeURIComponent(user.email)}&limit=1`, {
        headers: headers(accessToken)
      });
      const role = profile.role === "athlete" ? "athlete" : companies.length ? "client" : normalizedRole(user.email, profile.role);
      return { id: profile.id, email: user.email, role, name: profile.name, token: accessToken, mustChangePassword: true };
    },
    async ensureClientAccount(auth, fallback = {}) {
      const token = auth.access_token || auth.session?.access_token;
      const email = auth.user.email;
      const meta = auth.user.user_metadata || {};
      const company = fallback.company || meta.company_name || meta.name || email.split("@")[0];
      const contact = fallback.contact || meta.contact_name || company;
      const interest = fallback.interest || meta.interest || "Relaciones estratÃ©gicas";
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
    async ensureAthleteAccount(auth) {
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
      const existingAthletes = await request(`/rest/v1/athletes?select=id&email=eq.${encodeURIComponent(email)}&limit=1`, {
        headers: headers(token)
      });
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
            status: "pending",
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
  document.querySelectorAll("[data-close-modal]").forEach(button => button.addEventListener("click", closeModals));
  document.querySelectorAll("[data-logout]").forEach(button => button.addEventListener("click", logout));
  document.querySelectorAll("[data-dashboard-target]").forEach(button => button.addEventListener("click", () => showDashboardPanel(button.dataset.dashboardTarget)));
  document.querySelectorAll("[data-mobile-menu]").forEach(button => button.addEventListener("click", () => openMobileDashboardMenu(button.dataset.mobileMenu)));
  document.querySelectorAll("[data-close-mobile-menu]").forEach(button => button.addEventListener("click", closeMobileDashboardMenus));
  document.querySelectorAll("[data-registration]").forEach(button => button.addEventListener("click", () => openRegistration(button.dataset.registration)));
  document.querySelector("[data-open-recovery]").addEventListener("click", toggleRecoveryForm);
  document.getElementById("loginForm").addEventListener("submit", submitLogin);
  document.getElementById("recoveryForm").addEventListener("submit", submitPasswordRecovery);
  document.getElementById("passwordForm").addEventListener("submit", submitPasswordChange);
  document.getElementById("registrationForm").addEventListener("submit", submitRegistration);
}

function showView(name) {
  document.body.dataset.activeView = name;
  document.querySelectorAll("[data-view]").forEach(view => view.classList.toggle("active", view.dataset.view === name));
  if (name === "client") renderClient();
  if (name === "athlete") renderAthlete();
  if (name === "admin") renderAdmin();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showDashboardPanel(targetId) {
  const targetPanel = document.querySelector(`[data-dashboard-panel="${targetId}"]`);
  if (!targetPanel) return;
  const workspace = targetPanel.closest("[data-dashboard]");
  const nav = document.querySelector(`[data-dashboard-nav="${workspace.dataset.dashboard}"]`);
  workspace.querySelectorAll("[data-dashboard-panel]").forEach(panel => panel.classList.toggle("active", panel === targetPanel));
  nav.querySelectorAll("[data-dashboard-target]").forEach(button => button.classList.toggle("active", button.dataset.dashboardTarget === targetId));
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
    notify("Acceso", "No fue posible iniciar sesiÃ³n", error.message);
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
    notify("RecuperaciÃ³n", "Correo enviado", "Si el correo existe en ROIS, recibirÃ¡ un enlace para restablecer la contraseÃ±a.");
    form.reset();
    form.hidden = true;
    closeModals();
  } catch (error) {
    notify("RecuperaciÃ³n", "No fue posible enviar el enlace", humanError(error));
  }
}

async function submitPasswordChange(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (form.password.value !== form.confirm.value) {
    notify("ContraseÃ±a", "Las contraseÃ±as no coinciden", "Confirma la nueva contraseÃ±a para continuar.");
    return;
  }
  if (!state.pendingSession) {
    notify("ContraseÃ±a", "SesiÃ³n no encontrada", "Inicia sesiÃ³n nuevamente para cambiar la contraseÃ±a.");
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
    notify("ContraseÃ±a", "No fue posible cambiarla", error.message);
  }
}

async function submitSettingsPassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (form.password.value !== form.confirm.value) {
    notify("ConfiguraciÃ³n", "Las contraseÃ±as no coinciden", "Confirma la nueva contraseÃ±a para actualizarla.");
    return;
  }
  try {
    state.session = await api.changePassword(state.session, form.password.value);
    saveSession(state.session);
    form.reset();
    notify("ConfiguraciÃ³n", "ContraseÃ±a actualizada", "El cambio quedÃ³ aplicado correctamente.");
  } catch (error) {
    notify("ConfiguraciÃ³n", "No fue posible cambiarla", humanError(error));
  }
}

async function submitCompanyProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const company = currentCompany();
  if (!company) {
    notify("Empresa", "No encontramos tu cuenta", "Vuelve a iniciar sesiÃ³n para actualizar tu perfil.");
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
    notify("Empresa", "Perfil actualizado", logoFile ? "El logotipo y la informaciÃ³n de tu empresa quedaron guardados." : "La informaciÃ³n de tu empresa quedÃ³ guardada.");
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
  document.querySelectorAll(".modal").forEach(modal => modal.classList.remove("active"));
}

function notify(kicker, title, text, actions = "") {
  document.getElementById("actionKicker").textContent = kicker;
  document.getElementById("actionTitle").textContent = title;
  document.getElementById("actionText").textContent = text;
  document.getElementById("actionActions").innerHTML = actions;
  document.getElementById("actionModal").classList.add("active");
}

function showVerificationNotice(email) {
  notify(
    "VerificaciÃ³n",
    "Confirma tu correo",
    `Enviamos un enlace de verificaciÃ³n a ${email}. Si no lo recibiste, revisa spam o solicita un nuevo envÃ­o.`,
    `<button class="btn primary full" type="button" id="resendVerificationButton">Reenviar correo de verificaciÃ³n</button>`
  );
  document.getElementById("resendVerificationButton").addEventListener("click", () => resendVerificationEmail(email));
}

async function resendVerificationEmail(email) {
  try {
    await api.resendSignup(email);
    notify("VerificaciÃ³n", "Correo reenviado", `Enviamos nuevamente el enlace de verificaciÃ³n a ${email}.`);
  } catch (error) {
    notify("VerificaciÃ³n", "No se pudo reenviar", humanError(error));
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

function humanError(error) {
  const message = typeof error?.message === "string" ? error.message : JSON.stringify(error);
  if (message.includes("row-level security") || message.includes("42501")) {
    return "La base de datos todavÃ­a estÃ¡ bloqueando este registro. Actualiza las polÃ­ticas de Supabase y vuelve a intentarlo.";
  }
  return message || "OcurriÃ³ un error inesperado.";
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

function renderSession() {
  const area = document.getElementById("sessionArea");
  if (!state.session) {
    area.innerHTML = `<button class="btn subtle" type="button" data-open-login>Acceso</button>`;
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
  const publicPartners = state.data.partnerships.filter(item => item.status === "approved" && visualIsPublic(item));
  document.getElementById("publicPartners").innerHTML = publicPartners.length ? `
    <div class="partner-grid">
      ${publicPartners.map(partner => partnerCard(partner)).join("")}
    </div>
  ` : `<div class="empty">Las alianzas y sponsors aprobados aparecerÃ¡n aquÃ­ cuando admin los publique.</div>`;

  const publicEvents = state.data.events.filter(item => item.status === "approved" && visualIsPublic(item));
  document.getElementById("publicEvents").innerHTML = publicEvents.length ? `
    <div class="public-feature-grid">
      ${publicEvents.map(event => publishedCard({
        item: event,
        kicker: event.category || "Evento ROIS",
        title: event.name,
        text: `${event.date || "Fecha por confirmar"} / ${event.venue || "Sede por confirmar"}`,
        action: `
          ${eventPositioningBlock(event)}
          <div class="action-row">
            ${eventBrochureLink(event)}
            <button class="btn" type="button" data-open-login>Solicitar acceso</button>
          </div>
        `
      })).join("")}
    </div>
  ` : `<div class="empty">Los eventos aprobados aparecerÃ¡n aquÃ­ cuando el administrador los publique.</div>`;

  const publicAthletes = state.data.athletes.filter(item => item.status === "approved" && visualIsPublic(item));
  document.getElementById("publicAthletes").innerHTML = publicAthletes.length ? `
    <div class="athlete-showcase">
      ${publicAthletes.map(athlete => athleteCard(athlete, `<button class="btn primary" type="button" data-open-login>Patrocinar</button>`)).join("")}
    </div>
  ` : `<div class="empty">Los deportistas aprobados aparecerÃ¡n aquÃ­ cuando el administrador los publique.</div>`;

  const publicNews = state.data.news.filter(item => item.status === "published" && visualIsPublic(item));
  document.getElementById("publicNews").innerHTML = publicNews.length ? `
    <div class="public-feature-grid">
      ${publicNews.map(news => publishedCard({
        item: news,
        kicker: "Nota ROIS",
        title: news.title,
        text: news.summary,
        action: `<div class="social-actions public-social"><button class="btn" type="button" data-open-login>Me gusta</button><button class="btn" type="button" data-open-login>Comentar</button><button class="btn" type="button" data-open-login>Compartir</button></div>`
      })).join("")}
    </div>
  ` : `<div class="empty">Las noticias publicadas aparecerÃ¡n aquÃ­.</div>`;

  document.querySelectorAll("[data-open-login]").forEach(button => button.addEventListener("click", openLogin));
}

function renderClient() {
  renderClientHeader();
  renderClientKpis();
  renderClientEvents();
  renderClientFeed();
  renderClientNews();
  renderClientSponsors();
  renderClientMarketplace();
  renderClientRegister();
  renderClientStatus();
  renderClientPayments();
  renderAccountSettings("client-settings");
}

function renderClientFeed() {
  const posts = state.data.athlete_posts
    .filter(post => post.status === "approved" && visualIsPublic(post))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  panel("client-feed", "Feed deportivo", "Entrenamientos y actualizaciones publicadas por deportistas", posts.length ? `
    <div class="panel-body">
      <div class="feed-list">
        ${posts.map(post => athleteFeedCard(post)).join("")}
      </div>
    </div>
  ` : `<div class="empty">Los reels y entrenamientos aprobados por ROIS aparecerÃ¡n aquÃ­.</div>`);
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
  ` : `<div class="empty">Los eventos aprobados por admin aparecerÃ¡n aquÃ­.</div>`);
}

function renderClientNews() {
  const news = state.data.news.filter(item => item.status === "published" && visualIsPublic(item));
  panel("client-news", "Noticias", "Publicaciones privadas para detectar oportunidades", news.length ? `
    <div class="panel-body">
      <div class="opportunity-grid">
        ${news.map(item => publishedCard({
          item,
          kicker: "PublicaciÃ³n ROIS",
          title: item.title,
          text: item.summary,
          action: newsInteractionBar(item)
        })).join("")}
      </div>
    </div>
  ` : `<div class="empty">Las noticias publicadas por admin aparecerÃ¡n aquÃ­.</div>`);
}

function renderClientSponsors() {
  const partners = state.data.partnerships.filter(item => item.status === "approved" && visualIsPublic(item));
  const tiers = [
    {
      name: "Partner ROIS",
      amount: 25000,
      productKey: "roisPartnerMonthly",
      label: "$25,000 MXN / mes",
      description: "Entrada institucional para empresas que quieren presencia dentro del ecosistema ROIS.",
      benefits: [
        "Logotipo visible en el dashboard y home como patrocinador ROIS",
        "Acceso prioritario a oportunidades de eventos y deportistas publicados",
        "1 brief mensual de oportunidades de patrocinio curadas",
        "MenciÃ³n institucional en comunicaciÃ³n ROIS seleccionada",
        "Reporte mensual de actividad y oportunidades"
      ]
    },
    {
      name: "Patrocinador Oficial",
      amount: 50000,
      productKey: "officialSponsorMonthly",
      label: "$50,000 MXN / mes",
      featured: true,
      description: "Nivel recomendado para empresas que quieren presencia activa en eventos, academias y oportunidades deportivas.",
      benefits: [
        "Todo lo incluido en Partner ROIS",
        "Prioridad en eventos y activaciones de la red ROIS",
        "Presencia de marca en academias o alianzas estratÃ©gicas disponibles",
        "2 briefs mensuales de oportunidades con recomendaciÃ³n ROIS",
        "Acceso preferente a deportistas aprobados para patrocinio"
      ]
    },
    {
      name: "Legacy Sponsor",
      amount: 100000,
      productKey: "roisLegacyMonthly",
      label: "$100,000 MXN / mes",
      description: "Patrocinio de alto impacto para marcas que buscan visibilidad deportiva, narrativa institucional y presencia premium.",
      benefits: [
        "Todo lo incluido en Patrocinador Oficial",
        "Exclusividad de giro durante 12 meses con compromiso anual",
        "AsignaciÃ³n de un deportista de alto rendimiento sujeto a disponibilidad",
        "Presencia en redes sociales del deportista y ecosistema ROIS",
        "Branding en uniforme, equipo deportivo o materiales autorizados",
        "Activaciones en academias y eventos estratÃ©gicos",
        "Mesa trimestral de estrategia con direcciÃ³n ROIS"
      ]
    }
  ];
  panel("client-sponsors", "Patrocinios ROIS", "Elige un nivel mensual de presencia, acceso y activaciÃ³n dentro del ecosistema ROIS", `
    <div class="panel-body">
      ${partners.length ? `
        <div class="section-minihead">
          <p class="eyebrow">Patrocinadores oficiales</p>
          <h3>Red publicada por ROIS para conexiones estratÃ©gicas.</h3>
        </div>
        <div class="opportunity-grid">
          ${partners.map(partner => clientPartnerCard(partner)).join("")}
        </div>
      ` : `<div class="empty slim">Los patrocinadores oficiales aprobados aparecerÃ¡n aquÃ­.</div>`}
      <div class="sponsor-tiers">
        ${tiers.map(tier => sponsorTierCard(tier)).join("")}
      </div>
    </div>
  `);
  tiers.forEach(tier => {
    document.getElementById(`sponsor-${tier.amount}`).addEventListener("click", () => selectRoisSponsorTier(tier));
  });
}

function renderClientMarketplace() {
  const athletes = state.data.athletes.filter(item => item.status === "approved" && visualIsPublic(item));
  panel("client-marketplace", "Marketplace Deportistas", "Perfiles aprobados para sponsor", athletes.length ? `
    <div class="panel-body">
      <div class="athlete-showcase compact">
        ${athletes.map(athlete => athleteCard(athlete, button("Configurar patrocinio", () => openAthleteSponsorConfigurator(athlete)))).join("")}
      </div>
    </div>
  ` : `<div class="empty">AÃºn no hay deportistas aprobados para patrocinio.</div>`);
}

function renderClientRegister() {
  panel("client-register", "Registrar Evento", "EnvÃ­o a revisiÃ³n", `
    <div class="panel-body">
      <form id="eventForm" class="form-grid">
        <label>Nombre<input name="name" required placeholder="TÃ­tulo del evento"></label>
        <label>Sede<input name="venue" required placeholder="Sede o ciudad"></label>
        <label>CategorÃ­a<input name="category" required placeholder="Ejecutivo, patrocinio, membresÃ­a"></label>
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
    notify("Eventos", "Evento registrado", "El evento fue enviado a revisiÃ³n del administrador.");
    renderClient();
  });
}

function renderClientStatus() {
  const rows = [
    ...state.data.requests.filter(item => item.type !== "InteracciÃ³n noticia").map(item => [item.title, item.type, item.priority || "Normal", badge(item.status)]),
    ...state.data.sponsorships.map(item => [item.athlete, "Patrocinio", "RevisiÃ³n ROIS", badge(item.status)])
  ];
  panel("client-status", "Estado Solicitudes", "Seguimiento operativo", rows.length ? table(["Solicitud", "Ãrea", "Prioridad", "Estado"], rows) : `<div class="empty">No hay solicitudes todavÃ­a.</div>`);
}

function renderClientPayments() {
  const rows = state.data.payments.map(payment => [
    payment.concept,
    `$${Number(payment.amount).toLocaleString("es-MX")} MXN`,
    badge(payment.status),
    payment.status === "paid" ? "Pagado" : button("Pagar con Stripe", () => payClientPayment(payment.id))
  ]);
  panel("client-payments", "Pagos", "Stripe y compromisos activos", rows.length ? table(["Concepto", "Monto", "Estado", "AcciÃ³n"], rows) : `
    <div class="panel-body">
      <div class="empty">No hay pagos registrados todavÃ­a. Las solicitudes de patrocinio generarÃ¡n pagos pendientes para Stripe.</div>
    </div>
  `);
}

function renderAccountSettings(panelId) {
  const company = panelId === "client-settings" ? currentCompany() : null;
  panel(panelId, "ConfiguraciÃ³n", panelId === "client-settings" ? "Perfil de empresa y seguridad" : "Seguridad de acceso", `
    <div class="panel-body">
      <div class="settings-grid">
        ${company ? `
          <div class="settings-block">
            <p class="eyebrow">Empresa</p>
            <h3>Identidad visible en tu sesiÃ³n</h3>
            <p class="hint">Sube un logotipo institucional en PNG, JPG o WEBP. Se guardarÃ¡ en tu cuenta y serÃ¡ visible en tu dashboard al iniciar sesiÃ³n desde cualquier dispositivo.</p>
          </div>
          <form class="form-grid company-profile-form" data-company-profile>
            <div class="company-logo-preview">
              <img src="${company.logo_url || sessionLogoPath()}" alt="${company.name || "Empresa"}">
              <span>${company.logo_url ? "Logo actual" : "Logo pendiente"}</span>
            </div>
            <label>Nombre de empresa<input name="name" required value="${escapeAttr(company.name || "")}" placeholder="Nombre legal o comercial"></label>
            <label>Contacto principal<input name="owner" value="${escapeAttr(company.owner || "")}" placeholder="Nombre del responsable"></label>
            <label>Correo de acceso<input name="contact" type="email" readonly value="${escapeAttr(company.contact || state.session?.email || "")}" placeholder="correo@empresa.com"></label>
            <label>InterÃ©s principal<select name="interest">
              ${["Patrocinios", "Eventos", "Deportistas", "Patrocinador oficial ROIS", "Relaciones estratÃ©gicas"].map(option => `<option value="${option}" ${company.interest === option ? "selected" : ""}>${option}</option>`).join("")}
            </select></label>
            <label>Sitio web<input name="website" type="url" value="${escapeAttr(company.website || "")}" placeholder="https://"></label>
            <label>Logotipo de empresa<input name="logo" type="file" accept="image/png,image/jpeg,image/webp"></label>
            <label style="grid-column:1/-1">DescripciÃ³n breve<textarea name="description" placeholder="Describe a quÃ© se dedica la empresa y quÃ© tipo de oportunidades busca.">${escapeHtml(company.description || "")}</textarea></label>
            <button class="btn primary" type="submit">Guardar perfil de empresa</button>
          </form>
        ` : ""}
        <div class="settings-block">
          <p class="eyebrow">SesiÃ³n</p>
          <h3>Cierre automÃ¡tico</h3>
          <p class="hint">La sesiÃ³n ROIS se mantiene solo mientras esta ventana del navegador permanezca abierta. Al cerrar la pestaÃ±a o el navegador, se solicitarÃ¡ iniciar sesiÃ³n nuevamente.</p>
        </div>
        <form class="form-grid settings-password-form" data-settings-password>
          <label>Nueva Contrasena<input name="password" type="password" minlength="8" autocomplete="new-password" required></label>
          <label>Confirmar contrasena<input name="confirm" type="password" minlength="8" autocomplete="new-password" required></label>
          <button class="btn primary" type="submit">Actualizar contraseÃ±a</button>
        </form>
        <div class="settings-block">
          <p class="eyebrow">RecuperaciÃ³n</p>
          <h3>Recuperar acceso</h3>
          <p class="hint">Si pierdes acceso, usa â€œRecuperar contraseÃ±aâ€ en la pantalla de acceso. ROIS enviarÃ¡ un enlace al correo registrado.</p>
        </div>
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
  renderAthleteRequirements();
  renderAthleteNotifications();
  renderAthleteProfile();
  renderAthleteSponsorships();
  renderAthleteResults();
  renderAthleteReels();
  renderAthleteExpenses();
  renderAthleteDeposits();
  renderAccountSettings("athlete-settings");
}

function renderAthleteHeader() {
  const athlete = currentAthlete();
  document.getElementById("athleteAccountEyebrow").textContent = athleteOnboardingComplete(athlete) ? "Expediente completo" : "Expediente en preparacion";
  document.getElementById("athleteAccountName").textContent = athlete?.name || state.session?.name || "Deportista ROIS";
  const logo = document.getElementById("athleteProfileLogo");
  if (logo) logo.src = athlete?.image_url || "./assets/rois-isotipo-cropped.png";
  applySessionBranding();
}

function renderAthleteKpis() {
  const athlete = currentAthlete();
  const email = state.session?.email || "";
  const name = athlete?.name || state.session?.name || "";
  const sponsorships = state.data.sponsorships.filter(item => item.athlete === name || item.athlete_email === email).length;
  const results = state.data.athlete_results.filter(item => item.athlete_email === email).length;
  const posts = state.data.athlete_posts.filter(item => item.athlete_email === email).length;
  const deposits = state.data.athlete_deposits.filter(item => item.athlete_email === email).length;
  document.getElementById("athleteKpis").innerHTML = [
    ["Solicitudes", sponsorships],
    ["Resultados", results],
    ["Reels", posts],
    ["DepÃ³sitos", deposits]
  ].map(([label, value]) => `<div class="kpi"><span>${label}</span><strong>${value}</strong></div>`).join("");
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
    { key: "video", label: "Video de competencias o entrenamientos", done: Boolean(athlete?.video_url) },
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
  return athleteRequirementStatus(athlete).ready;
}

function athleteGate(panelId, title, subtitle) {
  panel(panelId, title, subtitle, `
    <div class="panel-body">
      <div class="requirement-gate">
        <p class="eyebrow">Expediente pendiente</p>
        <h3>Completa tus requisitos antes de operar dentro de ROIS.</h3>
        <p>Tu cuenta ya existe, pero el acceso a solicitudes, publicaciones y comprobantes se habilita cuando tu expediente deportivo y contractual queda completo.</p>
        ${button("Completar requisitos", () => showDashboardPanel("athlete-requirements"))}
      </div>
    </div>
  `);
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
  const athlete = currentAthlete();
  if (!athlete) {
    panel("athlete-requirements", "Requisitos", "Expediente deportivo", `<div class="empty">No encontramos una ficha deportiva vinculada a tu correo. Contacta a ROIS para asociarla.</div>`);
    return;
  }
  const status = athleteRequirementStatus(athlete);
  panel("athlete-requirements", "Requisitos", "Expediente antes de avanzar", `
    <div class="panel-body">
      <div class="onboarding-hero">
        <div>
          <p class="eyebrow">Alta deportiva ROIS</p>
          <h3>${status.ready ? "Expediente completo" : "Completa tu expediente para activar operaciones"}</h3>
          <p>${status.ready ? "Tu perfil esta listo para revision, publicacion y solicitudes de patrocinio." : "Primero crea tu cuenta. Despues completa estos requisitos para que ROIS pueda presentar tu perfil de forma institucional ante empresas."}</p>
        </div>
        <strong>${status.completed}/${status.total}</strong>
      </div>
      <div class="requirements-grid">
        ${status.items.map(item => `
          <div class="requirement-item ${item.done ? "done" : ""}">
            <span>${item.done ? "Listo" : "Pendiente"}</span>
            <strong>${item.label}</strong>
          </div>
        `).join("")}
      </div>
      <div class="optional-strip">
        ${status.optional.map(item => `<span class="${item.done ? "done" : ""}">${item.done ? "Cargado" : "Opcional"} · ${item.label}</span>`).join("")}
      </div>
      <form id="athleteRequirementsForm" class="form-grid">
        <label>Nombre deportivo<input name="name" required value="${escapeAttr(athlete.name || "")}"></label>
        <label>Disciplina<input name="sport" required value="${escapeAttr(athlete.sport === "Por definir" ? "" : athlete.sport || "")}" placeholder="Golf, tenis, automovilismo..."></label>
        <label>Categoria o nivel<input name="category" required value="${escapeAttr(athlete.category || "")}" placeholder="Profesional, semillero, alto rendimiento"></label>
        <label>Ciudad / base<input name="location" required value="${escapeAttr(athlete.location || "")}" placeholder="Ciudad, club o academia"></label>
        <label>Ranking o marca<input name="ranking" required value="${escapeAttr(athlete.ranking || "")}" placeholder="Ranking nacional, handicap, marca principal"></label>
        <label>Ticket mensual<input name="monthly" type="number" min="1000" required value="${Number(athlete.monthly || 5000)}"></label>
        <label>Maximo de patrocinadores<input name="max_sponsors" type="number" min="1" required value="${Number(athlete.max_sponsors || 3)}"></label>
        <label>Monto anual ROIS<input name="annual" type="number" min="1000" required value="${Number(athlete.annual || 1000)}"></label>
        <label style="grid-column:1/-1">Ficha tecnica<textarea name="stats" required placeholder="Resultados, calendario, metricas, logros, objetivo deportivo y narrativa para patrocinadores.">${escapeHtml(athlete.stats || "")}</textarea></label>
        <label style="grid-column:1/-1">Foto de perfil profesional<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <label style="grid-column:1/-1">Logos de sponsors actuales opcional<input name="sponsor_logo_files" type="file" accept="image/png,image/jpeg,image/webp" multiple></label>
        <label style="grid-column:1/-1">Nombre de marcas patrocinadoras opcional<textarea name="sponsor_logo_names" placeholder="Una marca por linea, en el mismo orden de los logos."></textarea></label>
        <label style="grid-column:1/-1">Video de competencias o entrenamientos opcional<input name="video_url" type="url" value="${escapeAttr(athlete.video_url || "")}" placeholder="YouTube, Vimeo, Drive o reel publicado"></label>
        <label style="grid-column:1/-1">Propuesta comercial PDF opcional<input name="proposal_pdf" type="file" accept="application/pdf"></label>
        ${athleteTermsBlock(athlete)}
        <div class="form-actions-row">
          <button class="btn primary full" type="submit">Guardar expediente</button>
          <button class="btn full" type="button" data-stripe-key="athleteAnnualProfile">Pagar perfil anual</button>
        </div>
      </form>
    </div>
  `);
  document.getElementById("athleteRequirementsForm").addEventListener("submit", submitAthleteRequirements);
  document.querySelector("[data-stripe-key='athleteAnnualProfile']")?.addEventListener("click", () => openStripeCheckout("athleteAnnualProfile", "Perfil Deportivo Anual ROIS"));
}

function renderAthleteNotifications() {
  const athlete = currentAthlete();
  const email = state.session?.email || "";
  const name = athlete?.name || state.session?.name || "";
  const notices = [
    ...state.data.sponsorships.filter(item => item.athlete === name || item.athlete_email === email).map(item => [`Patrocinio`, item.company || "Empresa ROIS", `$${Number(item.amount || 0).toLocaleString("es-MX")} MXN`, badge(item.status)]),
    ...state.data.athlete_deposits.filter(item => item.athlete_email === email).map(item => [`DepÃ³sito`, item.month || "Periodo", `$${Number(item.amount || 0).toLocaleString("es-MX")} MXN`, badge(item.status)]),
    ...state.data.athlete_results.filter(item => item.athlete_email === email && item.status === "review").map(item => [`Resultado`, item.month, "En revisiÃ³n ROIS", badge(item.status)])
  ];
  panel("athlete-notifications", "Notificaciones", "Alertas operativas de patrocinio y seguimiento", notices.length ? table(["Tipo", "Origen", "Detalle", "Estado"], notices) : `
    <div class="panel-body">
      <div class="empty">AÃºn no tienes notificaciones. Cuando una empresa solicite patrocinio o admin cargue depÃ³sitos, aparecerÃ¡n aquÃ­.</div>
    </div>
  `);
}

function renderAthleteProfile() {
  const athlete = currentAthlete();
  if (!athlete) {
    panel("athlete-profile", "Mi perfil", "Ficha deportiva", `<div class="empty">No encontramos una ficha deportiva vinculada a tu correo. Contacta a ROIS para asociarla.</div>`);
    return;
  }
  panel("athlete-profile", "Mi perfil", "Ficha pÃºblica y propuesta para empresas", `
    <div class="panel-body">
      <form id="athleteProfileForm" class="form-grid">
        <div class="company-logo-preview">
          <img src="${athlete.image_url || "./assets/rois-isotipo-cropped.png"}" alt="${escapeAttr(athlete.name)}">
          <span>${athlete.status === "approved" ? "Perfil aprobado" : "Pendiente de revisiÃ³n"}</span>
        </div>
        <label>Nombre<input name="name" required value="${escapeAttr(athlete.name || "")}"></label>
        <label>Deporte<input name="sport" required value="${escapeAttr(athlete.sport || "")}"></label>
        <label>CategorÃ­a<input name="category" value="${escapeAttr(athlete.category || "")}"></label>
        <label>Ciudad / base<input name="location" value="${escapeAttr(athlete.location || "")}"></label>
        <label>Ranking o marca<input name="ranking" value="${escapeAttr(athlete.ranking || "")}"></label>
        <label>Ticket mensual<input name="monthly" type="number" min="0" value="${Number(athlete.monthly || 5000)}"></label>
        <label>MÃ¡ximo de patrocinadores<input name="max_sponsors" type="number" min="1" value="${Number(athlete.max_sponsors || 3)}"></label>
        <label>Foto de perfil<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <label style="grid-column:1/-1">Ficha tÃ©cnica<textarea name="stats">${escapeHtml(athlete.stats || "")}</textarea></label>
        <button class="btn primary" type="submit">Guardar perfil</button>
      </form>
    </div>
  `);
  document.getElementById("athleteProfileForm").addEventListener("submit", submitAthleteProfile);
}

function renderAthleteSponsorships() {
  const athlete = currentAthlete();
  if (!athleteOnboardingComplete(athlete)) {
    athleteGate("athlete-sponsorships", "Patrocinios", "Solicitudes y condiciones propuestas por empresas");
    return;
  }
  const email = state.session?.email || "";
  const name = athlete?.name || state.session?.name || "";
  const rows = state.data.sponsorships.filter(item => item.athlete === name || item.athlete_email === email).map(item => [
    item.company || "Empresa en revisiÃ³n",
    `$${Number(item.amount || 0).toLocaleString("es-MX")} MXN`,
    item.details || "Condiciones por confirmar",
    badge(item.status)
  ]);
  panel("athlete-sponsorships", "Patrocinios", "Solicitudes y condiciones propuestas por empresas", rows.length ? table(["Empresa", "Monto", "Condiciones", "Estado"], rows) : `<div class="empty">Cuando una empresa solicite patrocinarte, aparecerÃ¡ aquÃ­.</div>`);
}

function renderAthleteResults() {
  if (!athleteOnboardingComplete()) {
    athleteGate("athlete-results", "Resultados mensuales", "Evidencia deportiva para reportar a patrocinadores");
    return;
  }
  const email = state.session?.email || "";
  const rows = state.data.athlete_results.filter(item => item.athlete_email === email).map(item => [
    item.month,
    item.summary,
    item.proof_url ? `<a class="btn" href="${item.proof_url}" target="_blank" rel="noopener">Ver soporte</a>` : badge("sin soporte"),
    badge(item.status)
  ]);
  panel("athlete-results", "Resultados mensuales", "Evidencia deportiva para reportar a patrocinadores", `
    <div class="panel-body">
      <form id="athleteResultForm" class="form-grid">
        <label>Mes<input name="month" required placeholder="Junio 2026"></label>
        <label>Competencia / actividad<input name="event" required placeholder="Torneo, ranking, entrenamiento medido"></label>
        <label style="grid-column:1/-1">Resultado documentado<textarea name="summary" required placeholder="Resultado, aprendizaje, avance y siguiente objetivo."></textarea></label>
        <label style="grid-column:1/-1">Documento o imagen soporte<input name="proof" type="file" accept="image/png,image/jpeg,image/webp,application/pdf"></label>
        <button class="btn primary" type="submit">Subir resultado</button>
      </form>
    </div>
    ${rows.length ? table(["Mes", "Resumen", "Soporte", "Estado"], rows) : `<div class="empty">AÃºn no has subido resultados mensuales.</div>`}
  `);
  document.getElementById("athleteResultForm").addEventListener("submit", submitAthleteResult);
}

function renderAthleteReels() {
  if (!athleteOnboardingComplete()) {
    athleteGate("athlete-reels", "Entrenamientos / Reels", "Contenido que puede mostrarse en el feed de empresas");
    return;
  }
  const email = state.session?.email || "";
  const rows = state.data.athlete_posts.filter(item => item.athlete_email === email).map(item => [
    item.title,
    item.caption || "Sin descripciÃ³n",
    item.video_url ? `<a class="btn" href="${item.video_url}" target="_blank" rel="noopener">Ver reel</a>` : badge("pendiente"),
    badge(item.status)
  ]);
  panel("athlete-reels", "Entrenamientos / Reels", "Contenido que puede mostrarse en el feed de empresas", `
    <div class="panel-body">
      <form id="athletePostForm" class="form-grid">
        <label>TÃ­tulo<input name="title" required placeholder="Entrenamiento de potencia"></label>
        <label>Link de video<input name="video_url" type="url" required placeholder="YouTube, Vimeo, Drive o reel publicado"></label>
        <label style="grid-column:1/-1">DescripciÃ³n<textarea name="caption" required placeholder="Contexto deportivo y valor para patrocinadores."></textarea></label>
        <label style="grid-column:1/-1">Imagen miniatura opcional<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <button class="btn primary" type="submit">Enviar a revisiÃ³n</button>
      </form>
    </div>
    ${rows.length ? table(["TÃ­tulo", "DescripciÃ³n", "Video", "Estado"], rows) : `<div class="empty">AÃºn no has enviado reels a revisiÃ³n.</div>`}
  `);
  document.getElementById("athletePostForm").addEventListener("submit", submitAthletePost);
}

function renderAthleteExpenses() {
  if (!athleteOnboardingComplete()) {
    athleteGate("athlete-expenses", "Tickets y facturas", "Consumos realizados con tarjeta y facturados a la empresa patrocinadora");
    return;
  }
  const email = state.session?.email || "";
  const rows = state.data.athlete_expenses.filter(item => item.athlete_email === email).map(item => [
    item.date || "Sin fecha",
    item.category,
    `$${Number(item.amount || 0).toLocaleString("es-MX")} MXN`,
    item.invoice_url ? `<a class="btn" href="${item.invoice_url}" target="_blank" rel="noopener">Factura</a>` : badge("sin factura"),
    item.ticket_url ? `<a class="btn" href="${item.ticket_url}" target="_blank" rel="noopener">Ticket</a>` : badge("sin ticket"),
    badge(item.status)
  ]);
  panel("athlete-expenses", "Tickets y facturas", "Consumos realizados con tarjeta y facturados a la empresa patrocinadora", `
    <div class="panel-body">
      <form id="athleteExpenseForm" class="form-grid">
        <label>Fecha<input name="date" type="date" required></label>
        <label>CategorÃ­a<select name="category"><option>Transporte</option><option>Hospedaje</option><option>Alimentos</option><option>Equipo deportivo</option><option>InscripciÃ³n / torneo</option><option>Entrenamiento</option><option>Otro</option></select></label>
        <label>Monto<input name="amount" type="number" min="0" step="0.01" required></label>
        <label>Empresa patrocinadora<input name="company" placeholder="Nombre de empresa"></label>
        <label style="grid-column:1/-1">Ticket de consumo<input name="ticket" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" required></label>
        <label style="grid-column:1/-1">Factura<input name="invoice" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required></label>
        <label style="grid-column:1/-1">Notas<textarea name="notes" placeholder="Describe el consumo y a quÃ© objetivo deportivo corresponde."></textarea></label>
        <button class="btn primary" type="submit">Subir comprobantes</button>
      </form>
    </div>
    ${rows.length ? table(["Fecha", "CategorÃ­a", "Monto", "Factura", "Ticket", "Estado"], rows) : `<div class="empty">AÃºn no has subido tickets ni facturas.</div>`}
  `);
  document.getElementById("athleteExpenseForm").addEventListener("submit", submitAthleteExpense);
}

function renderAthleteDeposits() {
  if (!athleteOnboardingComplete()) {
    athleteGate("athlete-deposits", "Depositos", "Comprobantes cargados por administracion ROIS");
    return;
  }
  const email = state.session?.email || "";
  const rows = state.data.athlete_deposits.filter(item => item.athlete_email === email).map(item => [
    item.month || "Periodo",
    `$${Number(item.amount || 0).toLocaleString("es-MX")} MXN`,
    item.company || "ROIS",
    item.proof_url ? `<a class="btn" href="${item.proof_url}" target="_blank" rel="noopener">Comprobante</a>` : badge("pendiente"),
    badge(item.status)
  ]);
  panel("athlete-deposits", "DepÃ³sitos", "Comprobantes cargados por administraciÃ³n ROIS", rows.length ? table(["Periodo", "Monto", "Origen", "Comprobante", "Estado"], rows) : `<div class="empty">Admin cargarÃ¡ aquÃ­ los comprobantes de depÃ³sitos realizados.</div>`);
}

function renderAdmin() {
  renderAdminKpis();
  renderAdminUsers();
  renderAdminAthletes();
  renderAdminEvents();
  renderAdminNews();
  renderAdminPartners();
  renderAdminCrm();
  renderAdminPayments();
  renderAdminUploads();
  renderAdminStats();
  renderAccountSettings("admin-settings");
}

function renderAdminKpis() {
  const pendingUsers = state.data.profiles.filter(item => item.status === "pending").length + state.data.companies.filter(item => item.status === "pending").length;
  const paid = state.data.payments.filter(item => item.status === "paid").reduce((sum, item) => sum + Number(item.amount), 0);
  document.getElementById("adminKpis").innerHTML = [
    ["Pendientes", pendingUsers],
    ["Pagos", `$${paid.toLocaleString("es-MX")}`],
    ["CRM", state.data.crm.length]
  ].map(([label, value]) => `<div class="kpi"><span>${label}</span><strong>${value}</strong></div>`).join("");
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
  panel("admin-athletes", "Deportistas", "Alta, visuales y aprobaciones", `
    <div class="panel-body">
      <form id="adminAthleteForm" class="form-grid">
        <label>Nombre<input name="name" required placeholder="Nombre del deportista"></label>
        <label>Deporte<input name="sport" required placeholder="Disciplina"></label>
        <label>CategorÃ­a<input name="category" required placeholder="Ej. Juvenil, amateur, profesional"></label>
        <label>Ciudad / base<input name="location" required placeholder="Ciudad o club base"></label>
        <label>Ranking o marca<input name="ranking" placeholder="Ranking, handicap, marca o nivel"></label>
        <label>Monto anual<input name="annual" type="number" min="0" value="1000" required></label>
        <label>Ticket mensual<input name="monthly" type="number" min="0" value="5000" required></label>
        <label>MÃ¡ximo de patrocinadores<input name="max_sponsors" type="number" min="1" value="3" required></label>
        <label style="grid-column:1/-1">Link de pago individual Stripe<input name="sponsor_payment_url" type="url" placeholder="https://buy.stripe.com/..."></label>
        <label style="grid-column:1/-1">Logos de sponsors actuales<input name="sponsor_logo_files" type="file" accept="image/png,image/jpeg,image/webp" multiple></label>
        <label style="grid-column:1/-1">Nombre de marcas patrocinadoras opcional<textarea name="sponsor_logo_names" placeholder="Una marca por lÃ­nea, en el mismo orden de los logos. Ej. ROIS Trade"></textarea></label>
        <label style="grid-column:1/-1">Ficha tÃ©cnica<textarea name="stats" required placeholder="Resultados, calendario, mÃ©tricas, logros y objetivo deportivo"></textarea></label>
        <label style="grid-column:1/-1">Condiciones autorizadas para patrocinadores<textarea name="sponsor_terms" placeholder="Una condiciÃ³n por lÃ­nea. Ej. MenciÃ³n mensual en redes sociales"></textarea></label>
        <label style="grid-column:1/-1">Video de competencias o entrenamientos opcional<input name="video_url" type="url" placeholder="https://youtube.com/... o https://vimeo.com/..."></label>
        <label style="grid-column:1/-1">Propuesta comercial PDF opcional<input name="proposal_pdf" type="file" accept="application/pdf"></label>
        <label style="grid-column:1/-1">Imagen del deportista<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <button class="btn primary" type="submit">Crear deportista</button>
      </form>
      <p class="hint">Las imÃ¡genes nuevas quedan en revisiÃ³n visual. No aparecen pÃºblicamente hasta aprobarse.</p>
    </div>
    ${table(["Visual", "Nombre", "Deporte", "Ticket", "Cupo", "Propuesta", "Pago", "Visual", "Acciones"], state.data.athletes.map(athlete => [
      visualThumb(athlete), athlete.name, athlete.sport, `$${Number(athlete.monthly || 5000).toLocaleString("es-MX")} MXN`, `${athleteSponsorLogos(athlete).length}/${athlete.max_sponsors || 3}`, athlete.proposal_url ? badge("PDF") : badge("pendiente"), athlete.sponsor_payment_url ? badge("link activo") : badge("sin link"), badge(athlete.visual_status || "sin visual"), moderationActions("athletes", athlete)
    ]))}
  `);
  document.getElementById("adminAthleteForm").addEventListener("submit", submitAdminAthlete);
}

function renderAdminEvents() {
  panel("admin-events", "Eventos", "Alta, visuales y aprobaciÃ³n", `
    <div class="panel-body">
      <form id="adminEventForm" class="form-grid">
        <label>Evento<input name="name" required placeholder="Nombre del evento"></label>
        <label>CategorÃ­a<input name="category" required placeholder="Ejecutivo, sponsor, membresÃ­a"></label>
        <label>Sede<input name="venue" required placeholder="Sede o ciudad"></label>
        <label>Fecha<input name="date" required placeholder="Por confirmar"></label>
        <label style="grid-column:1/-1">Brochure PDF<input name="brochure_pdf" type="file" accept="application/pdf"></label>
        <label style="grid-column:1/-1">Alcance y posicionamiento del evento<textarea name="event_scope" required placeholder="Resume audiencia, alcance, sectores, tomadores de decisiÃ³n, medios, impacto esperado y por quÃ© una empresa deberÃ­a considerar este evento."></textarea></label>
        <label style="grid-column:1/-1">Imagen del evento<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <button class="btn primary" type="submit">Crear evento</button>
      </form>
      <p class="hint">El evento y su imagen pasan por revisiÃ³n antes de publicarse.</p>
    </div>
    ${table(["Visual", "Evento", "Sede", "Brochure", "Estado", "Visual", "Acciones"], state.data.events.map(event => [
      visualThumb(event), event.name, event.venue, event.brochure_url ? badge("PDF") : badge("pendiente"), badge(event.status), badge(event.visual_status || "sin visual"), moderationActions("events", event)
    ]))}
  `);
  document.getElementById("adminEventForm").addEventListener("submit", submitAdminEvent);
}

function renderAdminNews() {
  panel("admin-news", "Noticias", "GestiÃ³n editorial", `
    <div class="panel-body">
      <form id="newsForm" class="form-grid">
        <label>TÃ­tulo<input name="title" required placeholder="Titular privado"></label>
        <label>Estado<select name="status"><option value="published">Publicado</option><option value="draft">Borrador</option></select></label>
        <label style="grid-column:1/-1">Resumen<textarea name="summary" required placeholder="Resumen para miembros."></textarea></label>
        <label style="grid-column:1/-1">Imagen de noticia<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <button class="btn primary" type="submit">Publicar</button>
      </form>
      <p class="hint">Aunque el texto estÃ© publicado, una noticia con imagen no aparece pÃºblicamente hasta aprobar el visual.</p>
    </div>
    ${table(["Visual", "TÃ­tulo", "Estado", "Visual", "Acciones"], state.data.news.map(item => [
      visualThumb(item), item.title, badge(item.status), badge(item.visual_status || "sin visual"), moderationActions("news", item)
    ]))}
  `);
  document.getElementById("newsForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const image_url = await fileToDataUrl(form.image.files[0]);
    await api.insert("news", { title: form.title.value, summary: form.summary.value, status: form.status.value, image_url, visual_status: image_url ? "pending_review" : "approved" });
    notify("Noticias", "Nota creada", "La nota quedÃ³ disponible en el mÃ³dulo editorial.");
    renderAdmin();
    renderPublic();
  });
}

function renderAdminPartners() {
  panel("admin-partners", "Patrocinadores", "Sponsors clave y red estratÃ©gica visible en home", `
    <div class="panel-body">
      <form id="partnerForm" class="form-grid">
        <label>Nombre<input name="name" required placeholder="Empresa, sponsor o aliado"></label>
        <label>Tipo<select name="type"><option>Alianza estratÃ©gica</option><option>Sponsor principal</option><option>Partner institucional</option><option>Media partner</option></select></label>
        <label>Nivel<select name="tier"><option>Principal</option><option>EstratÃ©gico</option><option>Institucional</option><option>Comunidad</option></select></label>
        <label>Sitio web<input name="url" type="url" placeholder="https://empresa.com"></label>
        <label>Estado<select name="status"><option value="approved">Visible en home</option><option value="pending">Pendiente</option></select></label>
        <label style="grid-column:1/-1">DescripciÃ³n<textarea name="description" required placeholder="Describe la alianza, sponsor o relaciÃ³n estratÃ©gica."></textarea></label>
        <label style="grid-column:1/-1">Logo o visual<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <button class="btn primary" type="submit">Guardar alianza</button>
      </form>
      <p class="hint">Los logos y visuales nuevos quedan en revisiÃ³n visual antes de mostrarse pÃºblicamente.</p>
    </div>
    ${table(["Visual", "Nombre", "Tipo", "Nivel", "Estado", "Visual", "Acciones"], state.data.partnerships.map(partner => [
      visualThumb(partner), partner.name, partner.type, partner.tier, badge(partner.status), badge(partner.visual_status || "sin visual"), moderationActions("partnerships", partner)
    ]))}
  `);
  document.getElementById("partnerForm").addEventListener("submit", submitAdminPartner);
}

function renderAdminCrm() {
  panel("admin-crm", "CRM", "Pipeline de relaciones", table(["CategorÃ­a", "Volumen", "Estado", "AcciÃ³n"], state.data.crm.map(item => [
    item.name, item.volume, badge(item.status), button("Avanzar", () => updateCrm(item.id))
  ])));
}

function renderAdminPayments() {
  panel("admin-payments", "Pagos", "Resumen financiero conectado a Stripe", table(["Concepto", "Monto", "Estado", "AcciÃ³n"], state.data.payments.map(payment => [
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
  panel("admin-payments", "Pagos", "Stripe, depÃ³sitos y comprobantes", `
    <div class="panel-body">
      <form id="adminDepositForm" class="form-grid">
        <label>Deportista<select name="athlete_email" required><option value="">Selecciona deportista</option>${athleteOptions}</select></label>
        <label>Periodo<input name="month" required placeholder="Junio 2026"></label>
        <label>Monto depositado<input name="amount" type="number" min="0" step="0.01" required></label>
        <label>Empresa origen<input name="company" placeholder="Empresa patrocinadora"></label>
        <label style="grid-column:1/-1">Comprobante de depÃ³sito<input name="proof" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" required></label>
        <button class="btn primary" type="submit">Cargar depÃ³sito</button>
      </form>
    </div>
    ${table(["Concepto", "Monto", "Estado", "AcciÃ³n"], state.data.payments.map(payment => [
      payment.concept, `$${Number(payment.amount).toLocaleString("es-MX")} MXN`, badge(payment.status), payment.status === "paid" ? "Pagado" : button("Marcar pagado", () => markPaid(payment.id))
    ]))}
    <div class="panel-body"><p class="eyebrow">DepÃ³sitos a deportistas</p></div>
    ${deposits.length ? table(["Deportista", "Periodo", "Monto", "Comprobante", "Estado"], deposits) : `<div class="empty">No hay depÃ³sitos cargados todavÃ­a.</div>`}
  `);
  document.getElementById("adminDepositForm").addEventListener("submit", submitAdminDeposit);
}

function renderAdminUploads() {
  panel("admin-uploads", "Uploads", "Biblioteca y moderaciÃ³n visual", `
    <div class="panel-body">
      <form id="uploadForm" class="form-grid">
        <label>Archivo visual<input name="file" type="file" accept="image/png,image/jpeg,image/webp" required></label>
        <label>Tipo<select name="type"><option>Evento</option><option>Deportista</option><option>Contrato</option><option>Documento</option></select></label>
        <button class="btn primary" type="submit">Registrar upload</button>
      </form>
      <p class="hint">Todo visual subido queda bloqueado hasta revisiÃ³n manual. En producciÃ³n debe sumarse moderaciÃ³n automÃ¡tica.</p>
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
    notify("Uploads", "Archivo registrado", "El visual quedÃ³ pendiente de revisiÃ³n.");
    renderAdmin();
  });
}

function renderAdminUploads() {
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
  panel("admin-uploads", "Uploads", "ModeraciÃ³n de visuales, reels, resultados y comprobantes", `
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
    <div class="panel-body"><p class="eyebrow">Reels de deportistas</p></div>
    ${postRows.length ? table(["Visual", "Deportista", "TÃ­tulo", "Video", "Estado", "Acciones"], postRows) : `<div class="empty">No hay reels pendientes.</div>`}
    <div class="panel-body"><p class="eyebrow">Resultados mensuales</p></div>
    ${resultRows.length ? table(["Deportista", "Mes", "Resumen", "Soporte", "Estado", "Acciones"], resultRows) : `<div class="empty">No hay resultados enviados.</div>`}
    <div class="panel-body"><p class="eyebrow">Tickets y facturas</p></div>
    ${expenseRows.length ? table(["Deportista", "CategorÃ­a", "Monto", "Factura", "Ticket", "Estado", "Acciones"], expenseRows) : `<div class="empty">No hay comprobantes enviados.</div>`}
  `);
  document.getElementById("uploadForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.file.files[0];
    const image_url = await fileToDataUrl(file);
    await api.insert("uploads", { name: file.name, type: form.type.value, size: file.size, status: "registered", image_url, visual_status: "pending_review" });
    notify("Uploads", "Archivo registrado", "El visual quedÃ³ pendiente de revisiÃ³n.");
    renderAdmin();
  });
}

function renderAdminStats() {
  const approvedUsers = state.data.profiles.filter(item => item.status === "approved").length;
  const totalUsers = state.data.profiles.length || 1;
  const sponsorReview = state.data.sponsorships.filter(item => item.status === "review").length;
  panel("admin-stats", "EstadÃ­sticas", "Indicadores operativos", table(["MÃ©trica", "Valor", "Lectura"], [
    ["ConversiÃ³n de aprobaciÃ³n", `${Math.round((approvedUsers / totalUsers) * 100)}%`, badge("estable")],
    ["Demanda de eventos", state.data.requests.length, badge("activa")],
    ["Patrocinios en revisiÃ³n", sponsorReview, badge("prioridad")]
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
    actions.push(`<span class="hint inline">SesiÃ³n activa</span>`);
  } else {
    actions.push(button("Eliminar", () => confirmDeleteUser(user, tableName)));
  }
  return actionGroup(actions);
}

async function createRequest(type, title) {
  await api.insert("requests", { type, title, owner: state.session?.name || "Empresa", status: "review" });
  notify("Solicitud", "Solicitud creada", "El registro ya aparece en Estado Solicitudes.");
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
    max_sponsors: Number(form.max_sponsors.value || 3),
    video_url: form.video_url.value.trim(),
    terms_accepted: Boolean(form.terms_accepted.checked)
  };
  if (imageFile) {
    patch.image_url = await fileToDataUrl(imageFile);
    patch.visual_status = "pending_review";
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
  notify("Expediente deportivo", "Requisitos guardados", "ROIS revisara los visuales y activara el perfil para operaciones con empresas.");
  renderAthlete();
  renderAdmin();
  renderPublic();
}

async function submitAthleteProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const athlete = currentAthlete();
  if (!athlete) return;
  const imageFile = form.image.files[0];
  const patch = {
    name: form.name.value.trim(),
    sport: form.sport.value.trim(),
    category: form.category.value.trim(),
    location: form.location.value.trim(),
    ranking: form.ranking.value.trim(),
    monthly: Number(form.monthly.value || 5000),
    max_sponsors: Number(form.max_sponsors.value || 3),
    stats: form.stats.value.trim()
  };
  if (imageFile) {
    patch.image_url = await fileToDataUrl(imageFile);
    patch.visual_status = "pending_review";
  }
  await api.update("athletes", athlete.id, patch);
  state.session = { ...state.session, name: patch.name };
  saveSession(state.session);
  notify("Perfil deportivo", "Perfil actualizado", imageFile ? "La nueva foto queda pendiente de revisiÃ³n visual ROIS." : "Tu ficha deportiva fue actualizada.");
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
  notify("Resultados", "Resultado enviado", "ROIS revisarÃ¡ el soporte antes de integrarlo al reporte para patrocinadores.");
  renderAthlete();
}

async function submitAthletePost(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const athlete = currentAthlete();
  const image_url = await fileToDataUrl(form.image.files[0]);
  await api.insert("athlete_posts", {
    athlete_id: athlete?.id,
    athlete_email: state.session.email,
    athlete_name: athlete?.name || state.session.name,
    title: form.title.value,
    caption: form.caption.value,
    video_url: form.video_url.value,
    image_url,
    status: "pending_review",
    visual_status: image_url ? "pending_review" : "approved"
  });
  notify("Entrenamientos", "Reel enviado", "El contenido queda pendiente de aprobaciÃ³n antes de aparecer en el feed de empresas.");
  renderAthlete();
  renderAdmin();
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
  notify("Tickets y facturas", "Comprobantes enviados", "ROIS revisarÃ¡ que los consumos estÃ©n soportados y facturados correctamente.");
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
  notify("Eventos", "Paquete solicitado", "ROIS revisarÃ¡ disponibilidad, beneficios y condiciones del patrocinio del evento.");
  renderClient();
  renderAdmin();
}

async function createSponsorship(athlete, amount, details = "", paymentUrl = "") {
  const athleteRecord = state.data.athletes.find(item => item.name === athlete);
  await api.insert("sponsorships", { athlete, athlete_email: athleteRecord?.email || "", amount, company: state.session?.name || "Empresa", details, status: "review" });
  await api.insert("requests", {
    type: "Patrocinio deportista",
    title: athlete,
    owner: state.session?.name || "Empresa",
    details,
    priority: `$${Number(amount).toLocaleString("es-MX")} MXN`,
    status: "review"
  });
  await api.insert("payments", { concept: `Patrocinio mensual - ${athlete}`, amount, company: state.session?.name || "Empresa", status: "pending", product_key: "" });
  notify("Sponsor", "Patrocinio solicitado", "La solicitud fue enviada a revisiÃ³n.");
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
  notify("AprobaciÃ³n", "Elemento aprobado", "El estado fue actualizado correctamente.");
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
  notify("Usuarios", "Cliente aprobado", "El acceso quedÃ³ autorizado para el dashboard de cliente.");
  renderAdmin();
  renderPublic();
}

async function confirmDeleteUser(user, tableName) {
  const confirmed = window.confirm(`Â¿Eliminar el usuario "${user.name}"? Esta acciÃ³n no se puede deshacer en modo real.`);
  if (!confirmed) return;
  await api.remove(tableName, user.id);
  notify("Usuarios", "Usuario eliminado", "El usuario fue eliminado del panel administrativo.");
  renderAdmin();
}

async function updateCrm(id) {
  await api.update("crm", id, { status: "En seguimiento" });
  notify("CRM", "Pipeline actualizado", "El elemento cambiÃ³ a seguimiento.");
  renderAdmin();
}

async function markPaid(id) {
  await api.update("payments", id, { status: "paid" });
  notify("Pagos", "Pago actualizado", "El pago fue marcado como pagado.");
  renderAdmin();
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
  notify("DepÃ³sitos", "Comprobante cargado", "El deportista ya puede ver el comprobante en su dashboard.");
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
    annual: Number(form.annual.value || 1000),
    monthly: Number(form.monthly.value || 5000),
    max_sponsors: Number(form.max_sponsors.value || 3),
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
  notify("Deportistas", "Deportista creado", "El perfil quedÃ³ pendiente de aprobaciÃ³n y revisiÃ³n visual.");
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
  notify("Eventos", "Evento creado", "El evento quedÃ³ pendiente de aprobaciÃ³n y revisiÃ³n visual.");
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
  notify("Alianzas", "Alianza guardada", "El registro quedÃ³ disponible para aprobaciÃ³n y revisiÃ³n visual.");
  renderAdmin();
  renderPublic();
}

async function approveVisual(tableName, item) {
  await api.update(tableName, item.id, { visual_status: "approved", visual_notes: "" });
  notify("ModeraciÃ³n visual", "Visual aprobado", "El visual ya puede mostrarse en Ã¡reas pÃºblicas si el contenido tambiÃ©n estÃ¡ aprobado.");
  renderAdmin();
  renderPublic();
}

async function rejectVisual(tableName, item) {
  await api.update(tableName, item.id, { visual_status: "rejected", status: item.status === "published" ? "draft" : item.status, visual_notes: "Rechazado por revisiÃ³n manual" });
  notify("ModeraciÃ³n visual", "Visual rechazado", "El visual quedÃ³ bloqueado y no se mostrarÃ¡ pÃºblicamente.");
  renderAdmin();
  renderPublic();
}

async function deleteContent(tableName, item) {
  const confirmed = window.confirm(`Â¿Eliminar "${item.name || item.title}"?`);
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
  const confirmed = window.confirm(`Â¿Bajar "${label}" del home y dashboard cliente?`);
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
  const scope = event.event_scope || event.sponsor_levels || "Alcance comercial pendiente de publicaciÃ³n por ROIS.";
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
    item.type === "InteracciÃ³n noticia" &&
    item.priority === reaction &&
    String(item.details || "").includes(`news:${news.id}`)
  ).length;
}

function newsInteractionBar(news) {
  const reactions = [
    ["Like", "Me gusta"],
    ["InterÃ©s", "Me interesa"],
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
    type: "InteracciÃ³n noticia",
    title: news.title,
    owner: state.session?.name || "Empresa",
    details: `news:${news.id} | ${reaction}${note ? ` | ${note}` : ""}`,
    priority: reaction,
    status: "recorded"
  });
  notify("Noticias", "InteracciÃ³n registrada", reaction === "Compartir" ? "Copiamos el enlace de noticias y registramos tu interacciÃ³n." : "Tu interacciÃ³n quedÃ³ registrada para el equipo ROIS.");
  renderClient();
  renderAdmin();
}

function athleteSponsorConditions() {
  return [
    "Logo en uniforme o equipo autorizado",
    "MenciÃ³n mensual en redes sociales",
    "Video corto de agradecimiento para la marca",
    "Uso de imagen del deportista en campaÃ±a aprobada",
    "Presencia en evento corporativo o clÃ­nica deportiva",
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
          <textarea name="notes" placeholder="Objetivo de marca, giro, restricciones o campaÃ±a deseada."></textarea>
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
        <p>${text || "InformaciÃ³n disponible para miembros aprobados."}</p>
        ${action || ""}
      </div>
    </article>
  `;
}

function athleteFeedCard(post) {
  const athlete = state.data.athletes.find(item => item.id === post.athlete_id || item.email === post.athlete_email || item.name === post.athlete_name);
  const image = post.image_url || athlete?.image_url || "./assets/rois-isotipo-cropped.png";
  return `
    <article class="feed-card">
      <div class="feed-media">
        <img src="${image}" alt="${post.title}">
      </div>
      <div class="feed-content">
        <p class="eyebrow">${athlete?.sport || "Entrenamiento"}</p>
        <h3>${post.title}</h3>
        <p>${post.caption || "ActualizaciÃ³n deportiva publicada por atleta ROIS."}</p>
        <div class="row-meta">
          <span class="pill">${post.athlete_name || athlete?.name || "Atleta ROIS"}</span>
          <div class="athlete-actions">
            ${post.video_url ? `<a class="btn" href="${post.video_url}" target="_blank" rel="noopener">Ver reel</a>` : ""}
            ${athlete ? button("Ver perfil", () => openAthleteProfileModal(athlete)) : ""}
            ${athlete ? button("Solicitar patrocinio", () => openAthleteSponsorConfigurator(athlete)) : ""}
          </div>
        </div>
      </div>
    </article>
  `;
}

function openAthleteProfileModal(athlete) {
  notify(
    "Perfil deportivo",
    athlete.name,
    `${athlete.stats || "Perfil deportivo en evaluaciÃ³n."} Ticket mensual sugerido: $${athleteMonthlyTicket(athlete).toLocaleString("es-MX")} MXN.`,
    `<div class="modal-actions">${athleteProposalLink(athlete)}${athlete.video_url ? `<a class="btn" href="${athlete.video_url}" target="_blank" rel="noopener">Ver video</a>` : ""}${button("Configurar patrocinio", () => openAthleteSponsorConfigurator(athlete))}</div>`
  );
}

function partnerCard(partner) {
  const image = partner.image_url || "./assets/rois-logo-cropped.png";
  const link = partner.url ? `<a class="btn" href="${partner.url}" target="_blank" rel="noopener">Ver aliado</a>` : `<button class="btn" type="button" data-open-login>Solicitar conexiÃ³n</button>`;
  return `
    <article class="partner-card">
      <div class="partner-mark">
        <img src="${image}" alt="${partner.name}">
      </div>
      <div class="partner-content">
        <div>
          <p class="eyebrow">${partner.tier || "Aliado ROIS"}</p>
          <h3>${partner.name}</h3>
          <p>${partner.description || "Aliado estratÃ©gico dentro del ecosistema ROIS."}</p>
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
    text: partner.description || "Sponsor o aliado estratÃ©gico publicado por ROIS.",
    action: partner.url
      ? `<a class="btn" href="${partner.url}" target="_blank" rel="noopener">Ver aliado</a>`
      : button("Solicitar conexiÃ³n", () => createRequest("ConexiÃ³n sponsor", partner.name))
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
      priority: tier.amount >= 100000 ? "DirecciÃ³n ROIS" : "Comercial"
    });
    await api.insert("payments", {
      concept: `${tier.name} - mensualidad`,
      amount: tier.amount,
      company: state.session?.name || "Empresa",
      status: "pending",
      product_key: tier.productKey
    });
    if (!checkoutStarted) {
      notify("Patrocinios ROIS", "Solicitud recibida", `Falta configurar el link de Stripe para ${tier.name}. ROIS prepararÃ¡ la activaciÃ³n y el cierre comercial.`);
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
    return Array.isArray(logos) ? logos.filter(logo => logo?.image) : [];
  } catch {
    return [];
  }
}

function athleteProposalLink(athlete) {
  if (!athlete.proposal_url) return "";
  const filename = athlete.proposal_name || `${athlete.name || "propuesta-deportista"}.pdf`;
  return `<a class="btn" href="${athlete.proposal_url}" target="_blank" rel="noopener" download="${filename}">Ver propuesta</a>`;
}

function athleteCard(athlete, action) {
  const image = athlete.image_url || "./assets/rois-isotipo-cropped.png";
  const annual = athleteInvestment(athlete).toLocaleString("es-MX");
  const monthly = athleteMonthlyTicket(athlete).toLocaleString("es-MX");
  const logos = athleteSponsorLogos(athlete);
  const maxSponsors = Number(athlete.max_sponsors || 3);
  const videoButton = athlete.video_url ? `<a class="btn" href="${athlete.video_url}" target="_blank" rel="noopener">Ver video</a>` : "";
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
          <p class="athlete-summary">${athlete.stats || "Perfil deportivo en evaluaciÃ³n."}</p>
          ${logos.length ? `
            <div class="athlete-sponsor-brands">
              <span>Patrocinadores actuales</span>
              <div>${logos.map(logo => `<img src="${logo.image}" alt="${logo.name || "Sponsor"}">`).join("")}</div>
            </div>
          ` : ""}
        </div>
        <div class="athlete-technical">
          <div><span>Deporte</span><strong>${athlete.sport || "Por definir"}</strong></div>
          <div><span>CategorÃ­a</span><strong>${athlete.category || "Semilla"}</strong></div>
          <div><span>Base</span><strong>${athlete.location || "Por confirmar"}</strong></div>
          <div><span>Ranking / marca</span><strong>${athlete.ranking || "En evaluaciÃ³n"}</strong></div>
        </div>
        <div class="athlete-metrics">
          <div><span>Ticket mensual</span><strong>$${monthly} MXN</strong></div>
          <div><span>Cupos de sponsor</span><strong>${logos.length}/${maxSponsors}</strong></div>
        </div>
        <div class="athlete-decision">
          <p>Ideal para marcas que buscan visibilidad temprana, narrativa deportiva y relaciÃ³n directa con talento en crecimiento. InversiÃ³n anual de perfil: $${annual} MXN.</p>
          <div class="athlete-actions">${proposalButton}${videoButton}${action}</div>
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
  const files = Array.from(fileList || []);
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
  const title = type === "company" ? "Crear cuenta de empresa" : type === "athlete" ? "Registro de deportista" : "Registro de evento";
  document.getElementById("registrationKicker").textContent = "Registro ROIS";
  document.getElementById("registrationTitle").textContent = title;
  document.getElementById("registrationForm").innerHTML = registrationFields(type);
  document.getElementById("registrationModal").classList.add("active");
}

function registrationFields(type) {
  if (type === "company") {
    return `
      <label>Empresa<input name="name" required placeholder="Nombre legal o comercial"></label>
      <label>Correo de acceso<input name="email" type="email" required placeholder="contacto@empresa.com"></label>
      <label>Contacto<input name="contact" required placeholder="Nombre del responsable"></label>
      <label>InterÃ©s principal<select name="interest"><option>Eventos</option><option>Sponsors</option><option>Deportistas</option><option>Relaciones estratÃ©gicas</option></select></label>
      <label>Contrasena<input name="password" type="password" minlength="8" autocomplete="new-password" required placeholder="Minimo 8 caracteres"></label>
      <label>Confirmar contrasena<input name="confirm" type="password" minlength="8" autocomplete="new-password" required placeholder="Repite tu contrasena"></label>
      <p class="hint">La cuenta se activa como cliente ROIS. Las operaciones premium pueden requerir revisiÃ³n interna.</p>
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
      <label>Contrasena<input name="password" type="password" minlength="8" autocomplete="new-password" required placeholder="Minimo 8 caracteres"></label>
      <label>Confirmar contrasena<input name="confirm" type="password" minlength="8" autocomplete="new-password" required placeholder="Repite tu contrasena"></label>
      <div class="registration-note" style="grid-column:1/-1">
        <p class="eyebrow">Alta deportiva</p>
        <p>Despues de crear tu cuenta entraras a tu dashboard para completar expediente, terminos de representacion, foto, ficha tecnica, propuesta, videos y documentos operativos.</p>
      </div>
      <label class="check-option" style="grid-column:1/-1">
        <input name="terms" type="checkbox" required>
        <span>Acepto crear mi cuenta deportiva en ROIS y completar el expediente contractual y operativo administrado por ${roisLegalEntity} antes de recibir solicitudes de patrocinio.</span>
      </label>
      <button class="btn primary full" type="submit">Crear cuenta deportiva</button>
    `;
  }
  return `
    <label>Evento<input name="name" required placeholder="Nombre del evento"></label>
    <label>CategorÃ­a<input name="category" required placeholder="Ejecutivo, patrocinio, membresÃ­a"></label>
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
        notify("Registro", "Las contraseÃ±as no coinciden", "Confirma la contraseÃ±a para crear tu cuenta.");
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
        notify("Cuenta creada", "Bienvenido a ROIS", "Tu dashboard de cliente ya estÃ¡ activo.");
      } else {
        showVerificationNotice(signup.email || form.email.value);
      }
      renderAdmin();
      renderPublic();
      return;
    } else if (type === "athlete") {
      if (form.password.value !== form.confirm.value) {
        notify("Registro", "Las contraseÃ±as no coinciden", "Confirma la contraseÃ±a para crear tu cuenta de deportista.");
        return;
      }
      const signup = await api.signupAthlete({
        email: form.email.value,
        password: form.password.value,
        name: form.name.value
      });
      closeModals();
      if (signup.confirmed) {
        state.session = signup.session;
        saveSession(state.session);
        renderSession();
        renderAthlete();
        showView("athlete");
        notify("Perfil deportivo", "Bienvenido a ROIS", "Completa tus requisitos dentro del panel para activar operaciones y revision de patrocinio.");
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
    notify("Registro", "Solicitud recibida", "El registro quedÃ³ pendiente de aprobaciÃ³n en el panel administrador.");
    if (paymentAction) {
      openStripeCheckout(paymentAction[0], paymentAction[1]);
    }
    renderAdmin();
    renderPublic();
  } catch (error) {
    notify("Registro", "No fue posible registrar", humanError(error));
  }
}


