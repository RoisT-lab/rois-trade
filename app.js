const config = window.ROIS_CONFIG || {};
const roisBuild = "20260608-revolut-mobile-v7";
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
  uploads: []
};

const api = demoMode ? demoApi() : supabaseApi();

init();

function normalizedRole(email, role) {
  if (role !== "admin") return "client";
  if (!demoMode) return "admin";
  return adminEmail && email?.toLowerCase() === adminEmail ? "admin" : "client";
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
    notify("Recuperación", "Enlace no válido", "Solicita un nuevo enlace para cambiar tu contraseña.");
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
  if (isCompany) {
    state.session = { ...state.session, role: "client" };
  }
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
  if (state.session) showView(state.session.role === "admin" ? "admin" : "client");
}

function applyBranding() {
  document.querySelectorAll(".brand-logo, .side-logo").forEach(image => {
    image.src = fixedLogoPath;
    image.hidden = false;
    image.closest(".brand, .sidebar")?.classList.remove("logo-fallback");
  });
}

function handleMissingImages() {
  document.querySelectorAll(".brand-logo, .side-logo").forEach(image => {
    image.addEventListener("error", () => {
      image.hidden = true;
      image.closest(".brand, .sidebar")?.classList.add("logo-fallback");
    }, { once: true });
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
      uploads: data.uploads || []
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
      if (!user) throw new Error("Credenciales inválidas.");
      if (user.status !== "approved") throw new Error("Este usuario aún no está aprobado.");
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
      const tables = ["profiles", "companies", "athletes", "events", "requests", "sponsorships", "news", "partnerships", "site_settings", "crm", "payments", "uploads"];
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
      const profile = profiles[0] || await this.ensureClientAccount(auth);
      if (profile.status !== "approved") throw new Error("Este usuario aún no está aprobado.");
      const companies = await request(`/rest/v1/companies?select=id&contact=eq.${encodeURIComponent(email)}&limit=1`, {
        headers: headers(auth.access_token)
      });
      const role = companies.length ? "client" : normalizedRole(email, profile.role);
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
      const profile = profiles[0] || await this.ensureClientAccount({ user, access_token: accessToken });
      const companies = await request(`/rest/v1/companies?select=id&contact=eq.${encodeURIComponent(user.email)}&limit=1`, {
        headers: headers(accessToken)
      });
      const role = companies.length ? "client" : normalizedRole(user.email, profile.role);
      return { id: profile.id, email: user.email, role, name: profile.name, token: accessToken, mustChangePassword: true };
    },
    async ensureClientAccount(auth, fallback = {}) {
      const token = auth.access_token || auth.session?.access_token;
      const email = auth.user.email;
      const meta = auth.user.user_metadata || {};
      const company = fallback.company || meta.company_name || meta.name || email.split("@")[0];
      const contact = fallback.contact || meta.contact_name || company;
      const interest = fallback.interest || meta.interest || "Relaciones estratégicas";
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
  const view = document.querySelector(`[data-view="${type === "admin" ? "admin" : "client"}"]`);
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
    showView(state.session.role === "admin" ? "admin" : "client");
  } catch (error) {
    if (String(error.message).toLowerCase().includes("email not confirmed")) {
      showVerificationNotice(form.email.value);
      return;
    }
    notify("Acceso", "No fue posible iniciar sesión", error.message);
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
    notify("Recuperación", "Correo enviado", "Si el correo existe en ROIS, recibirá un enlace para restablecer la contraseña.");
    form.reset();
    form.hidden = true;
    closeModals();
  } catch (error) {
    notify("Recuperación", "No fue posible enviar el enlace", humanError(error));
  }
}

async function submitPasswordChange(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (form.password.value !== form.confirm.value) {
    notify("Contraseña", "Las contraseñas no coinciden", "Confirma la nueva contraseña para continuar.");
    return;
  }
  if (!state.pendingSession) {
    notify("Contraseña", "Sesión no encontrada", "Inicia sesión nuevamente para cambiar la contraseña.");
    return;
  }
  try {
    state.session = await api.changePassword(state.pendingSession, form.password.value);
    state.pendingSession = null;
    saveSession(state.session);
    form.reset();
    closeModals();
    renderSession();
    showView(state.session.role === "admin" ? "admin" : "client");
  } catch (error) {
    notify("Contraseña", "No fue posible cambiarla", error.message);
  }
}

async function submitSettingsPassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (form.password.value !== form.confirm.value) {
    notify("Configuración", "Las contraseñas no coinciden", "Confirma la nueva contraseña para actualizarla.");
    return;
  }
  try {
    state.session = await api.changePassword(state.session, form.password.value);
    saveSession(state.session);
    form.reset();
    notify("Configuración", "Contraseña actualizada", "El cambio quedó aplicado correctamente.");
  } catch (error) {
    notify("Configuración", "No fue posible cambiarla", humanError(error));
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
    "Verificación",
    "Confirma tu correo",
    `Enviamos un enlace de verificación a ${email}. Si no lo recibiste, revisa spam o solicita un nuevo envío.`,
    `<button class="btn primary full" type="button" id="resendVerificationButton">Reenviar correo de verificación</button>`
  );
  document.getElementById("resendVerificationButton").addEventListener("click", () => resendVerificationEmail(email));
}

