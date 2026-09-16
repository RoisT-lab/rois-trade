/* Browser QA uses mocked API data only. It never writes production responses. */
const assert=require('node:assert/strict'), http=require('node:http'), fs=require('node:fs'), path=require('node:path');
const {chromium}=require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const S=require('../research-schema.js'), R=require('../research.js');
const root=path.resolve(__dirname,'..'), out=path.join(root,'tmp/research-qa');fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{const content=fs.readFileSync(file);res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');res.end(content);}catch{res.writeHead(404).end();}});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',err=>errors.push(err.message));
  const token='a'.repeat(64);let saved, attempts=0;
  await page.route('**/rest/v1/rpc/rois_submit_research',route=>{saved=route.request().postDataJSON();attempts++;return route.fulfill({status:attempts===1?503:200,contentType:'application/json',body:JSON.stringify(attempts===1?{message:'temporary failure'}:{status:'saved'})});});
  await page.goto(`${base}/encuesta.html?lang=es#token=${token}`);
  for(const f of S.fields){const el=page.locator(`[name="${f.name}"]`);if(f.options)await el.selectOption(f.options[0].value);else await el.fill(f.name==='country'?'México':`Prueba ${f.name}: crecimiento e innovación`);}
  await page.getByRole('button',{name:'English',exact:true}).click();
  assert.equal(await page.locator('[name=country]').inputValue(),'México');assert.equal(await page.locator('html').getAttribute('lang'),'en');
  await page.locator('[name=consent]').check();await page.getByRole('button',{name:'Submit response',exact:true}).click();
  await page.getByRole('status').filter({hasText:'could not be completed'}).waitFor();
  assert.equal(await page.locator('[name=country]').inputValue(),'México');
  await page.getByRole('button',{name:'Submit response',exact:true}).click();await page.getByText('Response recorded. Thank you.',{exact:true}).waitFor();
  assert.equal(saved.p_payload.language,'en');assert.equal(saved.p_payload.contact_consent,false);assert.equal(saved.p_token,token);
  await page.goto(`${base}/encuesta.html`);await page.getByRole('alert').waitFor();assert.equal(await page.locator('form').count(),0);
  await page.setViewportSize({width:390,height:844});await page.goto(`${base}/encuesta.html?lang=es#token=${token}`);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'survey-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(out,'survey-desktop.png'),fullPage:true});
  const answers=Object.fromEntries(S.fields.map(f=>[f.name,f.options?f.options[0].value:`Respuesta ${f.name}: análisis comercial, expansión y ejecución.`]));
  answers.company='QA Investigación México';answers.country='México';answers.obstacle='Un obstáculo con evidencia y seguimiento. '.repeat(45);answers.impact='Texto de prueba <script>alert("unsafe")</script> & 日本';
  const row={id:'qa-response',crm_id:'qa-crm',version:1,language:'es',answers,contact_consent:false,created_at:'2026-09-15T12:00:00Z',consent_at:'2026-09-15T12:00:00Z'};
  const rows=Array.from({length:205},(_,i)=>({...row,id:`qa-response-${String(i).padStart(3,'0')}`,crm_id:`qa-crm-${i}`,answers:{...answers,company:`Empresa ${i}`,country:i===204?'Canada':'México'}}));
  await page.route('**/rest/v1/**',route=>{const url=new URL(route.request().url());const offset=Number(url.searchParams.get('offset')||0);let data=[];if(url.pathname.endsWith('/research_responses'))data=rows.slice(offset,offset+200);if(url.pathname.endsWith('/crm'))data=offset?[]:[{id:'qa-crm',name:'QA Company',email:'qa@example.invalid'}];return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});});
  await page.goto(`${base}/encuesta.html`);
  await page.evaluate(async()=>{document.body.innerHTML=ROISResearch.adminMarkup('es');await ROISResearch.mountAdmin({language:'es',token:'qa',demo:false});});
  await page.getByText('205 / 205',{exact:true}).waitFor();
  assert.equal(await page.locator('.research-filters input,.research-filters select').count(),4);
  assert.equal(await page.locator('#research-search,[data-research-filter=language],[data-research-filter=sector]').count(),0);
  await page.locator('#research-sort').selectOption('country');
  assert((await page.locator('#research-results details summary').first().innerText()).includes('Canada'));
  await page.locator('#research-from').fill('2026-09-16');
  await page.getByText('0 / 205',{exact:true}).waitFor();
  await page.locator('#research-from').fill('');
  await page.locator('#research-to').fill('2026-09-14');
  await page.getByText('0 / 205',{exact:true}).waitFor();
  await page.locator('#research-to').fill('');
  await page.locator('[data-research-filter=country]').selectOption('Canada');await page.getByText('1 / 205',{exact:true}).waitFor();
  const popupPromise=page.waitForEvent('popup');await page.locator('#research-pdf').click();const popup=await popupPromise;await popup.waitForLoadState();
  assert((await popup.locator('body').innerText()).includes('Empresa 204'));assert(!(await popup.locator('body').innerText()).includes('Empresa 203'));await popup.close();
  await page.screenshot({path:path.join(out,'admin-research.png'),fullPage:true});
  // Exercise the new module inside the real dashboard markup and CSS, in both themes.
  await page.goto(`${base}/index.html`);
  await page.evaluate(async()=>{
    state.session={id:'qa-admin',role:'admin',token:'qa',name:'QA',email:'qa@example.invalid'};
    state.data={...state.data,crm:[]};
    document.querySelectorAll('.view').forEach(el=>el.classList.remove('active'));
    document.getElementById('adminView').classList.add('active');
    document.querySelectorAll('#adminView [data-dashboard-panel]').forEach(el=>el.classList.remove('active'));
    document.querySelector('[data-dashboard-panel="admin-crm"]').classList.add('active');
    document.body.dataset.activeView='admin';renderAdminCrm();
  });
  await page.locator('#research-admin').getByText('205 / 205',{exact:true}).waitFor();
  assert.equal(await page.locator('#admin-crm-invite-fields').isVisible(),false);
  assert.equal(await page.locator('#admin-crm-invite-toggle').getAttribute('aria-expanded'),'false');
  await page.locator('#admin-crm-invite-toggle').click();
  assert.equal(await page.locator('#admin-crm-invite-fields').isVisible(),true);
  const commercialField=page.locator('#admin-crm-invite-fields input:not([type=hidden])').first();
  await commercialField.fill('Conservar borrador');
  await page.locator('#admin-crm-invite-toggle').click();
  assert.equal(await page.locator('#admin-crm-invite-fields').isVisible(),false);
  await page.locator('#admin-crm-invite-toggle').click();
  assert.equal(await commercialField.inputValue(),'Conservar borrador');
  await page.locator('#admin-crm-invite-toggle').click();
  assert.equal(await page.locator('#research-results details').count(),20);
  await page.locator('#research-next').click();
  assert.equal(await page.locator('#research-results details').count(),20);
  await page.locator('[data-research-filter=country]').selectOption('Canada');
  for(const theme of ['dark','light']){
    await page.evaluate(t=>{document.body.dataset.dashboardTheme=t;},theme);
    await page.locator('#research-admin').screenshot({path:path.join(out,`admin-${theme}.png`)});
    assert(await page.locator('#research-admin').evaluate(el=>el.scrollWidth<=el.clientWidth));
  }
  await page.evaluate(()=>setDashboardLanguage('en'));
  await page.locator('#research-admin').getByText('Market research',{exact:true}).waitFor();
  await page.locator('#research-admin').getByText('205 / 205',{exact:true}).waitFor();
  await page.locator('#research-admin details').first().locator('summary').click();
  await page.locator('#research-invite [name=company]').fill('QA New Company');
  assert.equal(await page.locator('#research-invite [name=email]').count(),0);
  assert.equal(await page.locator('#admin-crm-invite-toggle').innerText(),'Send commercial invitation');
  await page.locator('#research-invite [name=recipient_name]').fill('Álvaro Pérez');
  let invitationPayload;
  await page.route('**/rest/v1/rpc/rois_create_named_research_invitation',route=>{invitationPayload=route.request().postDataJSON();return route.fulfill({contentType:'application/json',body:JSON.stringify({token:'b'.repeat(64),crm_id:'qa-new-crm'})});});
  await page.locator('#research-invite').getByRole('button',{name:'Generate links',exact:true}).click();
  await page.locator('.research-links input').first().waitFor();
  assert((await page.locator('.research-links input').first().inputValue()).includes('lang=es#token='));
  assert((await page.locator('.research-links input').last().inputValue()).includes('lang=en#token='));
  assert.deepEqual(invitationPayload,{p_crm_id:null,p_company:'QA New Company',p_recipient_name:'Álvaro Pérez'});
  assert.equal(await page.locator('#research-invite [name=crm_id]').inputValue(),'qa-new-crm');
  assert.equal(await page.locator('#research-invite [name=company]').isVisible(),false);
  let copyCalls=[], missingLegacy=false;
  await page.route('**/rest/v1/rpc/rois_get_research_invitation_link',route=>{
    const payload=route.request().postDataJSON();copyCalls.push(payload);
    if(missingLegacy&&!payload.p_replace)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'link_unavailable'})});
    return route.fulfill({contentType:'application/json',body:JSON.stringify({token:'b'.repeat(64),crm_id:payload.p_crm_id,expires_at:'2026-10-15'})});
  });
  await page.locator('#research-invite').getByRole('button',{name:'Get link',exact:true}).click();
  await page.locator('#research-link-dialog .research-links input').first().waitFor();
  const recoveredLink=await page.locator('#research-link-dialog .research-links input').first().inputValue();
  assert(recoveredLink.includes('lang=es#token='+'b'.repeat(64)));
  assert.deepEqual(copyCalls,[{p_crm_id:'qa-new-crm',p_replace:false}]);
  await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw Error('clipboard denied for QA');};});
  await page.getByRole('button',{name:'Copy link ES',exact:true}).click();
  await page.getByText('Select and copy the displayed link.',{exact:true}).waitFor();
  await page.locator('#research-link-dialog').getByRole('button',{name:'Close',exact:true}).click();
  // Reloading UI state still retrieves the server-stored link.
  await page.evaluate(()=>ROISResearch.copyInvitation({crmId:'qa-new-crm',language:'en',token:'qa'}));
  assert.equal(await page.locator('#research-link-dialog .research-links input').first().inputValue(),recoveredLink);
  await page.locator('#research-link-dialog').getByRole('button',{name:'Close',exact:true}).click();
  missingLegacy=true;
  await page.evaluate(()=>ROISResearch.copyInvitation({crmId:'qa-new-crm',language:'en',token:'qa'}));
  await page.getByRole('button',{name:'Create replacement link',exact:true}).waitFor();
  const beforeCancel=copyCalls.length;page.once('dialog',d=>d.dismiss());
  await page.getByRole('button',{name:'Create replacement link',exact:true}).click();
  assert.equal(copyCalls.length,beforeCancel);
  page.once('dialog',d=>d.accept());
  await page.getByRole('button',{name:'Create replacement link',exact:true}).click();
  await page.locator('#research-link-dialog .research-links input').first().waitFor();
  assert.deepEqual(copyCalls.at(-1),{p_crm_id:'qa-new-crm',p_replace:true});
  await page.locator('#research-link-dialog').screenshot({path:path.join(out,'copy-link-dialog.png')});
  await page.locator('#research-link-dialog').getByRole('button',{name:'Close',exact:true}).click();
  const researchActions=await page.evaluate(()=>crmProspectActions({id:'qa-new-crm',name:'QA',source:'funding_research_v1'}));
  assert(researchActions.includes('Copy survey link'));assert(!researchActions.includes('Enviar'));
  for(const lang of ['es','en']){
   await page.setContent(R.reportHtml([row],lang,'País: México',true));
   await page.pdf({path:path.join(out,`research-${lang}.pdf`),format:'A4',printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="font-size:9px;width:100%;text-align:center">ROIS · <span class="pageNumber"></span> / <span class="totalPages"></span></div>'});
  }
  assert.deepEqual(errors,[]);console.log('Browser QA passed: ES/EN, preserved input, retry, consent, token gating, mobile overflow, 205-row pagination, filtering, report selection. PDFs in '+out);
 }finally{await browser.close();server.close();}
})().catch(err=>{console.error(err);server.close();process.exitCode=1;});
