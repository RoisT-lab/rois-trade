const config = window.ROIS_CONFIG || {};
const demoMode = config.demoMode !== false || !config.supabaseUrl || !config.supabaseAnonKey;
const storeKey = "rois_demo_data_v2";
const sessionKey = "rois_session_v2";
const configuredDemoAdmin = config.demoAdminEmail && config.demoAdminPassword;
const adminEmail = (config.adminEmail || config.demoAdminEmail || "").toLowerCase();
const fixedLogoPath = "./assets/rois-logo-cropped.png";

const state = {
  session: JSON.parse(localStorage.getItem(sessionKey) || "null"),
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

function normalizeSession(session) {
  if (!session) return null;
  return { ...session, role: normalizedRole(session.email, session.role) };
}

async function init() {
  state.session = normalizeSession(state.session);
  if (state.session) localStorage.setItem(sessionKey, JSON.stringify(state.session));
  state.data = await api.loadAll();
  applyBranding();
  handleMissingImages();
  bindGlobalEvents();
  renderPublic();
  renderSession();
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
      const profile = profiles[0];
      if (!profile) throw new Error("No existe perfil ROIS para este usuario.");
      if (profile.status !== "approved") throw new Error("Este usuario aún no está aprobado.");
      return { id: profile.id, email, role: normalizedRole(email, profile.role), name: profile.name, token: auth.access_token, mustChangePassword: !!profile.must_change_password };
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
  document.querySelectorAll("[data-registration]").forEach(button => button.addEventListener("click", () => openRegistration(button.dataset.registration)));
  document.getElementById("loginForm").addEventListener("submit", submitLogin);
  document.getElementById("passwordForm").addEventListener("submit", submitPasswordChange);
  document.getElementById("registrationForm").addEventListener("submit", submitRegistration);
}

function showView(name) {
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
}

async function submitLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const session = await api.login(form.email.value, form.password.value);
    if (session.mustChangePassword) {
      state.pendingSession = session;
      state.session = null;
      localStorage.removeItem(sessionKey);
      closeModals();
      renderSession();
      showView("public");
      document.getElementById("passwordModal").classList.add("active");
      return;
    }
    state.session = session;
    localStorage.setItem(sessionKey, JSON.stringify(state.session));
    closeModals();
    renderSession();
    showView(state.session.role === "admin" ? "admin" : "client");
  } catch (error) {
    notify("Acceso", "No fue posible iniciar sesión", error.message);
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
    localStorage.setItem(sessionKey, JSON.stringify(state.session));
    form.reset();
    closeModals();
    renderSession();
    showView(state.session.role === "admin" ? "admin" : "client");
  } catch (error) {
    notify("Contraseña", "No fue posible cambiarla", error.message);
  }
}

function logout() {
  state.session = null;
  localStorage.removeItem(sessionKey);
  renderSession();
  showView("home");
}

function openLogin() {
  document.getElementById("loginModal").classList.add("active");
}

function closeModals() {
  document.querySelectorAll(".modal").forEach(modal => modal.classList.remove("active"));
}

function notify(kicker, title, text) {
  document.getElementById("actionKicker").textContent = kicker;
  document.getElementById("actionTitle").textContent = title;
  document.getElementById("actionText").textContent = text;
  document.getElementById("actionModal").classList.add("active");
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
  window.open(link, "_blank", "noopener");
  notify("Stripe", "Checkout abierto", `Completa el pago de ${title} en Stripe para continuar el proceso.`);
  return true;
}

function humanError(error) {
  const message = typeof error?.message === "string" ? error.message : JSON.stringify(error);
  if (message.includes("row-level security") || message.includes("42501")) {
    return "La base de datos todavía está bloqueando este registro. Actualiza las políticas de Supabase y vuelve a intentarlo.";
  }
  return message || "Ocurrió un error inesperado.";
}

function temporaryPassword() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 14) + "!";
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
  document.getElementById("publicEvents").innerHTML = publicEvents.length ? publicEvents.map(event => `
    <article class="list-row">
      <div>
        ${visualThumb(event)}
        <h3>${event.name}</h3>
        <div class="row-meta"><span class="pill">${event.category}</span><span class="pill">${event.date}</span><span class="pill">${event.venue}</span></div>
      </div>
      <button class="btn" type="button" data-open-login>Solicitar acceso</button>
    </article>
  `).join("") : `<div class="empty">Los eventos aprobados aparecerán aquí cuando el administrador los publique.</div>`;

  const publicAthletes = state.data.athletes.filter(item => item.status === "approved" && visualIsPublic(item));
  document.getElementById("publicAthletes").innerHTML = publicAthletes.length ? `
    <div class="athlete-showcase">
      ${publicAthletes.map(athlete => athleteCard(athlete, `<button class="btn primary" type="button" data-open-login>Patrocinar</button>`)).join("")}
    </div>
  ` : `<div class="empty">Los deportistas aprobados aparecerán aquí cuando el administrador los publique.</div>`;

  const publicNews = state.data.news.filter(item => item.status === "published" && visualIsPublic(item));
  document.getElementById("publicNews").innerHTML = publicNews.length ? publicNews.map(news => `
    <article class="list-row">
      <div>${visualThumb(news)}<h3>${news.title}</h3><p class="hint">${news.summary}</p></div>
      <button class="btn" type="button" data-open-login>Leer</button>
    </article>
  `).join("") : `<div class="empty">Las noticias publicadas aparecerán aquí.</div>`;

  document.querySelectorAll("[data-open-login]").forEach(button => button.addEventListener("click", openLogin));
}