async function resendVerificationEmail(email) {
  try {
    await api.resendSignup(email);
    notify("Verificación", "Correo reenviado", `Enviamos nuevamente el enlace de verificación a ${email}.`);
  } catch (error) {
    notify("Verificación", "No se pudo reenviar", humanError(error));
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
    return "La base de datos todavía está bloqueando este registro. Actualiza las políticas de Supabase y vuelve a intentarlo.";
  }
  return message || "Ocurrió un error inesperado.";
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
    <button class="btn subtle" type="button" data-panel-link>${state.session.role === "admin" ? "Panel admin" : "Panel cliente"}</button>
  `;
  area.querySelector("[data-panel-link]").addEventListener("click", () => showView(state.session.role === "admin" ? "admin" : "client"));
}

function renderPublic() {
  const publicPartners = state.data.partnerships.filter(item => item.status === "approved" && visualIsPublic(item));
  document.getElementById("publicPartners").innerHTML = publicPartners.length ? `
    <div class="partner-grid">
      ${publicPartners.map(partner => partnerCard(partner)).join("")}
    </div>
  ` : `<div class="empty">Las alianzas y sponsors aprobados aparecerán aquí cuando admin los publique.</div>`;

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
  ` : `<div class="empty">Los eventos aprobados aparecerán aquí cuando el administrador los publique.</div>`;

  const publicAthletes = state.data.athletes.filter(item => item.status === "approved" && visualIsPublic(item));
  document.getElementById("publicAthletes").innerHTML = publicAthletes.length ? `
    <div class="athlete-showcase">
      ${publicAthletes.map(athlete => athleteCard(athlete, `<button class="btn primary" type="button" data-open-login>Patrocinar</button>`)).join("")}
    </div>
  ` : `<div class="empty">Los deportistas aprobados aparecerán aquí cuando el administrador los publique.</div>`;

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
  ` : `<div class="empty">Las noticias publicadas aparecerán aquí.</div>`;

  document.querySelectorAll("[data-open-login]").forEach(button => button.addEventListener("click", openLogin));
}

function renderClient() {
  renderClientHeader();
  renderClientKpis();
  renderClientEvents();
  renderClientNews();
  renderClientSponsors();
  renderClientMarketplace();
  renderClientRegister();
  renderClientStatus();
  renderClientPayments();
  renderAccountSettings("client-settings");
}

function renderClientHeader() {
  document.getElementById("clientAccountEyebrow").textContent = "Cuenta aprobada";
  document.getElementById("clientAccountName").textContent = state.session?.name || "Cuenta ROIS";
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
  ` : `<div class="empty">Los eventos aprobados por admin aparecerán aquí.</div>`);
}

function renderClientNews() {
  const news = state.data.news.filter(item => item.status === "published" && visualIsPublic(item));
  panel("client-news", "Noticias", "Publicaciones privadas para detectar oportunidades", news.length ? `
    <div class="panel-body">
      <div class="opportunity-grid">
        ${news.map(item => publishedCard({
          item,
          kicker: "Publicación ROIS",
          title: item.title,
          text: item.summary,
          action: newsInteractionBar(item)
        })).join("")}
      </div>
    </div>
  ` : `<div class="empty">Las noticias publicadas por admin aparecerán aquí.</div>`);
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
        "Mención institucional en comunicación ROIS seleccionada",
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
        "Presencia de marca en academias o alianzas estratégicas disponibles",
        "2 briefs mensuales de oportunidades con recomendación ROIS",
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
        "Asignación de un deportista de alto rendimiento sujeto a disponibilidad",
        "Presencia en redes sociales del deportista y ecosistema ROIS",
        "Branding en uniforme, equipo deportivo o materiales autorizados",
        "Activaciones en academias y eventos estratégicos",
        "Mesa trimestral de estrategia con dirección ROIS"
      ]
    }
  ];
  panel("client-sponsors", "Patrocinios ROIS", "Elige un nivel mensual de presencia, acceso y activación dentro del ecosistema ROIS", `
    <div class="panel-body">
      ${partners.length ? `
        <div class="section-minihead">
          <p class="eyebrow">Patrocinadores oficiales</p>
          <h3>Red publicada por ROIS para conexiones estratégicas.</h3>
        </div>
        <div class="opportunity-grid">
          ${partners.map(partner => clientPartnerCard(partner)).join("")}
        </div>
      ` : `<div class="empty slim">Los patrocinadores oficiales aprobados aparecerán aquí.</div>`}
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
  ` : `<div class="empty">Aún no hay deportistas aprobados para patrocinio.</div>`);
}

