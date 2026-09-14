import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Exercise the shipped helpers, not parallel copies of their implementation.
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const current='2026-09-14T12:00:00Z';
class TestDate extends Date { constructor(...args){super(...(args.length?args:[current]));}static now(){return new Date(current).getTime();} }
const assignments=[{id:'company-account',company_id:'company'},{id:'talent-account',user_profile_id:'talent',scope:{institutional_publisher_company_id:'publisher'}}];
const data={opportunities:[{id:'talent-opportunity',commercial_assignment_id:'talent-account',company_id:'publisher'}]};
const ctx=vm.createContext({Date:TestDate,state:{dashboardLanguage:'es'},agentRecords:t=>data[t]||[],agentAssignments:()=>assignments,
 agentAccountName:()=> 'Cuenta QA',escapeHtml:s=>String(s),escapeAttr:s=>String(s),agentActiveAssignment:'',agentResultsSince:'2026-09-14',
 agentStatus:s=>s,agentRecordView:()=>'',agentEmpty:()=>'',agentAction:()=>'',agentListFilters:{}});
function load(name){
 const start=app.indexOf(`function ${name}(`);assert(start>=0,`${name} exists`);
 const ends=[app.indexOf('\nfunction ',start+1),app.indexOf('\nasync function ',start+1)].filter(i=>i>=0);
 vm.runInContext(app.slice(start,Math.min(...ends)),ctx);
}
for(const name of ['agentT','agentCopy','agentOption','agentDate','agentRowAssignment','agentCanEdit','agentFields','agentParentPanel','agentAgendaItems','agentAgendaItemMarkup','agentFollowupsMarkup','agentCurrencyTotals','agentResultsMarkup'])load(name);
const run=code=>vm.runInContext(code,ctx);
assert.equal(run("agentRowAssignment({opportunity_id:'talent-opportunity',company_id:'publisher'})"),'talent-account');
assert.equal(run("agentRowAssignment({company_id:'company'})"),'company-account');
assert.equal(run("agentRowAssignment({company_id:'publisher'})"),'');
for(const [kind,allowed,blocked]of [['opportunity','draft','published'],['listing','pending','approved'],['proposal','review','approved'],['connection','negotiation','closed_won'],['mission','published','closed']]){
 assert.equal(run(`agentCanEdit('${kind}',{status:'${allowed}'})`),true);
 assert.equal(run(`agentCanEdit('${kind}',{status:'${blocked}'})`),false);
}
assert.equal(run("agentFields('proposal').some(f=>f.type==='json')"),false);
assert.equal(run("agentFields('proposal').find(f=>f.name==='status').options.join(',')"),'draft,review');
assert.equal(run("agentFields('proposal').filter(f=>f.name.startsWith('_economic_')).length"),4);
assert.equal(run("agentParentPanel('map')"),'connections');
assert.equal(run("agentParentPanel('missions')"),'accounts');
assert.equal(run("agentParentPanel('followup')"),'overview');
ctx.scope={assignments,affinities:[],connections:[],proposals:[],followups:[
 {id:'past',assignment_id:'company-account',status:'pending',action:'PAST TASK',due_at:'2026-09-14T08:00:00Z'},
 {id:'today',assignment_id:'company-account',status:'pending',action:'TODAY TASK',due_at:'2026-09-14T20:00:00Z'},
 {id:'future',assignment_id:'company-account',status:'pending',action:'FUTURE TASK',due_at:'2026-09-20T12:00:00Z'},
 {id:'done',assignment_id:'company-account',status:'completed',action:'DONE TASK',due_at:'2026-09-12T12:00:00Z'}]};
const agenda=run('agentFollowupsMarkup(scope)');
for(const label of ['PAST TASK','TODAY TASK','FUTURE TASK','DONE TASK'])assert.equal(agenda.split(label).length-1,1,label+' appears once');
ctx.scope.connections=[{id:'case',assignment_id:'company-account',status:'conversation',next_action:'TODAY TASK',next_action_at:'2026-09-14T20:00:00Z'}];
ctx.scope.followups[1].entity_type='connection';ctx.scope.followups[1].entity_id='case';
assert.equal(run('agentAgendaItems(scope).length'),3,'a linked task suppresses duplicate inline next action');
ctx.scope.connections=[{id:'won',assignment_id:'company-account',status:'closed_won',created_at:'2025-01-01T00:00:00Z',closed_at:current,potential_value:12500,currency:'MXN'}];
const results=run('agentResultsMarkup(scope)');
assert.match(results,/Cierres ganados<\/span><strong>1/);
assert.match(results,/12,500 MXN/);
assert(!results.includes('Revenue originado'));
const nav=html.split('data-dashboard-nav="commercial"')[1].split('</nav>')[0];
const buttons=[...nav.matchAll(/<button\b([^>]+)>/g)].filter(([,attrs])=>!attrs.includes('data-scout-only')&&!attrs.includes('data-agent-tool'));
assert.equal(buttons.length,6,'six agent primary destinations');
console.log('Agent workflow regression tests passed: navigation, policies, proposal fields, account context, agenda and closing dates.');