function renderClient() {
  renderClientHeader();
  renderClientKpis();
  renderClientEvents();
  renderClientNews();
  renderClientSponsors();
  renderClientMarketplace();
  renderClientRequests();
  renderClientRegister();
  renderClientStatus();
  renderClientPayments();
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
        ${events.map(event => publishedCard({
          item: event,
          kicker: event.category,
          title: event.name,
          text: `${event.venue || "Sede por confirmar"} - ${event.date || "Fecha por confirmar"}`,
          action: button("Solicitar acceso", () => createRequest("Acceso evento", event.name))
        })).join("")}
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
          action: button("Solicitar brief", () => createRequest("Interés en noticia", item.title))
        })).join("")}
      </div>
    </div>
  ` : `<div class="empty">Las noticias publicadas por admin aparecerán aquí.</div>`);
}

function renderClientSponsors() {
  panel("client-sponsors", "Sponsors", "Oportunidades disponibles", table(["Oportunidad", "Desde", "Estado", "Acción"], [
    ["Patrocinio deportista", "$5,000 MXN+ mensual", badge("abierto"), button("Solicitar", () => createSponsorship("Patrocinio deportista", 5000))],
    ["Evento ejecutivo", "Por invitación", badge("limitado"), button("Brief", () => createRequest("Sponsor evento", "Evento ejecutivo"))],
    ["Visibilidad de sede", "Paquete privado", badge("review"), button("Solicitar", () => createRequest("Sponsor sede", "Visibilidad de sede"))],
    ["Patrocinador oficial ROIS", "$50,000 MXN mensual", badge("premium"), button("Pagar Stripe", () => openStripeCheckout("officialSponsorMonthly", "Patrocinador Oficial ROIS"))]
  ]));
}

function renderClientMarketplace() {
  const athletes = state.data.athletes.filter(item => item.status === "approved" && visualIsPublic(item));
  panel("client-marketplace", "Marketplace Deportistas", "Perfiles aprobados para sponsor", athletes.length ? `
    <div class="panel-body">
      <div class="athlete-showcase compact">
        ${athletes.map(athlete => athleteCard(athlete, button("Solicitar patrocinio", () => createSponsorship(athlete.name, athleteInvestment(athlete))))).join("")}
      </div>
    </div>
  ` : `<div class="empty">Aún no hay deportistas aprobados para patrocinio.</div>`);
}

function renderClientRequests() {
  panel("client-requests", "Solicitudes BD", "Mesa de relaciones estratégicas", `
    <div class="panel-body">
      <form id="dbRequestForm" class="form-grid">
        <label>Tipo de relación<input name="title" required placeholder="Ej. Sponsors en Monterrey"></label>
        <label>Prioridad<select name="priority"><option>Normal</option><option>Alta</option><option>Confidencial</option></select></label>
        <label style="grid-column:1/-1">Contexto<textarea name="details" required placeholder="Describe mercado, industria, perfil o relación objetivo."></textarea></label>
        <button class="btn primary" type="submit">Enviar solicitud</button>
      </form>
    </div>
  `);
  document.getElementById("dbRequestForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    await api.insert("requests", { type: "Solicitud BD", title: form.title.value, owner: state.session.name, status: "review", details: form.details.value, priority: form.priority.value });
    notify("Solicitudes BD", "Solicitud enviada", "La solicitud quedó registrada para revisión interna.");
    openStripeCheckout("strategicRequest", "Solicitud Estratégica ROIS");
    renderClient();
  });
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
    ...state.data.requests.map(item => [item.title, item.type, badge(item.status)]),
    ...state.data.sponsorships.map(item => [item.athlete, "Patrocinio", badge(item.status)])
  ];
  panel("client-status", "Estado Solicitudes", "Seguimiento operativo", rows.length ? table(["Solicitud", "Área", "Estado"], rows) : `<div class="empty">No hay solicitudes todavía.</div>`);
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
        <label style="grid-column:1/-1">Ficha técnica<textarea name="stats" required placeholder="Resultados, calendario, métricas, logros y objetivo deportivo"></textarea></label>
        <label style="grid-column:1/-1">Video de competencias o entrenamientos<input name="video_url" type="url" placeholder="https://youtube.com/... o https://vimeo.com/..."></label>
        <label style="grid-column:1/-1">Imagen del deportista<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <button class="btn primary" type="submit">Crear deportista</button>
      </form>
      <p class="hint">Las imágenes nuevas quedan en revisión visual. No aparecen públicamente hasta aprobarse.</p>
    </div>
    ${table(["Visual", "Nombre", "Deporte", "Ficha", "Anual", "Visual", "Acciones"], state.data.athletes.map(athlete => [
      visualThumb(athlete), athlete.name, athlete.sport, `${athlete.category || "Sin categoría"} / ${athlete.ranking || "Sin ranking"}`, `$${athleteInvestment(athlete).toLocaleString("es-MX")} MXN`, badge(athlete.visual_status || "sin visual"), moderationActions("athletes", athlete)
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
        <label style="grid-column:1/-1">Imagen del evento<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <button class="btn primary" type="submit">Crear evento</button>
      </form>
      <p class="hint">El evento y su imagen pasan por revisión antes de publicarse.</p>
    </div>
    ${table(["Visual", "Evento", "Sede", "Estado", "Visual", "Acciones"], state.data.events.map(event => [
      visualThumb(event), event.name, event.venue, badge(event.status), badge(event.visual_status || "sin visual"), moderationActions("events", event)
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

async function createSponsorship(athlete, amount) {
  await api.insert("sponsorships", { athlete, amount, company: state.session?.name || "Empresa", status: "review" });
  await api.insert("payments", { concept: `Patrocinio mensual - ${athlete}`, amount, company: state.session?.name || "Empresa", status: "pending" });
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
  await api.insert("athletes", {
    name: form.name.value,
    sport: form.sport.value,
    category: form.category.value,
    location: form.location.value,
    ranking: form.ranking.value,
    stats: form.stats.value,
    annual: Number(form.annual.value || 1000),
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
  await api.insert("events", {
    name: form.name.value,
    category: form.category.value,
    venue: form.venue.value,
    date: form.date.value,
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
  await api.remove(tableName, item.id);
  notify("Contenido", "Elemento eliminado", "El elemento fue eliminado del dashboard.");
  renderAdmin();
  renderPublic();
}

function moderationActions(tableName, item) {
  const actions = [];
  if (item.status !== "approved" && tableName !== "news" && tableName !== "uploads") {
    actions.push(button("Aprobar contenido", () => approve(tableName, item.id)));
  }
  if (tableName === "news" && item.status !== "published") {
    actions.push(button("Publicar", () => api.update("news", item.id, { status: "published" }).then(() => { renderAdmin(); renderPublic(); })));
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
        ${action}
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

function athleteInvestment(athlete) {
  return Number(athlete.annual || athlete.monthly || 1000);
}

function athleteCard(athlete, action) {
  const image = athlete.image_url || "./assets/rois-isotipo-cropped.png";
  const annual = athleteInvestment(athlete).toLocaleString("es-MX");
  const videoButton = athlete.video_url ? `<a class="btn" href="${athlete.video_url}" target="_blank" rel="noopener">Ver video</a>` : "";
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
        </div>
        <div class="athlete-technical">
          <div><span>Deporte</span><strong>${athlete.sport || "Por definir"}</strong></div>
          <div><span>Categoría</span><strong>${athlete.category || "Semilla"}</strong></div>
          <div><span>Base</span><strong>${athlete.location || "Por confirmar"}</strong></div>
          <div><span>Ranking / marca</span><strong>${athlete.ranking || "En evaluación"}</strong></div>
        </div>
        <div class="athlete-metrics">
          <div><span>Inversión anual</span><strong>$${annual} MXN</strong></div>
          <div><span>Estado</span><strong>${athlete.status === "approved" ? "Aprobado" : "Revisión"}</strong></div>
        </div>
        <div class="athlete-decision">
          <p>Ideal para marcas que buscan visibilidad temprana, narrativa deportiva y relación directa con talento en crecimiento.</p>
          <div class="athlete-actions">${videoButton}${action}</div>
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

function openRegistration(type) {
  state.registrationType = type;
  const title = type === "company" ? "Registro de empresa" : type === "athlete" ? "Registro de deportista" : "Registro de evento";
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
      <p class="hint">Tu solicitud será revisada por ROIS. Si es aprobada, recibirás instrucciones privadas para activar tu acceso.</p>
      <button class="btn primary full" type="submit">Enviar empresa</button>
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
      <label style="grid-column:1/-1">Ficha técnica<textarea name="stats" required placeholder="Resultados, calendario, métricas, logros y objetivo deportivo"></textarea></label>
      <label style="grid-column:1/-1">Video de competencias o entrenamientos<input name="video_url" type="url" placeholder="https://youtube.com/... o https://vimeo.com/..."></label>
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
      const id = crypto.randomUUID();
      await api.insert("companies", { name: form.name.value, contact: form.email.value, status: "pending", interest: form.interest.value, owner: form.contact.value });
      if (demoMode) {
        await api.insert("profiles", { id, email: form.email.value, password: temporaryPassword(), role: "client", name: form.name.value, status: "pending", mustChangePassword: true });
      }
    } else if (type === "athlete") {
      const image_url = await fileToDataUrl(form.image.files[0]);
      await api.insert("athletes", { name: form.name.value, sport: form.sport.value, category: form.category.value, location: form.location.value, ranking: form.ranking.value, stats: form.stats.value, annual: Number(form.annual.value || 1000), video_url: form.video_url.value, status: "pending", image_url, visual_status: image_url ? "pending_review" : "approved" });
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
