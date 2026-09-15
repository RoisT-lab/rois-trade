// Read-only/invalid-input production smoke checks: cannot create a response.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ctx={window:{}};vm.runInNewContext(fs.readFileSync(new URL('../app-config.js',`file://${__filename.replaceAll('\\','/')}`),'utf8'),ctx);
const c=ctx.window.ROIS_CONFIG;
(async()=>{
 const headers={apikey:c.supabaseAnonKey,Authorization:`Bearer ${c.supabaseAnonKey}`,'Content-Type':'application/json'};
 for(const table of ['research_responses','research_invitations']){
  const r=await fetch(`${c.supabaseUrl}/rest/v1/${table}?select=id&limit=1`,{headers});assert([401,403].includes(r.status),`Anonymous read denied: ${table} ${r.status}`);
 }
 const r=await fetch(`${c.supabaseUrl}/rest/v1/rpc/rois_submit_research`,{method:'POST',headers,body:JSON.stringify({p_token:'invalid',p_payload:{}})});
 assert.equal(r.status,400);assert.match(await r.text(),/invalid_token/);
 console.log('Production REST smoke checks passed: anonymous reads denied, RPC reachable and invalid capability rejected.');
})().catch(e=>{console.error(e);process.exitCode=1;});
