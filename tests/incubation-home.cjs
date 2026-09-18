/* Local regression only: every external request is intercepted, including Auth. */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname,'..');
const output = path.join(root,'tmp/incubation-qa');
fs.mkdirSync(output,{recursive:true});
const server = http.createServer((req,res)=>{
  const pathname = new URL(req.url,'http://local').pathname;
  const file = path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try {
    const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png'};
    res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
    res.end(fs.readFileSync(file));
  } catch {res.writeHead(404).end();}
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  const context=await browser.newContext();
  const page=await context.newPage();
  const errors=[], external=[];
  let rejectLogin=false;
  const profile={id:'qa-incubation',role:'admin',status:'approved',email:'incubation@example.invalid',name:'Local QA',must_change_password:false};
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>{
    const request=route.request(), url=new URL(request.url());
    if(url.origin===base)return route.continue();
    external.push({path:url.pathname,method:request.method()});
    const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    if(url.pathname==='/auth/v1/token')return rejectLogin
      ?json({error:'invalid_grant',error_description:'Invalid login credentials'},400)
      :json({access_token:'qa-local-only',refresh_token:'qa-local-refresh',expires_in:3600,user:{id:profile.id,email:profile.email}});
    if(url.pathname==='/auth/v1/user')return json({id:profile.id,email:profile.email});
    if(url.pathname==='/rest/v1/profiles')return json([profile]);
    if(url.pathname.startsWith('/rest/v1/'))return json([]);
    return route.abort();
  });
  try {
    for(const [name,width,height] of [['desktop',1440,900],['mobile',390,844],['small-mobile',320,568]]) {
      await page.setViewportSize({width,height});
      await page.goto(base);
      await page.locator('[data-incubation-access]').waitFor();
      await page.locator('.incubation-identity img').evaluate(img=>img.decode());
      assert.equal(await page.locator('.public-nav,#homeView footer,#homeView button,#homeView a').count(),0);
      assert.equal(await page.locator('.topbar button:visible').count(),1);
      assert.equal(await page.locator('.topbar [data-registration-choice]').count(),0);
      assert.equal(await page.locator('#homeView').innerText(),'');
      const measurements=await page.evaluate(()=>{
        const logo=document.querySelector('.incubation-identity').getBoundingClientRect();
        const access=document.querySelector('.topbar button').getBoundingClientRect();
        return {logoX:logo.x+logo.width/2,logoY:logo.y+logo.height/2,accessRight:access.right,accessTop:access.top,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight};
      });
      assert(Math.abs(measurements.logoX-width/2)<2,`${name}: horizontal logo center`);
      assert(Math.abs(measurements.logoY-height/2)<2,`${name}: vertical logo center`);
      assert(measurements.accessRight<=width && measurements.accessRight>width-60,`${name}: access upper right`);
      assert(measurements.accessTop<60,`${name}: access top`);
      assert(measurements.scrollWidth<=width,`${name}: horizontal overflow`);
      assert(measurements.scrollHeight<=height+2,`${name}: extra public sections/overflow`);
      await page.screenshot({path:path.join(output,`${name}.png`),fullPage:true});
    }
    assert.equal(external.length,0,'Public home must not query the backend');
    await page.locator('[data-incubation-access]').click();
    assert.equal(await page.locator('#loginModal').getAttribute('aria-hidden'),'false');
    await page.locator('#loginForm [name=email]').fill(profile.email);
    await page.locator('#loginForm [name=password]').fill('local-test-not-a-real-password');
    rejectLogin=true;
    await page.locator('#loginForm button[type=submit]').click();
    await page.locator('#actionModal.active').waitFor();
    assert.equal(await page.locator('#adminView').isVisible(),false);
    await page.locator('#actionModal [data-close-modal]').last().click();
    await page.locator('[data-incubation-access]').click();
    rejectLogin=false;
    await page.locator('#loginForm button[type=submit]').click();
    await page.locator('#adminView.active [data-dashboard-panel="admin-crm"].active #research-admin').waitFor();
    assert.equal(await page.locator('#homeView').isVisible(),false);
    assert.equal(await page.locator('[data-dashboard-target="admin-crm"]').getAttribute('class'),'active');
    await page.reload();
    await page.locator('#adminView.active [data-dashboard-panel="admin-crm"].active #research-admin').waitFor();
    await page.setViewportSize({width:1440,height:1000});
    assert.deepEqual(await page.locator('#adminView [data-dashboard-target]').evaluateAll(nodes=>nodes.map(n=>n.dataset.dashboardTarget)),['admin-crm','admin-settings']);
    assert.equal(await page.locator('#admin-crm-invite-toggle,#admin-crm-invite-fields').count(),0);
    await page.evaluate(()=>showDashboardPanel('admin-athletes'));
    assert.equal(await page.locator('[data-dashboard-panel="admin-crm"]').isVisible(),true);
    await page.evaluate(()=>showView('commercial'));
    assert.equal(await page.locator('#commercialView').isVisible(),false);
    await page.locator('#research-invite').waitFor({state:'attached'});
    await page.screenshot({path:path.join(output,'research-workspace.png'),fullPage:true});
    for (const theme of ['light','dark']) {
      await page.evaluate(t=>setDashboardTheme(t),theme);
      await page.setViewportSize({width:390,height:844});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Research mobile overflow');
      await page.screenshot({path:path.join(output,`research-mobile-${theme}.png`),fullPage:true,animations:'disabled'});
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('[data-dashboard-target="admin-settings"]').click();
    await page.locator('[data-dashboard-panel="admin-settings"] [data-logout]').waitFor();
    assert.equal(await page.locator('[data-settings-language-host]').count(),1);
    assert.equal(await page.locator('[data-settings-theme-host]').count(),1);
    const allowedTables=['profiles','crm','research_responses','research_invitations'];
    assert.equal(external.some(item=>item.path.startsWith('/rest/v1/')&&!allowedTables.includes(item.path.split('/').pop())),false,'Research must not load commercial, sporting or agent datasets');
    await page.evaluate(()=>logout());
    await page.locator('#homeView.active').waitFor();
    assert.equal(await page.locator('.topbar button:visible').count(),1);
    assert.equal(await page.locator('.topbar [data-registration-choice]').count(),0);
    profile.role='commercial';
    await page.locator('[data-incubation-access]').click();
    await page.locator('#loginForm [name=email]').fill(profile.email);
    await page.locator('#loginForm [name=password]').fill('local-test-not-a-real-password');
    await page.locator('#loginForm button[type=submit]').click();
    await page.locator('#actionModal.active').waitFor();
    assert((await page.locator('#actionModal').innerText()).includes('cuenta administrativa autorizada'));
    assert.equal(await page.locator('#adminView').isVisible(),false);
    assert.equal(await page.locator('#commercialView').isVisible(),false);
    assert.equal(external.some(item=>item.method!=='GET' && item.path!=='/auth/v1/token'),false,'No unexpected writes');
    assert.deepEqual(errors,[]);
    console.log('PASS: three viewports, centered logo, single access, no home API requests, rejected login, admin login → CRM/research, reload and logout. All external requests mocked.');
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