function renderClientRegister() {
  panel("client-register", "Registrar Evento", "Envío a revisión", `
    <div class="panel-body">
      <form id="eventForm" class="form-grid">
        <label>Nombre<input name="name" required placeholder="Título del evento"></label>
        <label>Sede<input name="venue" required placeholder="Sede o ciudad"></label>
        <label>Categoría<input name="category" required placeholder="Ejecutivo, patrocinio, membresía"></label>
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
    notify("Eventos", "Evento registrado", "El evento fue enviado a revisión del administrador.");
    renderClient();
  });
}

function renderClientStatus() {
  const rows = [
    ...state.data.requests.filter(item => item.type !== "Interacción noticia").map(item => [item.title, item.type, item.priority || "Normal", badge(item.status)]),
    ...state.data.sponsorships.map(item => [item.athlete, "Patrocinio", "Revisión ROIS", badge(item.status)])
  ];
  panel("client-status", "Estado Solicitudes", "Seguimiento operativo", rows.length ? table(["Solicitud", "Área", "Prioridad", "Estado"], rows) : `<div class="empty">No hay solicitudes todavía.</div>`);
}

function renderClientPayments() {
  const rows = state.data.payments.map(payment => [
    payment.concept,
    `$${Number(payment.amount).toLocaleString("es-MX")} MXN`,
    badge(payment.status),
    payment.status === "paid" ? "Pagado" : button("Pagar con Stripe", () => payClientPayment(payment.id))
  ]);
  panel("client-payments", "Pagos", "Stripe y compromisos activos", rows.length ? table(["Concepto", "Monto", "Estado", "Acción"], rows) : `
    <div class="panel-body">
      <div class="empty">No hay pagos registrados todavía. Las solicitudes de patrocinio generarán pagos pendientes para Stripe.</div>
    </div>
  `);
}

function renderAccountSettings(panelId) {
  panel(panelId, "Configuración", "Seguridad de acceso", `
    <div class="panel-body">
      <div class="settings-grid">
        <div class="settings-block">
          <p class="eyebrow">Sesión</p>
          <h3>Cierre automático</h3>
          <p class="hint">La sesión ROIS se mantiene solo mientras esta ventana del navegador permanezca abierta. Al cerrar la pestaña o el navegador, se solicitará iniciar sesión nuevamente.</p>
        </div>
        <form class="form-grid settings-password-form" data-settings-password>
          <label>Nueva contraseña<input name="password" type="password" minlength="8" autocomplete="new-password" required></label>
          <label>Confirmar contraseña<input name="confirm" type="password" minlength="8" autocomplete="new-password" required></label>
          <button class="btn primary" type="submit">Actualizar contraseña</button>
        </form>
        <div class="settings-block">
          <p class="eyebrow">Recuperación</p>
          <h3>Recuperar acceso</h3>
          <p class="hint">Si pierdes acceso, usa “Recuperar contraseña” en la pantalla de acceso. ROIS enviará un enlace al correo registrado.</p>
        </div>
      </div>
    </div>
  `);
  document.querySelector(`[data-dashboard-panel="${panelId}"] [data-settings-password]`).addEventListener("submit", submitSettingsPassword);
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
    badge(user.role === "admin" ? "admin" : "cliente"),
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
        <label>Categoría<input name="category" required placeholder="Ej. Juvenil, amateur, profesional"></label>
        <label>Ciudad / base<input name="location" required placeholder="Ciudad o club base"></label>
        <label>Ranking o marca<input name="ranking" placeholder="Ranking, handicap, marca o nivel"></label>
        <label>Monto anual<input name="annual" type="number" min="0" value="1000" required></label>
        <label>Ticket mensual<input name="monthly" type="number" min="0" value="5000" required></label>
        <label>Máximo de patrocinadores<input name="max_sponsors" type="number" min="1" value="3" required></label>
        <label style="grid-column:1/-1">Link de pago individual Stripe<input name="sponsor_payment_url" type="url" placeholder="https://buy.stripe.com/..."></label>
        <label style="grid-column:1/-1">Logos de sponsors actuales<input name="sponsor_logo_files" type="file" accept="image/png,image/jpeg,image/webp" multiple></label>
        <label style="grid-column:1/-1">Nombre de marcas patrocinadoras opcional<textarea name="sponsor_logo_names" placeholder="Una marca por línea, en el mismo orden de los logos. Ej. ROIS Trade"></textarea></label>
        <label style="grid-column:1/-1">Ficha técnica<textarea name="stats" required placeholder="Resultados, calendario, métricas, logros y objetivo deportivo"></textarea></label>
        <label style="grid-column:1/-1">Condiciones autorizadas para patrocinadores<textarea name="sponsor_terms" placeholder="Una condición por línea. Ej. Mención mensual en redes sociales"></textarea></label>
        <label style="grid-column:1/-1">Video de competencias o entrenamientos opcional<input name="video_url" type="url" placeholder="https://youtube.com/... o https://vimeo.com/..."></label>
        <label style="grid-column:1/-1">Propuesta comercial PDF opcional<input name="proposal_pdf" type="file" accept="application/pdf"></label>
        <label style="grid-column:1/-1">Imagen del deportista<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <button class="btn primary" type="submit">Crear deportista</button>
      </form>
      <p class="hint">Las imágenes nuevas quedan en revisión visual. No aparecen públicamente hasta aprobarse.</p>
    </div>
    ${table(["Visual", "Nombre", "Deporte", "Ticket", "Cupo", "Propuesta", "Pago", "Visual", "Acciones"], state.data.athletes.map(athlete => [
      visualThumb(athlete), athlete.name, athlete.sport, `$${Number(athlete.monthly || 5000).toLocaleString("es-MX")} MXN`, `${athleteSponsorLogos(athlete).length}/${athlete.max_sponsors || 3}`, athlete.proposal_url ? badge("PDF") : badge("pendiente"), athlete.sponsor_payment_url ? badge("link activo") : badge("sin link"), badge(athlete.visual_status || "sin visual"), moderationActions("athletes", athlete)
    ]))}
  `);
  document.getElementById("adminAthleteForm").addEventListener("submit", submitAdminAthlete);
}

