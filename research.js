(function (root) {
  'use strict';
  const S = root.ROISResearchSchema, e = S.escape;
  const text = (lang, es, en) => lang === 'en' ? en : es;
  async function request(path, body, token) {
    const c = root.ROIS_CONFIG || {};
    const response = await fetch(`${c.supabaseUrl}/rest/v1/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { apikey: c.supabaseAnonKey, Authorization: `Bearer ${token || c.supabaseAnonKey}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message || `HTTP ${response.status}`);
    return data;
  }
  const tError = (error, lang) => {
    if (/duplicate_recipient/.test(error.message)) return text(lang,'Esta persona ya está registrada para esa empresa. Actualiza las respuestas y selecciona su registro del CRM.','This person is already registered for that company. Refresh responses and select their CRM record.');
    if (/expired|invalid_token/.test(error.message)) return text(lang,'El enlace es inválido o venció. Solicita uno nuevo a ROIS.','The link is invalid or expired. Please request a new one from ROIS.');
    if (/already_answered/.test(error.message)) return text(lang,'Esta invitación ya tiene una respuesta registrada. Contacta a ROIS si necesitas corregirla.','This invitation already has a response. Contact ROIS if it needs correction.');
    if (/duplicate_email/.test(error.message)) return text(lang,'Ese correo ya existe en el CRM. Selecciona el registro existente.','That email already exists in the CRM. Select the existing record.');
    if (/invalid_payload/.test(error.message)) return text(lang,'Revisa los campos obligatorios y el consentimiento.','Please check the required fields and consent.');
    return text(lang,'No se pudo completar la operación. Tus campos se conservan; vuelve a intentarlo.','The operation could not be completed. Your fields are preserved; please try again.');
  };
  function fieldMarkup(f, lang, answer) {
    const value = answer?.[f.name] || '';
    const attrs = `name="${f.name}" id="research-${f.name}" ${f.optional ? '' : 'required'} maxlength="${f.max || 2000}"`;
    const control = f.options ? `<select ${attrs}><option value="">${text(lang,'Seleccionar','Select')}</option>${f.options.map(o => `<option value="${o.value}" ${o.value === value ? 'selected' : ''}>${e(o[lang])}</option>`).join('')}</select>` : f.type === 'textarea' ? `<textarea ${attrs}>${e(value)}</textarea>` : `<input ${attrs} value="${e(value)}" autocomplete="off">`;
    return `<label class="${f.type === 'textarea' ? 'research-wide' : ''}" for="research-${f.name}">${e(f[lang])}${f.optional ? '' : ' *'}${control}</label>`;
  }
  function publicForm() {
    const host = document.getElementById('research-public');
    if (!host) return;
    let lang = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'es';
    const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
    let answers = {}, consent = false, contact = false, busy = false, complete = false;
    const capture = () => {
      const form = host.querySelector('form');
      if (!form) return;
      answers = Object.fromEntries(S.fields.map(f => [f.name, String(form.elements[f.name].value).trim()]));
      consent = form.elements.consent.checked; contact = form.elements.contact_consent.checked;
    };
    function render() {
      document.documentElement.lang = lang;
      document.title = text(lang,'Encuesta de empresas | ROIS TRADE','Company research | ROIS TRADE');
      document.querySelectorAll('[data-research-lang]').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.researchLang === lang)); b.disabled = busy; });
      const intro = `<p>ROIS TRADE / ${text(lang,'INVESTIGACIÓN DE MERCADO','MARKET RESEARCH')}</p><h1>${text(lang,'Después del capital, ¿qué sigue?','After funding, what comes next?')}</h1>`;
      if (complete) { host.innerHTML = `${intro}<h2 tabindex="-1" id="research-done">${text(lang,'Respuesta registrada. Gracias.','Response recorded. Thank you.')}</h2><p>${text(lang,'Tus respuestas se guardaron de forma privada en el CRM de ROIS. No necesitas crear una cuenta.','Your responses were saved privately in the ROIS CRM. No account is needed.')}</p>`; host.querySelector('h2').focus(); return; }
      if (!/^[a-f0-9]{64}$/.test(token)) { host.innerHTML = `${intro}<p role="alert">${text(lang,'Necesitas el enlace individual de invitación de ROIS para responder esta encuesta.','You need your individual ROIS invitation link to complete this survey.')}</p>`; return; }
      const groups = [text(lang,'1. Perfil de la empresa','1. Company profile'),text(lang,'2. Financiamiento','2. Financing'),text(lang,'3. Objetivos y obstáculos','3. Goals and obstacles'),text(lang,'4. Prioridad y recursos','4. Priority and resources')];
      host.innerHTML = `${intro}<p>${text(lang,'Buscamos entender los objetivos y obstáculos reales de las empresas después de recibir financiamiento. Esta encuesta no es una oferta de inversión ni garantiza servicios o capital.','We want to understand companies’ actual goals and obstacles after financing. This survey is not an investment offer and does not guarantee services or funding.')}</p><p>${text(lang,'Duración estimada: 7–10 minutos. Los campos con * son obligatorios. No incluyas secretos comerciales ni datos personales de terceros.','Estimated time: 7–10 minutes. Fields marked * are required. Do not include trade secrets or third-party personal information.')}</p><form>${groups.map((g,i) => `<fieldset><legend>${g}</legend><div class="research-form-grid">${S.fields.filter(f=>f.group===i).map(f=>fieldMarkup(f,lang,answers)).join('')}</div></fieldset>`).join('')}<p>${text(lang,'ROIS vinculará tus respuestas con la empresa invitada en su CRM. Solo administradores podrán consultar y exportar respuestas completas. Los resultados externos se presentarán de manera agregada.','ROIS will link your answers to the invited company in its CRM. Only administrators can access and export full responses. External findings will be presented in aggregate.')}</p><a href="./privacidad.html" target="_blank" rel="noopener noreferrer">${text(lang,'Aviso de privacidad (español)','Privacy notice (Spanish)')}</a><label class="research-check"><input name="consent" type="checkbox" required ${consent?'checked':''}><span>${text(lang,'Autorizo el tratamiento de estas respuestas para la investigación descrita y su registro en el CRM. *','I consent to these responses being processed for the research described and stored in the CRM. *')}</span></label><label class="research-check"><input name="contact_consent" type="checkbox" ${contact?'checked':''}><span>${text(lang,'Opcional: pueden contactarme para una entrevista de seguimiento sobre esta investigación.','Optional: you may contact me for a follow-up interview about this research.')}</span></label><button type="submit">${text(lang,'Enviar respuesta','Submit response')}</button><div class="research-message" role="status" aria-live="polite"></div></form>`;
      host.querySelector('form').onsubmit = async event => {
        event.preventDefault(); if (busy) return; capture();
        const payload = { version: 1, language: lang, answers, consent, contact_consent: contact };
        const error = S.validate(payload), status = host.querySelector('[role=status]');
        if (error) { status.textContent = text(lang,'Revisa los campos y el consentimiento. Si aún no recibiste financiamiento, selecciona “No aplica” en la fecha.','Check the fields and consent. If you have not received financing, select “Not applicable” for timing.'); return; }
        busy = true; host.querySelector('button[type=submit]').disabled = true;
        document.querySelectorAll('[data-research-lang]').forEach(b=>b.disabled=true);
        status.textContent = text(lang,'Guardando…','Saving…');
        try {
          const result = await request('rpc/rois_submit_research', { p_token: token, p_payload: payload });
          if (result?.status !== 'saved') throw new Error('unexpected_response');
          complete = true; busy = false; render();
        } catch (err) { status.textContent = tError(err,lang); busy=false; host.querySelector('button[type=submit]').disabled=false; document.querySelectorAll('[data-research-lang]').forEach(b=>b.disabled=false); }
      };
    }
    document.querySelectorAll('[data-research-lang]').forEach(b => b.onclick = () => { if(busy)return; capture(); lang=b.dataset.researchLang; const url=new URL(location.href);url.searchParams.set('lang',lang);history.replaceState(null,'',url);render(); });
    render();
  }
  function reportHtml(records, lang, filterDescription, includeDetails = true) {
    const stats = S.summarize(records), category = S.fields.find(f=>f.name==='category');
    const title = text(lang,'Investigación de empresas financiadas','Funded-company research');
    const row = (label,value) => `<tr><th>${e(label)}</th><td>${e(value)}</td></tr>`;
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>ROIS - ${title}</title><style>@page{size:A4;margin:18mm}*{box-sizing:border-box}body{font:11pt/1.5 Arial,sans-serif;color:#152033;margin:0}h1{font-size:25pt;color:#123b69}h2{font-size:15pt;margin-top:18px}h3{font-size:12pt;margin-bottom:5px}p,dd{white-space:pre-wrap;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #c7d3df;text-align:left;padding:5px;vertical-align:top}th{width:70%}tr{break-inside:avoid}dt{font-weight:bold;margin-top:15px;break-after:avoid}dd{margin:4px 0 12px}.response{break-before:page}small{color:#42546a}.notice{background:#edf3fa;padding:12px}button{padding:12px;margin:15px 0}@media print{.print-tools{display:none}}</style></head><body><div class="print-tools"><button onclick="window.print()">${text(lang,'Guardar como PDF / Imprimir','Save as PDF / Print')}</button><p>${text(lang,'En el diálogo de impresión selecciona “Guardar como PDF”.','Select “Save as PDF” in the print dialog.')}</p></div><small>ROIS TRADE · ${text(lang,'CONFIDENCIAL / USO INTERNO','CONFIDENTIAL / INTERNAL USE')}</small><h1>${title}</h1><p>${text(lang,'Generado','Generated')}: ${e(new Date().toISOString())}<br>${text(lang,'Filtros','Filters')}: ${e(filterDescription)}<br>${text(lang,'Versión del cuestionario','Questionnaire version')}: 1</p><p class="notice">${text(lang,'Muestra exploratoria por invitación, no representativa del universo mundial. Las cifras describen únicamente las respuestas seleccionadas; no prueban causalidad ni intención de compra. Las respuestas abiertas conservan el idioma original.','Invitation-based exploratory sample, not representative of companies worldwide. Figures describe only the selected responses; they do not establish causality or purchase intent. Open answers retain their original language.')}</p><h2>${text(lang,'Resumen de la selección','Selection summary')}</h2><table>${row(text(lang,'Respuestas','Responses'),stats.total)}${row(text(lang,'Financiamiento recibido en los últimos 12 meses','Financing received within 12 months'),stats.eligible)}${row(text(lang,'Presupuesto aprobado (declarado)','Approved budget (self-reported)'),stats.budgets.approved)}${row(text(lang,'Aceptan entrevista de seguimiento','Opted in to a follow-up interview'),records.filter(r=>r.contact_consent).length)}</table><h2>${text(lang,'Principal obstáculo: clasificación del participante','Main obstacle: respondent classification')}</h2><p>${text(lang,'Denominador: todas las respuestas seleccionadas, incluidas “ninguno” y “no lo sé”.','Denominator: all selected responses, including “none” and “unsure”.')}</p><table>${category.options.map(o=>row(o[lang],`${stats.categories[o.value]} / ${stats.total} (${stats.total?Math.round(stats.categories[o.value]*100/stats.total):0}%)`)).join('')}</table>${includeDetails ? records.map(r=>`<section class="response"><h2>${e(r.answers.company)}</h2><small>ID: ${e(r.id)} · CRM: ${e(r.crm_id)}<br>${e(r.created_at)} · ${e(r.language.toUpperCase())} · v${e(r.version)}</small><dl>${S.fields.map(f=>`<dt>${e(f[lang])}</dt><dd>${e(S.valueLabel(f,r.answers[f.name],lang))}</dd>`).join('')}<dt>${text(lang,'Consentimiento de investigación','Research consent')}</dt><dd>${text(lang,'Aceptado','Accepted')} · ${e(r.consent_at)}</dd><dt>${text(lang,'Permiso de contacto para entrevista','Permission to contact for an interview')}</dt><dd>${r.contact_consent?text(lang,'Sí','Yes'):text(lang,'No','No')}</dd></dl></section>`).join('') : `<p>${text(lang,'Exportación agregada: se omitieron nombres, identificadores y respuestas individuales.','Aggregate export: names, identifiers and individual answers were omitted.')}</p>`}</body></html>`;
  }
  function adminMarkup(lang) {
    return `<section class="research-admin" id="research-admin" data-no-translate translate="no"><p class="eyebrow">ROIS / RESEARCH</p><h3>${text(lang,'Investigación de mercado','Market research')}</h3><p>${text(lang,'Encuesta ES/EN vinculada al CRM. Crea enlaces individuales; no se envían correos automáticamente.','ES/EN survey linked to the CRM. Create individual links; no emails are sent automatically.')}</p><div id="research-admin-content" role="status">${text(lang,'Cargando investigación…','Loading research…')}</div></section>`;
  }
  async function mountAdmin(options) {
    const host = document.getElementById('research-admin'); if(!host)return;
    const lang=options.language==='en'?'en':'es', token=options.token;
    if (!token || options.demo) { host.querySelector('#research-admin-content').textContent=text(lang,'Conecta una sesión administrativa real para gestionar la encuesta. La vista previa no guarda respuestas.','Use a real administrator session to manage the survey. Preview does not save responses.'); return; }
    let records=[], invitations=[], companies=[];
    const loadAll = async(table,query='select=*') => {
      const all=[];
      // Continue until an empty page: this also handles server-side limits below 200.
      for(let offset=0;;){const batch=await request(`${table}?${query}&order=id.asc&limit=200&offset=${offset}`,undefined,token);if(!Array.isArray(batch))throw Error('invalid_response');if(!batch.length)return all;all.push(...batch);offset+=batch.length;}
    };
    try {
      [records,invitations,companies]=await Promise.all([loadAll('research_responses'),loadAll('research_invitations','select=id,crm_id,recipient_name,created_at,expires_at,responded_at'),loadAll('crm','select=id,name,organization&prospect_type=eq.company')]);
    }catch(err){if(!host.isConnected)return;host.querySelector('#research-admin-content').innerHTML=`<p class="research-error">${text(lang,'No se pudo cargar la investigación. Verifica la sesión, la conexión y la migración de base de datos.','Could not load research. Check your session, connection and database migration.')}</p><button type="button" id="research-retry">${text(lang,'Reintentar','Retry')}</button>`;host.querySelector('#research-retry').onclick=()=>mountAdmin(options);return;}
    if(!host.isConnected)return;
    const L=(es,en)=>text(lang,es,en), selects=['country'];
    host.querySelector('#research-admin-content').innerHTML=`<details><summary>${L('Crear invitación / enlace ES–EN','Create invitation / ES–EN link')}</summary><form id="research-invite"><div class="research-toolbar"><label>${L('Empresa del CRM','CRM company')}<select name="crm_id"><option value="">${L('Crear nuevo registro de investigación','Create new research record')}</option>${companies.sort((a,b)=>a.name.localeCompare(b.name)).map(c=>`<option value="${e(c.id)}">${e(c.organization||c.name)}${c.organization && c.organization!==c.name ? ` · ${e(c.name)}` : ''}</option>`).join('')}</select></label><label data-new-company>${L('Nueva empresa','New company')}<input name="company" maxlength="180" required></label><label>${L('Nombre del destinatario','Recipient name')}<input name="recipient_name" maxlength="160" autocomplete="name" required></label><button type="submit">${L('Generar enlaces','Generate links')}</button></div><p>${L('Vigencia: 30 días. Regenerar un enlace pendiente invalida el anterior. Una respuesta por empresa invitada en esta versión.','Valid for 30 days. Regenerating a pending link invalidates the old one. One response per invited company for this version.')}</p><div class="research-message" role="status"></div><div class="research-links"></div></form></details><div class="research-toolbar"><button type="button" id="research-refresh">${L('Actualizar respuestas','Refresh responses')}</button><button type="button" id="research-pdf">${L('Exportar selección a PDF','Export selection to PDF')}</button><label><span>${L('Incluir respuestas completas','Include full responses')}</span><input type="checkbox" id="research-full" checked></label></div><div class="research-filters">${selects.map(name=>{const f=S.fields.find(f=>f.name===name);const values=[...new Set(records.map(r=>r.answers[name]))].filter(Boolean).sort();return `<label>${e(f[lang])}<select data-research-filter="${name}"><option value="">${L('Todos','All')}</option>${values.map(v=>`<option value="${e(v)}">${e(S.valueLabel(f,v,lang))}</option>`).join('')}</select></label>`;}).join('')}<label>${L('Ordenar por','Sort by')}<select id="research-sort"><option value="newest">${L('Fecha: más recientes','Date: newest first')}</option><option value="oldest">${L('Fecha: más antiguas','Date: oldest first')}</option><option value="country">${L('País: A–Z','Country: A–Z')}</option></select></label><label>${L('Respondida desde','Answered from')}<input type="date" id="research-from"></label><label>${L('Respondida hasta','Answered through')}<input type="date" id="research-to"></label></div><div id="research-results"></div><details><summary>${L('Seguimiento de invitaciones','Invitation tracking')} (${invitations.length})</summary><div class="research-table-wrap"><table><thead><tr><th>${L('Empresa','Company')}</th><th>${L('Destinatario','Recipient')}</th><th>${L('Estado','Status')}</th><th>${L('Vence','Expires')}</th></tr></thead><tbody>${invitations.map(i=>`<tr><td>${e(companies.find(c=>c.id===i.crm_id)?.organization||companies.find(c=>c.id===i.crm_id)?.name||i.crm_id)}</td><td>${e(i.recipient_name||'—')}</td><td>${i.responded_at?L('Respondida','Answered'):new Date(i.expires_at)<new Date()?L('Vencida','Expired'):L('Enlace generado; envío no verificado','Link generated; delivery not verified')}</td><td>${e(i.expires_at.slice(0,10))}</td></tr>`).join('')}</tbody></table></div></details>`;
    let filtered=[], pageIndex=0;
    const filterDescription=()=>[...host.querySelectorAll('[data-research-filter],#research-sort,#research-from,#research-to')].filter(el=>el.value).map(el=>`${el.closest('label').firstChild.textContent.trim()}: ${el.tagName==='SELECT'?el.selectedOptions[0].textContent:el.value}`).join(' | ')||L('Sin filtros','No filters');
    function draw(reset=true){
      if(reset)pageIndex=0;
      const sort=host.querySelector('#research-sort').value,from=host.querySelector('#research-from').value,to=host.querySelector('#research-to').value;
      filtered=records.filter(r=>(!from||r.created_at.slice(0,10)>=from)&&(!to||r.created_at.slice(0,10)<=to)&&[...host.querySelectorAll('[data-research-filter]')].every(el=>!el.value||r.answers[el.dataset.researchFilter]===el.value)).sort((a,b)=>(sort==='country'?a.answers.country.localeCompare(b.answers.country,lang,{sensitivity:'base'}):0)||(sort==='oldest'?a.created_at.localeCompare(b.created_at):b.created_at.localeCompare(a.created_at))||a.id.localeCompare(b.id));
      const stats=S.summarize(filtered);
      host.querySelector('#research-pdf').disabled=!filtered.length;
      host.querySelector('#research-results').innerHTML=`<div class="research-kpis"><div><strong>${filtered.length} / ${records.length}</strong>${L('Respuestas seleccionadas / total','Selected responses / total')}</div><div><strong>${stats.eligible}</strong>${L('Financiadas en últimos 12 meses','Financed within 12 months')}</div><div><strong>${stats.budgets.approved}</strong>${L('Presupuesto aprobado declarado','Reported approved budget')}</div></div><p>${L('Muestra exploratoria por invitación. No representa a todas las empresas; presupuesto no equivale a intención de compra.','Invitation-based exploratory sample. Not representative of all companies; budget is not purchase intent.')}</p>${!filtered.length?`<p>${L('No hay respuestas para esta selección.','No responses match this selection.')}</p>`:filtered.slice(pageIndex*20,(pageIndex+1)*20).map(r=>`<details><summary>${e(r.answers.company)} · ${e(r.answers.country)} · ${e(r.created_at.slice(0,10))} · ${e(r.language.toUpperCase())}</summary><p>CRM: ${e(r.crm_id)}<br>${L('Permite entrevista','Interview opt-in')}: ${r.contact_consent?L('Sí','Yes'):L('No','No')}</p><button type="button" data-research-pdf-id="${e(r.id)}">${L('PDF individual','Individual PDF')}</button><dl>${S.fields.map(f=>`<dt>${e(f[lang])}</dt><dd>${e(S.valueLabel(f,r.answers[f.name],lang))}</dd>`).join('')}</dl></details>`).join('')}`;
      const pages=Math.ceil(filtered.length/20);
      if(pages>1){host.querySelector('#research-results').insertAdjacentHTML('beforeend',`<div class="research-toolbar"><button type="button" id="research-prev" ${pageIndex===0?'disabled':''}>${L('Anterior','Previous')}</button><span>${pageIndex+1} / ${pages}</span><button type="button" id="research-next" ${pageIndex>=pages-1?'disabled':''}>${L('Siguiente','Next')}</button><span>${L('El PDF incluye toda la selección, no solo esta página.','The PDF includes the entire selection, not just this page.')}</span></div>`);host.querySelector('#research-prev').onclick=()=>{pageIndex--;draw(false);};host.querySelector('#research-next').onclick=()=>{pageIndex++;draw(false);};}
      host.querySelectorAll('[data-research-pdf-id]').forEach(b=>b.onclick=()=>openReport([records.find(r=>r.id===b.dataset.researchPdfId)],true));
    }
    function openReport(rows,full){const w=window.open('','_blank');if(!w){alert(L('Permite ventanas emergentes para abrir el PDF.','Allow pop-ups to open the PDF report.'));return;}w.opener=null;w.document.open();w.document.write(reportHtml(rows,lang,filterDescription(),full));w.document.close();w.focus();}
    host.querySelector('#research-pdf').onclick=()=>openReport(filtered,host.querySelector('#research-full').checked);
    host.querySelector('#research-refresh').onclick=()=>mountAdmin(options);
    host.querySelectorAll('.research-filters input,.research-filters select').forEach(el=>el.addEventListener('input',draw));draw();
    const form=host.querySelector('#research-invite');
    form.elements.crm_id.onchange=()=>{const existing=!!form.elements.crm_id.value;form.querySelectorAll('[data-new-company]').forEach(el=>el.hidden=existing);form.elements.company.required=!existing;};
    form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button[type=submit]');if(button.disabled)return;button.disabled=true;const status=form.querySelector('[role=status]');status.textContent=L('Generando…','Generating…');form.querySelector('.research-links').replaceChildren();try{
      const result=await request('rpc/rois_create_named_research_invitation',{p_crm_id:form.elements.crm_id.value||null,p_company:form.elements.company.value.trim(),p_recipient_name:form.elements.recipient_name.value.trim()},token);
      if(!result?.token)throw Error('invalid_response');
      // Retain the server-created CRM ID so retrying/regenerating cannot create another prospect.
      if (result.crm_id && ![...form.elements.crm_id.options].some(o=>o.value===result.crm_id)) {
        form.elements.crm_id.add(new Option(form.elements.company.value.trim()+' · '+form.elements.recipient_name.value.trim(),result.crm_id));
      }
      if(result.crm_id){form.elements.crm_id.value=result.crm_id;form.elements.crm_id.onchange();}
      const base=new URL('./encuesta.html',location.href);
      form.querySelector('.research-links').innerHTML=['es','en'].map(l=>{const url=new URL(base);url.searchParams.set('lang',l);url.hash=`token=${result.token}`;return `<label>${l==='es'?'Español':'English'}<input readonly value="${e(url.href)}"></label><button type="button" data-copy-lang="${l}">${L('Copiar','Copy')} ${l.toUpperCase()}</button>`;}).join('');
      form.querySelectorAll('[data-copy-lang]').forEach(b=>b.onclick=async()=>{const input=b.previousElementSibling.querySelector('input');try{await navigator.clipboard.writeText(input.value);status.textContent=L('Enlace copiado.','Link copied.');}catch{input.focus();input.select();status.textContent=L('Copia el enlace seleccionado.','Copy the selected link.');}});
      status.textContent=L('Enlaces listos. Cópialos antes de actualizar. No se envió ningún correo.','Links ready. Copy them before refreshing. No email was sent.');
    }catch(err){status.textContent=tError(err,lang);}finally{button.disabled=false;}};
  }
  root.ROISResearch={adminMarkup,mountAdmin,reportHtml};
  if(typeof module!=='undefined')module.exports=root.ROISResearch;
  if(typeof document!=='undefined')publicForm();
})(typeof window!=='undefined'?window:globalThis);
