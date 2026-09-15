/* Shared, versioned questionnaire. Stored option codes never depend on display language. */
(function (root) {
  const option = (value, es, en) => ({ value, es, en });
  const fields = [
    { name: 'company', group: 0, es: 'Empresa', en: 'Company', max: 180 },
    { name: 'respondent', group: 0, es: 'Nombre de quien responde', en: 'Respondent name', max: 160 },
    { name: 'role', group: 0, es: 'Cargo o responsabilidad', en: 'Role or responsibility', max: 160 },
    { name: 'country', group: 0, es: 'País donde opera principalmente', en: 'Primary country of operation', max: 100 },
    { name: 'sector', group: 0, es: 'Sector / industria', en: 'Sector / industry', max: 160 },
    { name: 'business_model', group: 0, es: 'Modelo de negocio', en: 'Business model', options: [option('b2b','B2B · Empresas','B2B · Businesses'),option('b2c','B2C · Consumidores','B2C · Consumers'),option('b2b2c','B2B2C','B2B2C'),option('other','Otro','Other')] },
    { name: 'stage', group: 0, es: 'Etapa actual', en: 'Current stage', options: [option('pre_revenue','Antes de ingresos','Pre-revenue'),option('early_revenue','Primeros ingresos','Early revenue'),option('growth','Crecimiento','Growth'),option('established','Consolidada','Established')] },
    { name: 'funding_type', group: 1, es: 'Tipo del financiamiento más reciente', en: 'Most recent financing type', options: [option('equity','Capital accionario','Equity'),option('debt','Deuda','Debt'),option('mixed','Mixto','Mixed'),option('other','Otro','Other'),option('none','Aún no hemos recibido financiamiento','We have not received financing yet')] },
    { name: 'funding_recency', group: 1, es: '¿Cuándo recibieron ese financiamiento?', en: 'When did you receive that financing?', options: [option('0_3','Hace 0–3 meses','0–3 months ago'),option('4_6','Hace 4–6 meses','4–6 months ago'),option('7_12','Hace 7–12 meses','7–12 months ago'),option('over_12','Hace más de 12 meses','Over 12 months ago'),option('na','No aplica / no lo sé','Not applicable / unsure')] },
    { name: 'funding_amount', group: 1, optional: true, es: 'Monto aproximado de esa ronda (equivalente en USD, opcional)', en: 'Approximate round size (USD equivalent, optional)', options: [option('under_250k','Menos de US$250 mil','Under US$250K'),option('250k_1m','US$250 mil–1 millón','US$250K–1M'),option('1m_5m','Más de US$1–5 millones','Over US$1M–5M'),option('5m_20m','Más de US$5–20 millones','Over US$5M–20M'),option('over_20m','Más de US$20 millones','Over US$20M'),option('undisclosed','Prefiero no compartirlo','Prefer not to say')] },
    { name: 'objective', group: 2, type: 'textarea', es: '¿Qué resultado concreto buscan conseguir con el financiamiento?', en: 'What specific outcome do you aim to achieve with the financing?' },
    { name: 'obstacle', group: 2, type: 'textarea', es: '¿Cuál es el principal obstáculo? Describe una situación reciente. Si no hay uno relevante, indícalo.', en: 'What is the main obstacle? Describe a recent situation. If there is no significant obstacle, please say so.' },
    { name: 'impact', group: 2, type: 'textarea', es: '¿Qué consecuencias tiene? Puedes describir costos, retrasos u otro impacto, sin revelar cifras confidenciales.', en: 'What are the consequences? Describe costs, delays or other impacts without disclosing confidential figures.' },
    { name: 'attempts', group: 2, type: 'textarea', es: '¿Qué han intentado y qué resultado obtuvieron?', en: 'What have you tried, and what happened?' },
    { name: 'current_solution', group: 2, type: 'textarea', es: '¿Qué personas, proveedores o herramientas utilizan actualmente para resolverlo?', en: 'Which people, providers or tools currently help you address it?' },
    { name: 'decision_maker', group: 2, type: 'textarea', es: '¿Qué cargo o área decide cómo resolverlo? No necesitas proporcionar nombres.', en: 'Which role or department decides how to address it? Names are not required.' },
    { name: 'category', group: 3, es: 'Después de describirlo: ¿cómo clasificarías el principal obstáculo?', en: 'After describing it: how would you classify the main obstacle?', options: [option('customers','Adquisición de clientes / ventas','Customer acquisition / sales'),option('expansion','Entrada a mercados / distribución','Market entry / distribution'),option('operations','Operación / procesos','Operations / processes'),option('talent','Contratación / talento','Hiring / talent'),option('product','Producto / tecnología','Product / technology'),option('finance','Finanzas / flujo de efectivo','Finance / cash flow'),option('compliance','Regulación / cumplimiento','Regulation / compliance'),option('other','Otro','Other'),option('none','No hay un obstáculo relevante','No significant obstacle'),option('unknown','No lo sé','Unsure')] },
    { name: 'budget', group: 3, es: '¿Existe presupuesto para resolverlo?', en: 'Is there a budget to address it?', options: [option('approved','Asignado / aprobado','Allocated / approved'),option('pending','Pendiente de aprobación','Pending approval'),option('none','No hay presupuesto','No budget'),option('unknown','No lo sé / prefiero no compartir','Unsure / prefer not to say')] },
    { name: 'urgency', group: 3, es: '¿En qué plazo necesitan mejorar esta situación?', en: 'When do you need to improve this situation?', options: [option('30d','En los próximos 30 días','Within 30 days'),option('90d','En los próximos 3 meses','Within 3 months'),option('180d','En los próximos 6 meses','Within 6 months'),option('later','Después de 6 meses','After 6 months'),option('none','Sin plazo / no aplica','No deadline / not applicable')] }
  ];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function validate(data) {
    if (!data || !['es','en'].includes(data.language) || data.version !== 1 || data.consent !== true || typeof data.contact_consent !== 'boolean') return 'consent';
    for (const f of fields) {
      const v = data.answers?.[f.name];
      if (f.optional && (v === '' || v == null)) continue;
      if (typeof v !== 'string' || !v.trim() || v.length > (f.max || 2000)) return f.name;
      if (f.options && !f.options.some(o => o.value === v)) return f.name;
    }
    if (data.answers.funding_type === 'none' && data.answers.funding_recency !== 'na') return 'funding_recency';
    return null;
  }
  function valueLabel(f, value, lang) { return f.options?.find(o => o.value === value)?.[lang] || value || (lang === 'en' ? 'Not provided' : 'No proporcionado'); }
  function summarize(records) {
    const eligible = records.filter(r => ['0_3','4_6','7_12'].includes(r.answers.funding_recency) && r.answers.funding_type !== 'none');
    const count = name => Object.fromEntries(fields.find(f => f.name === name).options.map(o => [o.value, records.filter(r => r.answers[name] === o.value).length]));
    return { total: records.length, eligible: eligible.length, categories: count('category'), budgets: count('budget'), urgency: count('urgency') };
  }
  root.ROISResearchSchema = { version: 1, fields, escape, validate, valueLabel, summarize };
  if (typeof module !== 'undefined') module.exports = root.ROISResearchSchema;
})(typeof window !== 'undefined' ? window : globalThis);