function renderAdminEvents() {
  panel("admin-events", "Eventos", "Alta, visuales y aprobación", `
    <div class="panel-body">
      <form id="adminEventForm" class="form-grid">
        <label>Evento<input name="name" required placeholder="Nombre del evento"></label>
        <label>Categoría<input name="category" required placeholder="Ejecutivo, sponsor, membresía"></label>
        <label>Sede<input name="venue" required placeholder="Sede o ciudad"></label>
        <label>Fecha<input name="date" required placeholder="Por confirmar"></label>
        <label style="grid-column:1/-1">Brochure PDF<input name="brochure_pdf" type="file" accept="application/pdf"></label>
        <label style="grid-column:1/-1">Alcance y posicionamiento del evento<textarea name="event_scope" required placeholder="Resume audiencia, alcance, sectores, tomadores de decisión, medios, impacto esperado y por qué una empresa debería considerar este evento."></textarea></label>
        <label style="grid-column:1/-1">Imagen del evento<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <button class="btn primary" type="submit">Crear evento</button>
      </form>
      <p class="hint">El evento y su imagen pasan por revisión antes de publicarse.</p>
    </div>
    ${table(["Visual", "Evento", "Sede", "Brochure", "Estado", "Visual", "Acciones"], state.data.events.map(event => [
      visualThumb(event), event.name, event.venue, event.brochure_url ? badge("PDF") : badge("pendiente"), badge(event.status), badge(event.visual_status || "sin visual"), moderationActions("events", event)
    ]))}
  `);
  document.getElementById("adminEventForm").addEventListener("submit", submitAdminEvent);
}

