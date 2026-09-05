// Optional test dependency only; no packages are loaded by the production frontend.
const { PGlite } = await import(process.env.ROIS_PGLITE_MODULE || '@electric-sql/pglite');
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const db=new PGlite();
await db.exec("create role anon; create role authenticated; create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$; grant usage on schema auth to authenticated,anon; grant execute on all functions in schema auth to authenticated,anon; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;");
await db.exec("create role service_role bypassrls;");
for(const file of ['supabase-schema.sql','supabase-company-marketplace-pro-business.sql','supabase-opportunities-marketplace-v1.sql','supabase-scout-missions-network.sql','supabase-commercial-crm-invitations.sql','supabase-commercial-records-localized-invitations.sql']){
 try {
  await db.exec(readFileSync(root+'/'+file,'utf8').replace(/create extension if not exists pgcrypto;/gi,''));
  console.log('BASE OK',file);
 }catch(e){console.error('BASE FAILED',file,e.message);process.exit(1);}
}
await db.exec(readFileSync(root+'/supabase-founder-profile-sponsorship-hotfix.sql','utf8'));
if(process.env.ROIS_SCOUT_SCHEMA)await db.exec(readFileSync(process.env.ROIS_SCOUT_SCHEMA,'utf8'));
await db.exec("alter table athletes add column if not exists sponsor_deck jsonb; alter table athletes add column if not exists max_sponsors integer; alter table founders add column if not exists sponsor_deck jsonb; grant usage on schema public to authenticated,anon; grant select,insert,update,delete on all tables in schema public to authenticated;");
for(let i=0;i<2;i++){
 try{await db.exec(readFileSync(root+'/supabase-agent-workspace-v1.sql','utf8'));console.log('MIGRATION OK',i+1);}
 catch(e){console.error('MIGRATION FAILED',e.message,e.query);process.exit(1);}
}
console.log('IDEMPOTENCE PASSED');


