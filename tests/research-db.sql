-- All fixtures are rolled back; no emails, real responses, or permanent contacts are created.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role='admin' and status='approved' limit 1),true);
set local role authenticated;
do $$
declare inv jsonb; again jsonb;
begin
  inv := public.rois_create_named_research_invitation(null,'ROIS QA Research - rollback only','QA Recipient');
  if not exists(select 1 from public.crm where id=(inv->>'crm_id')::uuid and email is null and name='QA Recipient') then raise exception 'FAIL: named CRM without email';end if;
  if not exists(select 1 from public.research_invitations where crm_id=(inv->>'crm_id')::uuid and recipient_name='QA Recipient') then raise exception 'FAIL: recipient not saved';end if;
  begin perform public.rois_create_named_research_invitation(null,'ROIS QA Research - rollback only','QA Recipient');raise exception 'FAIL: duplicate accepted';exception when others then if sqlerrm<>'duplicate_recipient' then raise;end if;end;
  begin perform public.rois_create_named_research_invitation(null,'QA','  ');raise exception 'FAIL: empty name accepted';exception when others then if sqlerrm not like 'invalid_payload%' then raise;end if;end;
  begin perform public.rois_create_named_research_invitation(null,'QA',repeat('x',161));raise exception 'FAIL: long name accepted';exception when others then if sqlerrm not like 'invalid_payload%' then raise;end if;end;
  -- Previously published email-based creation remains supported.
  perform public.rois_create_research_invitation(null,'QA Legacy Compatibility','research-qa-'||gen_random_uuid()::text||'@example.invalid');
  perform set_config('research.qa.token',inv->>'token',true);
  perform set_config('research.qa.crm',inv->>'crm_id',true);
  again := public.rois_create_named_research_invitation((inv->>'crm_id')::uuid,'','QA Recipient Updated');
  perform set_config('research.qa.old_token',inv->>'token',true);
  perform set_config('research.qa.token',again->>'token',true);
  if inv->>'token'=again->>'token' then raise exception 'token did not rotate'; end if;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$
declare payload jsonb := '{"version":1,"language":"es","consent":true,"contact_consent":false,"answers":{"company":"QA México","respondent":"QA","role":"CEO","country":"México","sector":"Tecnología","business_model":"b2b","stage":"growth","funding_type":"equity","funding_recency":"0_3","funding_amount":"","objective":"Objetivo QA","obstacle":"Obstáculo QA","impact":"Impacto QA","attempts":"Intentos QA","current_solution":"Solución QA","decision_maker":"Dirección","category":"operations","budget":"approved","urgency":"90d"}}'; r jsonb;
begin
  begin perform count(*) from public.research_responses; raise exception 'FAIL: anon can read'; exception when insufficient_privilege then null; end;
  begin perform public.rois_create_named_research_invitation(null,'QA','QA Recipient');raise exception 'FAIL: anon can create';exception when insufficient_privilege then null;end;
  begin perform public.rois_submit_research(current_setting('research.qa.old_token'),payload);raise exception 'FAIL: old token valid';exception when others then if sqlerrm not like 'invalid_token%' then raise;end if;end;
  begin perform public.rois_submit_research(current_setting('research.qa.token'),jsonb_set(payload,'{consent}','false'));raise exception 'FAIL: no consent';exception when others then if sqlerrm not like 'invalid_payload%' then raise;end if;end;
  begin perform public.rois_submit_research(current_setting('research.qa.token'),jsonb_set(payload,'{answers,budget}','"arbitrary"'));raise exception 'FAIL: invalid enum';exception when others then if sqlerrm not like 'invalid_payload%' then raise;end if;end;
  r := public.rois_submit_research(current_setting('research.qa.token'),payload);
  if r->>'status'<>'saved' then raise exception 'FAIL: not saved';end if;
  r := public.rois_submit_research(current_setting('research.qa.token'),payload);
  if r->>'status'<>'saved' then raise exception 'FAIL: retry not idempotent';end if;
  begin perform public.rois_submit_research(current_setting('research.qa.token'),jsonb_set(payload,'{answers,impact}','"Changed"'));raise exception 'FAIL: changed response accepted';exception when others then if sqlerrm<>'already_answered' then raise;end if;end;
end;
$$;
reset role;
-- Unknown authenticated identity must not see responses or issue invitations.
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.research_responses) then raise exception 'FAIL: non-admin can read responses';end if;
  if exists(select 1 from public.research_invitations) then raise exception 'FAIL: non-admin can read invitations';end if;
  begin perform public.rois_create_named_research_invitation(null,'QA','QA Recipient');raise exception 'FAIL: non-admin create';exception when insufficient_privilege then null;end;
  begin update public.research_responses set language='en';raise exception 'FAIL: client write';exception when insufficient_privilege then null;end;
end; $$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role='admin' and status='approved' limit 1),true);
set local role authenticated;
do $$ begin
  begin perform public.rois_create_named_research_invitation(current_setting('research.qa.crm')::uuid,'','QA Recipient');raise exception 'FAIL: answered link rotated';exception when others then if sqlerrm<>'already_answered' then raise;end if;end;
  if not exists(select 1 from public.research_invitations where crm_id=current_setting('research.qa.crm')::uuid and recipient_name='QA Recipient Updated') then raise exception 'FAIL: recipient update';end if;
  if (select count(*) from public.research_responses where crm_id=current_setting('research.qa.crm')::uuid)<>1 then raise exception 'FAIL: response duplication or linkage';end if;
  if not exists(select 1 from public.research_invitations where crm_id=current_setting('research.qa.crm')::uuid and responded_at is not null) then raise exception 'FAIL: status';end if;
  if exists(select 1 from public.research_responses where crm_id=current_setting('research.qa.crm')::uuid and contact_consent) then raise exception 'FAIL: contact opt-in lost';end if;
end; $$;
reset role;
rollback;
select 'PASS: admin creation, capability rotation, anonymous submission, validation, idempotency, CRM linkage, consent and role isolation; fixtures rolled back' as result;