function renderAdminNews() {
  panel("admin-news", "Noticias", "Gestión editorial", `
    <div class="panel-body">
      <form id="newsForm" class="form-grid">
        <label>Título<input name="title" required placeholder="Titular privado"></label>
        <label>Estado<select name="status"><option value="published">Publicado</option><option value="draft">Borrador</option></select></label>
        <label style="grid-column:1/-1">Resumen<textarea name="summary" required placeholder="Resumen para miembros."></textarea></label>
        <label style="grid-column:1/-1">Imagen de noticia<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <button class="btn primary" type="submit">Publicar</button>
      </form>
      <p class="hint">Aunque el texto esté publicado, una noticia con imagen no aparece públicamente hasta aprobar el visual.</p>
    </div>
    ${table(["Visual", "Título", "Estado", "Visual", "Acciones"], state.data.news.map(item => [
      visualThumb(item), item.title, badge(item.status), badge(item.visual_status || "sin visual"), moderationActions("news", item)
    ]))}
  `);
  document.getElementById("newsForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const image_url = await fileToDataUrl(form.image.files[0]);
    await api.insert("news", { title: form.title.value, summary: form.summary.value, status: form.status.value, image_url, visual_status: image_url ? "pending_review" : "approved" });
    notify("Noticias", "Nota creada", "La nota quedó disponible en el módulo editorial.");
    renderAdmin();
    renderPublic();
  });
}

function renderAdminPartners() {
  panel("admin-partners", "Patrocinadores", "Sponsors clave y red estratégica visible en home", `
    <div class="panel-body">
      <form id="partnerForm" class="form-grid">
        <label>Nombre<input name="name" required placeholder="Empresa, sponsor o aliado"></label>
        <label>Tipo<select name="type"><option>Alianza estratégica</option><option>Sponsor principal</option><option>Partner institucional</option><option>Media partner</option></select></label>
        <label>Nivel<select name="tier"><option>Principal</option><option>Estratégico</option><option>Institucional</option><option>Comunidad</option></select></label>
        <label>Sitio web<input name="url" type="url" placeholder="https://empresa.com"></label>
        <label>Estado<select name="status"><option value="approved">Visible en home</option><option value="pending">Pendiente</option></select></label>
        <label style="grid-column:1/-1">Descripción<textarea name="description" required placeholder="Describe la alianza, sponsor o relación estratégica."></textarea></label>
        <label style="grid-column:1/-1">Logo o visual<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <button class="btn primary" type="submit">Guardar alianza</button>
      </form>
      <p class="hint">Los logos y visuales nuevos quedan en revisión visual antes de mostrarse públicamente.</p>
    </div>
    ${table(["Visual", "Nombre", "Tipo", "Nivel", "Estado", "Visual", "Acciones"], state.data.partnerships.map(partner => [
      visualThumb(partner), partner.name, partner.type, partner.tier, badge(partner.status), badge(partner.visual_status || "sin visual"), moderationActions("partnerships", partner)
    ]))}
  `);
  document.getElementById("partnerForm").addEventListener("submit", submitAdminPartner);
}

function renderAdminCrm() {
  panel("admin-crm", "CRM", "Pipeline de relaciones", table(["Categoría", "Volumen", "Estado", "Acción"], state.data.crm.map(item => [
    item.name, item.volume, badge(item.status), button("Avanzar", () => updateCrm(item.id))
  ])));
}

function renderAdminPayments() {
  panel("admin-payments", "Pagos", "Resumen financiero conectado a Stripe", table(["Concepto", "Monto", "Estado", "Acción"], state.data.payments.map(payment => [
    payment.concept, `$${Number(payment.amount).toLocaleString("es-MX")} MXN`, badge(payment.status), payment.status === "paid" ? "Pagado" : button("Marcar pagado", () => markPaid(payment.id))
  ])));
}