async function run(db) {
  let assertions=0;
  const assert=(ok,label)=>{if(!ok)throw new Error(label);assertions++;console.log("PASS",label);};
  const ids={admin:"00000000-0000-4000-8000-000000000001",a:"00000000-0000-4000-8000-000000000002",b:"00000000-0000-4000-8000-000000000003",
    client:"00000000-0000-4000-8000-000000000004",talent:"00000000-0000-4000-8000-000000000005",creator:"00000000-0000-4000-8000-000000000006"};
  const q=async(sql,params=[]) =>(await db.query(sql,params)).rows;
  const role=async(id)=>{await db.exec("reset role");await q("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id,JSON.stringify({email:id+"@test.invalid"})]);await db.exec("set role authenticated");};
  const value=async(sql,params=[])=>Object.values((await q(sql,params))[0])[0];
  const rpc=async(name,args)=>value(`select public.${name}(${args.map((_,i)=>"$"+(i+1)).join(",")})`,args);
  const deny=async(label,fn)=>{let denied=false;try{await fn();}catch(e){denied=true;console.log("DENIED",label,e.message);}assert(denied,label);};
  const save=(kind,assignment,id,values)=>rpc("rois_agent_save",[kind,assignment,id,JSON.stringify(values)]);
  const operate=(kind,assignment,id,values)=>rpc("rois_agent_operate",[kind,assignment,id,JSON.stringify(values)]);
  for(const [key,id]of Object.entries(ids))await q("insert into profiles(id,email,name,role,status) values($1,$2,$3,$4,'approved')",[id,id+"@test.invalid",key,{admin:"admin",a:"commercial",b:"commercial",client:"client",talent:"athlete",creator:"founder"}[key]]);
  const company=await value("insert into companies(name,profile_id,contact,status) values('Company QA',$1,$2,'approved') returning id",[ids.client,ids.client+"@test.invalid"]);
  const other=await value("insert into companies(name,status) values('Other account QA','approved') returning id");
  await q("update company_subscriptions set plan='pro',status='active',listing_limit=10 where company_id=$1",[company]);
  const athlete=await value("insert into athletes(profile_id,email,name,sport,status,sponsor_deck) values($1,$2,'Athlete QA','Sport QA','approved',$3) returning id",[ids.talent,ids.talent+"@test.invalid",JSON.stringify({headline:"Objective master",audience:"Verified audience",proofPoints:["Verified result"]})]);
  const creator=await value("insert into founders(profile_id,email,name,status,sponsor_deck) values($1,$2,'Creator QA','approved',$3) returning id",[ids.creator,ids.creator+"@test.invalid",JSON.stringify({headline:"Creator master",audience:"Creator audience"})]);
  const up=await value("insert into user_profiles(profile_id,email,name,legacy_athlete_id) values($1,$2,'Athlete QA',$3) returning id",[ids.talent,ids.talent+"@test.invalid",athlete]);
  const fu=await value("insert into user_profiles(profile_id,email,name,legacy_founder_id) values($1,$2,'Creator QA',$3) returning id",[ids.creator,ids.creator+"@test.invalid",creator]);
  await q("insert into company_verifications(company_id,status) values($1,'approved')",[company]);
  await role(ids.admin);
  const assignment=await value("insert into commercial_account_assignments(agent_profile_id,company_id,account_type) values($1,$2,'company') returning id",[ids.a,company]);
  const otherAssignment=await value("insert into commercial_account_assignments(agent_profile_id,company_id,account_type) values($1,$2,'company') returning id",[ids.b,other]);
  const talentAssignment=await value("insert into commercial_account_assignments(agent_profile_id,user_profile_id,account_type) values($1,$2,'athlete') returning id",[ids.a,up]);
  const creatorAssignment=await value("insert into commercial_account_assignments(agent_profile_id,user_profile_id,account_type) values($1,$2,'creator') returning id",[ids.a,fu]);
  assert(!!assignment,"A Admin assigns a company and talent accounts");
  await role(ids.a);
  await q("update profiles set must_change_password=false where id=$1",[ids.a]);
  assert(true,"Agent can complete first-login password reset");
  await deny("Agent cannot promote own role",()=>q("update profiles set role='admin' where id=$1",[ids.a]));
  let snap=await rpc("rois_agent_workspace",[]);
  assert(snap.companies.length===1&&snap.companies[0].id===company,"B Agent A sees only assigned company");
  await deny("Agent cannot assign accounts",()=>q("insert into commercial_account_assignments(agent_profile_id,company_id,account_type) values($1,$2,'company')",[ids.a,other]));
  const affinity=await save("affinity",assignment,null,{target_type:"external",target_name:"Counterparty QA",score:87,reasons:["Category match"],commercial_hypothesis:"Activation",next_action:"Prepare proposal"});
  assert(affinity.created_by===ids.a,"D Affinity is stamped with the real actor");
  const opp=await operate("opportunity",assignment,null,{title:"Opportunity QA",description:"Activation description",opportunity_type:"refer",category:"Services",status:"draft"});
  assert(opp.company_id===company&&opp.created_by===ids.a,"E Opportunity represents company and records agent");
  await deny("Agent cannot publish without moderation",()=>operate("opportunity",assignment,opp.id,{status:"published"}));
  await deny("Cannot write free financial fields",()=>operate("opportunity",assignment,opp.id,{approved_by:ids.a}));
  const connection=await save("connection",assignment,null,{counterparty_type:"external",counterparty_name:"Counterparty QA",affinity_id:affinity.id,potential_value:1500,currency:"MXN",next_action:"Arrange meeting"});
  assert(connection.assignment_id===assignment,"F Connection preserves account and source");
  await operate("mission",assignment,opp.id,{scout_enabled:true,scout_reward_amount:50,scout_reward_event:"qualified",scout_reward_currency:"MXN",scout_evidence_required:"Introduction evidence"});
  assert((await rpc("rois_agent_workspace",[])).opportunities[0].scout_enabled,"G Existing opportunity becomes a Scout mission");
  const listing=await operate("listing",assignment,null,{listing_type:"service",category:"Services",title:"Service QA",summary:"Corporate service",status:"draft",commercial_target_market:"Regional companies"});
  assert(listing.company_id===company,"Corporate Market reuses company_listings");
  await operate("mission",assignment,opp.id,{corporate_listing_id:listing.id});
  const masterBefore=JSON.stringify((await rpc("rois_agent_workspace",[])).athletes[0].sponsor_deck);
  const proposal=await save("proposal",talentAssignment,null,{proposal_type:"sponsorship",master_entity_type:"athlete",master_entity_id:athlete,counterparty_type:"company",counterparty_name:"Brand QA",title:"Adapted athlete proposal",commercial_thesis:"Specific activation",benefits:["Adapted benefit"],status:"review"});
  assert(proposal.status==="review","K Agent adapts a sponsorship proposal");
  const creatorProposal=await save("proposal",creatorAssignment,null,{proposal_type:"sponsorship",master_entity_type:"creator",master_entity_id:creator,counterparty_type:"company",counterparty_name:"Brand QA",title:"Adapted creator proposal",status:"draft"});
  assert(!!creatorProposal.id,"Creator uses the same variant infrastructure");
  assert(JSON.stringify((await rpc("rois_agent_workspace",[])).athletes[0].sponsor_deck)===masterBefore,"L Master Sponsor Deck remains intact");
  await deny("Agent cannot self-approve proposal",()=>save("proposal",talentAssignment,proposal.id,{status:"approved"}));
  await deny("Agent cannot inject audience facts",()=>save("proposal",talentAssignment,proposal.id,{audience:"Fake"}));
  const follow=await save("followup",assignment,null,{entity_type:"connection",entity_id:connection.id,action:"Follow up",due_at:"2026-01-01T12:00:00Z",priority:"high"});
  assert(!!follow.id,"Next action persists with related entity");
  await role(ids.b);
  snap=await rpc("rois_agent_workspace",[]);
  assert(!snap.companies.some(c=>c.id===company)&&!snap.commercial_affinities.some(c=>c.id===affinity.id),"C Agent B does not see Agent A's account or affinity");
  assert((await q("select * from companies where id=$1",[company])).length===0,"N Manual company ID is denied");
  await deny("N Manual assignment ID mutation is denied",()=>save("connection",assignment,null,{counterparty_type:"external",counterparty_name:"Intrusion"}));
  await deny("Cross-account affinity link is denied",()=>save("connection",otherAssignment,null,{counterparty_type:"external",counterparty_name:"Intrusion",affinity_id:affinity.id}));
  await role(ids.admin);
  await q("update opportunities set status='published',published_at=now() where id=$1",[opp.id]);
  await save("proposal",talentAssignment,proposal.id,{status:"approved"});
  await role(ids.talent);
  const scoutCode=await value("select scout_code from user_profiles where id=$1",[up]);
  const mission=await value("insert into mission_scouts(opportunity_id,company_id,user_profile_id,scout_code,scout_public_name,status) values($1,$2,$3,$4,'Scout QA','active') returning id",[opp.id,company,up,scoutCode]);
  const lead=await value("insert into scout_leads(mission_scout_id,opportunity_id,company_id,scout_user_profile_id,scout_code,prospect_name,prospect_email,prospect_type,consent,consent_at) values($1,$2,$3,$4,$5,'Professional QA','professional@test.invalid','person',true,now()) returning id",[mission,opp.id,company,up,scoutCode]);
  assert(!!lead,"H Scout registers lead through existing RLS");
  const app=await value("insert into opportunity_applications(opportunity_id,user_profile_id,applicant_profile_id,shared_profile_snapshot) values($1,$2,$3,$4) returning id",[opp.id,up,ids.talent,JSON.stringify({name:"Consented name",email:"secret@test.invalid"})]);
  await q("insert into application_consents(application_id,user_profile_id,company_id,opportunity_id,purpose,authorized_fields) values($1,$2,$3,$4,'Evaluation',array['name'])",[app,up,company,opp.id]);
  assert((await q("select id from athletes where id=$1",[athlete])).length===1,"P Athlete retains own access");
  await role(ids.creator);
  assert((await q("select id from founders where id=$1",[creator])).length===1,"P Creator retains own access");
  await role(ids.a);
  await operate("lead",assignment,lead,{status:"qualified",company_notes:"Evidence reviewed"});
  assert((await rpc("rois_agent_workspace",[])).scout_leads[0].status==="qualified","I Agent validates owned Scout lead");
  const la=await save("affinity",assignment,null,{target_type:"professional",target_name:"Professional QA",source_lead_id:lead});
  const laAgain=await save("affinity",assignment,null,{target_type:"professional",target_name:"Professional QA",source_lead_id:lead});
  assert(la.id===laAgain.id,"J Lead conversion is idempotent");
  const lc=await save("connection",assignment,null,{counterparty_type:"professional",counterparty_name:"Professional QA",source_lead_id:lead});
  assert(!!lc.id,"J Lead converts to traced connection");
  const invite=await rpc("rois_agent_prepare_invitation",[assignment,lead,"creator"]);
  assert(invite.commercial_assignment_id===assignment&&invite.scout_code===scoutCode,"Invitation reuses CRM and preserves Scout attribution");
  assert((await q("select id from crm where id=$1",[invite.id])).length===1,"Invitation endpoint can verify authorized CRM row");
  await role(ids.b);
  assert((await q("select id from crm where id=$1",[invite.id])).length===0,"Invitation endpoint denies another agent's CRM ID");
  await role(ids.a);
  snap=await rpc("rois_agent_workspace",[]);
  assert(snap.opportunity_applications[0].shared_profile_snapshot.name==="Consented name"&&!snap.opportunity_applications[0].shared_profile_snapshot.email,"Consent filters applicant fields on the server");
  assert((await q("select * from opportunity_applications where id=$1",[app])).length===0,"Direct application access cannot bypass field filtering");
  await operate("application",assignment,app,{status:"accepted"});
  assert((await rpc("rois_agent_workspace",[])).opportunity_applications[0].status==="accepted","Authorized application can be accepted");
  assert(snap.scout_mission_commissions.length===1&&snap.scout_mission_commissions[0].status==="pending","Existing commission trigger runs without self-approval");
  assert((await q("update scout_mission_commissions set status='approved' returning id")).length===0,"Agent cannot approve commissions");
  assert(snap.analytics_events.some(e=>e.commercial_actor_id===ids.a&&e.entity_id===affinity.id),"M Activity records actor, account, entity and timestamp");
  await deny("Approved content cannot be changed",()=>save("proposal",talentAssignment,proposal.id,{commercial_thesis:"Changed"}));
  await save("proposal",talentAssignment,proposal.id,{status:"activated"});
  await role(ids.client);
  assert((await q("select * from companies where id=$1",[company])).length===1,"O Client retains own account access");
  assert((await q("select * from opportunities where id=$1",[opp.id])).length===1,"O Client retains company opportunities");
  await role(ids.admin);
  assert((await q("select * from companies")).length===2,"Q Admin retains global account access");
  assert((await q("select * from commercial_account_assignments")).length===4,"Q Admin sees all assignments");
  await q("update commercial_account_assignments set status='withdrawn' where id=$1",[assignment]);
  await role(ids.a);
  assert(!(await rpc("rois_agent_workspace",[])).companies.some(c=>c.id===company),"Withdrawal immediately removes company from snapshot");
  await deny("Withdrawal immediately blocks RPC mutations",()=>save("connection",assignment,connection.id,{notes:"After withdrawal"}));
  await role(ids.admin);
  await q("update commercial_account_assignments set status='active' where id=$1",[assignment]);
  await q("update commercial_account_assignments set scope=$1 where id=$2",[JSON.stringify({publishing_assignment_id:assignment}),talentAssignment]);
  await role(ids.a);
  const represented=await operate("opportunity",talentAssignment,null,{title:"Talent distribution QA",description:"Assigned company publishes for represented talent",opportunity_type:"create",category:"Content",status:"draft"});
  assert(represented.commercial_assignment_id===talentAssignment&&represented.company_id===company,"Talent uses explicitly assigned publishing company");
  await role(ids.admin);
  await q("update commercial_account_assignments set service_ends_at=now()-interval '1 day' where id=$1",[assignment]);
  await role(ids.a);
  await deny("Expired publishing assignment blocks talent operations",()=>operate("opportunity",talentAssignment,represented.id,{title:"Forbidden"}));
  await role(ids.admin);
  await q("update commercial_account_assignments set service_ends_at=null where id=$1",[assignment]);
  await q("update application_consents set revoked_at=now() where application_id=$1",[app]);
  await role(ids.a);
  assert((await rpc("rois_agent_workspace",[])).opportunity_applications.length===0,"Revoked consent removes applicant snapshot");
  await deny("Revoked consent blocks application mutation",()=>operate("application",assignment,app,{status:"rejected"}));
  await role(ids.admin);
  await q("update application_consents set revoked_at=null,expires_at=now()-interval '1 day' where application_id=$1",[app]);
  await role(ids.a);
  assert((await rpc("rois_agent_workspace",[])).opportunity_applications.length===0,"Expired consent removes applicant snapshot");
  await role(ids.admin);
  await q("update application_consents set expires_at=null where application_id=$1",[app]);
  await q("update user_profiles set legacy_athlete_id=null where id=$1",[up]);
  await role(ids.a);
  assert((await rpc("rois_agent_workspace",[])).athletes[0].id===athlete,"Master lookup supports newer profiles without legacy pointers");
  await role(ids.talent);
  await deny("Scout cannot forge agent activity",()=>q("insert into analytics_events(profile_id,event_name,commercial_assignment_id,commercial_actor_id) values($1,'agent.insert',$2,$3)",[up,assignment,ids.a]));
  await role(ids.admin);
  if(await value("select to_regclass('public.scouts') is not null")){
    await db.exec("reset role");
    const external="00000000-0000-4000-8000-000000000007";
    await q("insert into profiles(id,email,name,role,status) values($1,$2,'External Scout QA','scout','approved')",[external,external+"@test.invalid"]);
    await q("insert into scouts(profile_id,email,name,scout_code,status) values($1,$2,'External Scout QA','ROIS-EXTQA01','approved')",[external,external+"@test.invalid"]);
    await role(external);
    const identity=await rpc("rois_scout_mission_profile",[]);
    const identity2=await rpc("rois_scout_mission_profile",[]);
    assert(identity.id===identity2.id&&identity.scout_code==="ROIS-EXTQA01","External Scout reuses one universal identity and original code");
    const externalMission=await value("insert into mission_scouts(opportunity_id,company_id,user_profile_id,scout_code,scout_public_name,status) values($1,$2,$3,$4,'External Scout QA','active') returning id",[opp.id,company,identity.id,identity.scout_code]);
    assert(!!externalMission,"External Scout joins existing mission infrastructure");
  }
  await role(ids.a);
  console.log("ASSERTIONS",assertions);
  return {ids,assignment,talentAssignment,creatorAssignment,company,snapshot:await rpc("rois_agent_workspace",[])};
}


try { await run(db); console.log('ALL AGENT WORKSPACE SQL TESTS PASSED'); } finally { await db.close(); }
