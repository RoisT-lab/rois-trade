const assert = require('node:assert/strict');
const S=require('../research-schema.js');
const R=require('../research.js');
const answers=Object.fromEntries(S.fields.map(f=>[f.name,f.options?f.options[0].value:'Respuesta de prueba: innovación, México & <script>alert(1)</script>']));
answers.country='México';
const payload={version:1,language:'es',answers,consent:true,contact_consent:false};
assert.equal(S.validate(payload),null);
for(const language of ['en','es'])assert.equal(S.validate({...payload,language}),null);
assert.equal(S.validate({...payload,consent:false}),'consent');
assert.equal(S.validate({...payload,contact_consent:'false'}),'consent');
assert.equal(S.validate({...payload,language:'fr'}),'consent');
assert.equal(S.validate({...payload,answers:{...answers,budget:'sí'}}),'budget');
assert.equal(S.validate({...payload,answers:{...answers,company:'x'.repeat(181)}}),'company');
assert.equal(S.validate({...payload,answers:{...answers,funding_type:'none'}}),'funding_recency');
assert.equal(S.validate({...payload,answers:{...answers,funding_type:'none',funding_recency:'na',funding_amount:''}}),null);
for(const f of S.fields){assert(f.es&&f.en);for(const o of f.options||[])assert(o.es&&o.en);}
const row={id:'qa-response',crm_id:'qa-company',...payload,created_at:'2026-09-15T00:00:00Z',consent_at:'2026-09-15T00:00:00Z'};
const summary=S.summarize([row]);assert.equal(summary.total,1);assert.equal(summary.eligible,1);assert.equal(summary.categories.customers,1);
for(const lang of ['es','en']){
 const report=R.reportHtml([row],lang,'<script>bad</script>',true);
 assert(!report.includes('<script>'));assert(report.includes('&lt;script&gt;'));
 for(const f of S.fields)assert(report.includes(S.escape(f[lang])));
 assert(report.includes('qa-company'));assert(report.includes('1 / 1 (100%)'));
 const aggregate=R.reportHtml([row],lang,'All',false);assert(!aggregate.includes('qa-company'));assert(!aggregate.includes('qa-response'));assert(!aggregate.includes(answers.respondent));
}
assert.equal(S.summarize([]).total,0);
console.log('Research unit tests passed: schema, bilingual parity, validation, consent, eligibility, denominators, escaping, complete/aggregate reports.');