function renderAdminUploads() {
  panel("admin-uploads", "Uploads", "Biblioteca y moderación visual", `
    <div class="panel-body">
      <form id="uploadForm" class="form-grid">
        <label>Archivo visual<input name="file" type="file" accept="image/png,image/jpeg,image/webp" required></label>
        <label>Tipo<select name="type"><option>Evento</option><option>Deportista</option><option>Contrato</option><option>Documento</option></select></label>
        <button class="btn primary" type="submit">Registrar upload</button>
      </form>
      <p class="hint">Todo visual subido queda bloqueado hasta revisión manual. En producción debe sumarse moderación automática.</p>
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
    notify("Uploads", "Archivo registrado", "El visual quedó pendiente de revisión.");
    renderAdmin();
  });
}

function renderAdminStats() {
  const approvedUsers = state.data.profiles.filter(item => item.status === "approved").length;
  const totalUsers = state.data.profiles.length || 1;
  const sponsorReview = state.data.sponsorships.filter(item => item.status === "review").length;
  panel("admin-stats", "Estadísticas", "Indicadores operativos", table(["Métrica", "Valor", "Lectura"], [
    ["Conversión de aprobación", `${Math.round((approvedUsers / totalUsers) * 100)}%`, badge("estable")],
    ["Demanda de eventos", state.data.requests.length, badge("activa")],
    ["Patrocinios en revisión", sponsorReview, badge("prioridad")]
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
    actions.push(`<span class="hint inline">Sesión activa</span>`);
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

async function createEventSponsorshipRequest(event, level) {
  await api.insert("requests", {
    type: "Patrocinio evento",
    title: `${event.name} - ${level.name}`,
    owner: state.session?.name || "Empresa",
    details: `Evento: ${event.name} | Paquete: ${level.name} | Monto: ${level.amount} | Beneficios: ${level.benefits}`,
    priority: level.amount || "Paquete privado",
    status: "review"
  });
  notify("Eventos", "Paquete solicitado", "ROIS revisará disponibilidad, beneficios y condiciones del patrocinio del evento.");
  renderClient();
  renderAdmin();
}

async function createSponsorship(athlete, amount, details = "", paymentUrl = "") {
  await api.insert("sponsorships", { athlete, amount, company: state.session?.name || "Empresa", details, status: "review" });
  await api.insert("requests", {
    type: "Patrocinio deportista",
    title: athlete,
    owner: state.session?.name || "Empresa",
    details,
    priority: `$${Number(amount).toLocaleString("es-MX")} MXN`,
    status: "review"
  });
  await api.insert("payments", { concept: `Patrocinio mensual - ${athlete}`, amount, company: state.session?.name || "Empresa", status: "pending", product_key: "" });
  notify("Sponsor", "Patrocinio solicitado", "La solicitud fue enviada a revisión.");
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
  notify("Aprobación", "Elemento aprobado", "El estado fue actualizado correctamente.");
  renderAdmin();
  renderPublic();
}

async function approveUser(user, tableName) {
  if (tableName === "profiles") {
    const email = user.email.toLowerCase();
    await api.update("profiles", user.id, {
      status: "approved",
      role: email === adminEmail ? "admin" : "client"
    });
    const company = state.data.companies.find(item => (item.contact || "").toLowerCase() === email);
    if (company) await api.update("companies", company.id, { status: "approved" });
  } else {
    const email = (user.contact || "").toLowerCase();
    await api.update("companies", user.id, { status: "approved" });
    const profile = state.data.profiles.find(item => item.email.toLowerCase() === email);
    if (profile) await api.update("profiles", profile.id, { status: "approved", role: "client" });
  }
  notify("Usuarios", "Cliente aprobado", "El acceso quedó autorizado para el dashboard de cliente.");
  renderAdmin();
  renderPublic();
}

async function confirmDeleteUser(user, tableName) {
  const confirmed = window.confirm(`¿Eliminar el usuario "${user.name}"? Esta acción no se puede deshacer en modo real.`);
  if (!confirmed) return;
  await api.remove(tableName, user.id);
  notify("Usuarios", "Usuario eliminado", "El usuario fue eliminado del panel administrativo.");
  renderAdmin();
}

async function updateCrm(id) {
  await api.update("crm", id, { status: "En seguimiento" });
  notify("CRM", "Pipeline actualizado", "El elemento cambió a seguimiento.");
  renderAdmin();
}

async function markPaid(id) {
  await api.update("payments", id, { status: "paid" });
  notify("Pagos", "Pago actualizado", "El pago fue marcado como pagado.");
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
  notify("Deportistas", "Deportista creado", "El perfil quedó pendiente de aprobación y revisión visual.");
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
  notify("Eventos", "Evento creado", "El evento quedó pendiente de aprobación y revisión visual.");
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
  notify("Alianzas", "Alianza guardada", "El registro quedó disponible para aprobación y revisión visual.");
  renderAdmin();
  renderPublic();
}

async function approveVisual(tableName, item) {
  await api.update(tableName, item.id, { visual_status: "approved", visual_notes: "" });
  notify("Moderación visual", "Visual aprobado", "El visual ya puede mostrarse en áreas públicas si el contenido también está aprobado.");
  renderAdmin();
  renderPublic();
}

async function rejectVisual(tableName, item) {
  await api.update(tableName, item.id, { visual_status: "rejected", status: item.status === "published" ? "draft" : item.status, visual_notes: "Rechazado por revisión manual" });
  notify("Moderación visual", "Visual rechazado", "El visual quedó bloqueado y no se mostrará públicamente.");
  renderAdmin();
  renderPublic();
}

async function deleteContent(tableName, item) {
  const confirmed = window.confirm(`¿Eliminar "${item.name || item.title}"?`);
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
  const confirmed = window.confirm(`¿Bajar "${label}" del home y dashboard cliente?`);
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
  const scope = event.event_scope || event.sponsor_levels || "Alcance comercial pendiente de publicación por ROIS.";
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
    item.type === "Interacción noticia" &&
    item.priority === reaction &&
    String(item.details || "").includes(`news:${news.id}`)
  ).length;
}

function newsInteractionBar(news) {
  const reactions = [
    ["Like", "Me gusta"],
    ["Interés", "Me interesa"],
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
    type: "Interacción noticia",
    title: news.title,
    owner: state.session?.name || "Empresa",
    details: `news:${news.id} | ${reaction}${note ? ` | ${note}` : ""}`,
    priority: reaction,
    status: "recorded"
  });
  notify("Noticias", "Interacción registrada", reaction === "Compartir" ? "Copiamos el enlace de noticias y registramos tu interacción." : "Tu interacción quedó registrada para el equipo ROIS.");
  renderClient();
  renderAdmin();
}

function athleteSponsorConditions() {
  return [
    "Logo en uniforme o equipo autorizado",
    "Mención mensual en redes sociales",
    "Video corto de agradecimiento para la marca",
    "Uso de imagen del deportista en campaña aprobada",
    "Presencia en evento corporativo o clínica deportiva",
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
          <textarea name="notes" placeholder="Objetivo de marca, giro, restricciones o campaña deseada."></textarea>
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
        <p>${text || "Información disponible para miembros aprobados."}</p>
        ${action || ""}
      </div>
    </article>
  `;
}

function partnerCard(partner) {
  const image = partner.image_url || "./assets/rois-logo-cropped.png";
  const link = partner.url ? `<a class="btn" href="${partner.url}" target="_blank" rel="noopener">Ver aliado</a>` : `<button class="btn" type="button" data-open-login>Solicitar conexión</button>`;
  return `
    <article class="partner-card">
      <div class="partner-mark">
        <img src="${image}" alt="${partner.name}">
      </div>
      <div class="partner-content">
        <div>
          <p class="eyebrow">${partner.tier || "Aliado ROIS"}</p>
          <h3>${partner.name}</h3>
          <p>${partner.description || "Aliado estratégico dentro del ecosistema ROIS."}</p>
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
    text: partner.description || "Sponsor o aliado estratégico publicado por ROIS.",
    action: partner.url
      ? `<a class="btn" href="${partner.url}" target="_blank" rel="noopener">Ver aliado</a>`
      : button("Solicitar conexión", () => createRequest("Conexión sponsor", partner.name))
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
      priority: tier.amount >= 100000 ? "Dirección ROIS" : "Comercial"
    });
    await api.insert("payments", {
      concept: `${tier.name} - mensualidad`,
      amount: tier.amount,
      company: state.session?.name || "Empresa",
      status: "pending",
      product_key: tier.productKey
    });
    if (!checkoutStarted) {
      notify("Patrocinios ROIS", "Solicitud recibida", `Falta configurar el link de Stripe para ${tier.name}. ROIS preparará la activación y el cierre comercial.`);
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
          <p class="athlete-summary">${athlete.stats || "Perfil deportivo en evaluación."}</p>
          ${logos.length ? `
            <div class="athlete-sponsor-brands">
              <span>Patrocinadores actuales</span>
              <div>${logos.map(logo => `<img src="${logo.image}" alt="${logo.name || "Sponsor"}">`).join("")}</div>
            </div>
          ` : ""}
        </div>
        <div class="athlete-technical">
          <div><span>Deporte</span><strong>${athlete.sport || "Por definir"}</strong></div>
          <div><span>Categoría</span><strong>${athlete.category || "Semilla"}</strong></div>
          <div><span>Base</span><strong>${athlete.location || "Por confirmar"}</strong></div>
          <div><span>Ranking / marca</span><strong>${athlete.ranking || "En evaluación"}</strong></div>
        </div>
        <div class="athlete-metrics">
          <div><span>Ticket mensual</span><strong>$${monthly} MXN</strong></div>
          <div><span>Cupos de sponsor</span><strong>${logos.length}/${maxSponsors}</strong></div>
        </div>
        <div class="athlete-decision">
          <p>Ideal para marcas que buscan visibilidad temprana, narrativa deportiva y relación directa con talento en crecimiento. Inversión anual de perfil: $${annual} MXN.</p>
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
      <label>Interés principal<select name="interest"><option>Eventos</option><option>Sponsors</option><option>Deportistas</option><option>Relaciones estratégicas</option></select></label>
      <label>Contraseña<input name="password" type="password" minlength="8" autocomplete="new-password" required placeholder="Mínimo 8 caracteres"></label>
      <label>Confirmar contraseña<input name="confirm" type="password" minlength="8" autocomplete="new-password" required placeholder="Repite tu contraseña"></label>
      <p class="hint">La cuenta se activa como cliente ROIS. Las operaciones premium pueden requerir revisión interna.</p>
      <button class="btn primary full" type="submit">Crear cuenta</button>
    `;
  }
  if (type === "athlete") {
    return `
      <label>Nombre<input name="name" required placeholder="Nombre del deportista"></label>
      <label>Deporte<input name="sport" required placeholder="Disciplina"></label>
      <label>Categoría<input name="category" required placeholder="Categoría o nivel"></label>
      <label>Ciudad / base<input name="location" required placeholder="Ciudad, club o academia"></label>
      <label>Ranking o marca<input name="ranking" placeholder="Ranking, marca o métrica principal"></label>
      <label>Monto anual<input name="annual" type="number" min="0" value="1000" required></label>
      <label>Ticket mensual<input name="monthly" type="number" min="0" value="5000" required></label>
      <label>Máximo de patrocinadores<input name="max_sponsors" type="number" min="1" value="3" required></label>
      <label style="grid-column:1/-1">Ficha técnica<textarea name="stats" required placeholder="Resultados, calendario, métricas, logros y objetivo deportivo"></textarea></label>
      <label style="grid-column:1/-1">Logos de sponsors actuales opcional<input name="sponsor_logo_files" type="file" accept="image/png,image/jpeg,image/webp" multiple></label>
      <label style="grid-column:1/-1">Nombre de marcas patrocinadoras opcional<textarea name="sponsor_logo_names" placeholder="Una marca por línea, en el mismo orden de los logos."></textarea></label>
      <label style="grid-column:1/-1">Video de competencias o entrenamientos opcional<input name="video_url" type="url" placeholder="https://youtube.com/... o https://vimeo.com/..."></label>
      <label style="grid-column:1/-1">Propuesta comercial PDF opcional<input name="proposal_pdf" type="file" accept="application/pdf"></label>
      <label style="grid-column:1/-1">Imagen de perfil<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
      <button class="btn primary full" type="submit">Enviar y pagar perfil</button>
    `;
  }
  return `
    <label>Evento<input name="name" required placeholder="Nombre del evento"></label>
    <label>Categoría<input name="category" required placeholder="Ejecutivo, patrocinio, membresía"></label>
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
        notify("Registro", "Las contraseñas no coinciden", "Confirma la contraseña para crear tu cuenta.");
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
        renderSession();
        renderClient();
        showView("client");
        notify("Cuenta creada", "Bienvenido a ROIS", "Tu dashboard de cliente ya está activo.");
      } else {
        showVerificationNotice(signup.email || form.email.value);
      }
      renderAdmin();
      renderPublic();
      return;
    } else if (type === "athlete") {
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
        sponsor_logos,
        proposal_url,
        proposal_name: proposalFile?.name || "",
        video_url: form.video_url.value,
        status: "pending",
        image_url,
        visual_status: image_url ? "pending_review" : "approved"
      });
      paymentAction = ["athleteAnnualProfile", "Perfil Deportivo Anual ROIS"];
    } else {
      const image_url = await fileToDataUrl(form.image.files[0]);
      await api.insert("events", { name: form.name.value, category: form.category.value, venue: form.venue.value, date: form.date.value, status: "pending", image_url, visual_status: image_url ? "pending_review" : "approved" });
      paymentAction = ["eventRegistration", "Registro de Evento ROIS"];
    }
    closeModals();
    notify("Registro", "Solicitud recibida", "El registro quedó pendiente de aprobación en el panel administrador.");
    if (paymentAction) {
      openStripeCheckout(paymentAction[0], paymentAction[1]);
    }
    renderAdmin();
    renderPublic();
  } catch (error) {
    notify("Registro", "No fue posible registrar", humanError(error));
  }
}
