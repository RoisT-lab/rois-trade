-- Fixtures only; rollback restores all state, including simulated legacy token loss.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role='admin' and status='approved' limit 1),true);
set local role authenticated;
do $$
declare v jsonb; copied jsonb;
begin
  v:=public.rois_create_named_research_invitation(null,'QA copy links '||gen_random_uuid()::text,'QA Copy');
  perform set_config('copy.qa.crm',v->>'crm_id',true);
  perform set_config('copy.qa.inv',v->>'invitation_id',true);
  perform set_config('copy.qa.token',v->>'token',true);
  copied:=public.rois_get_research_invitation_link((v->>'crm_id')::uuid);
  if copied->>'token'<>v->>'token' or copied->>'expires_at'<>v->>'expires_at' then raise exception 'FAIL: copy changed token/expiry';end if;
  copied:=public.rois_get_research_invitation_link((v->>'crm_id')::uuid,true);
  if copied->>'token'<>v->>'token' then raise exception 'FAIL: valid link replaced';end if;
  begin perform count(*) from rois_research_private.invitation_links;raise exception 'FAIL: direct client read';exception when insufficient_privilege then null;end;
end $$;
reset role;
delete from rois_research_private.invitation_links where invitation_id=current_setting('copy.qa.inv')::uuid;
set local role authenticated;
do $$
declare copied jsonb;
begin
  begin perform public.rois_get_research_invitation_link(current_setting('copy.qa.crm')::uuid);raise exception 'FAIL: legacy silently repaired';exception when others then if sqlerrm<>'link_unavailable' then raise;end if;end;
  copied:=public.rois_get_research_invitation_link(current_setting('copy.qa.crm')::uuid,true);
  if copied->>'token'=current_setting('copy.qa.token') then raise exception 'FAIL: legacy not replaced';end if;
  if copied->>'crm_id'<>current_setting('copy.qa.crm') then raise exception 'FAIL: duplicated CRM';end if;
  if encode(sha256(convert_to(current_setting('copy.qa.token'),'UTF8')),'hex')=(select token_hash from public.research_invitations where id=current_setting('copy.qa.inv')::uuid) then raise exception 'FAIL: old token still active';end if;
end $$;
reset role;
update public.research_invitations set expires_at=now()-interval '1 day' where id=current_setting('copy.qa.inv')::uuid;
set local role authenticated;
do $$ begin
  begin perform public.rois_get_research_invitation_link(current_setting('copy.qa.crm')::uuid);raise exception 'FAIL: expired returned';exception when others then if sqlerrm<>'link_unavailable' then raise;end if;end;
  perform public.rois_get_research_invitation_link(current_setting('copy.qa.crm')::uuid,true);
end $$;
reset role;
update public.research_invitations set responded_at=now() where id=current_setting('copy.qa.inv')::uuid;
set local role authenticated;
do $$ declare v jsonb;begin
 v:=public.rois_get_research_invitation_link(current_setting('copy.qa.crm')::uuid);
 if v->>'answered'<>'true' then raise exception 'FAIL: answered status';end if;
end $$;
reset role;
delete from rois_research_private.invitation_links where invitation_id=current_setting('copy.qa.inv')::uuid;
set local role authenticated;
do $$ begin
 begin perform public.rois_get_research_invitation_link(current_setting('copy.qa.crm')::uuid,true);raise exception 'FAIL: answered replaced';exception when others then if sqlerrm<>'already_answered' then raise;end if;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
set local role authenticated;
do $$ begin
 begin perform public.rois_get_research_invitation_link(current_setting('copy.qa.crm')::uuid);raise exception 'FAIL: non-admin read';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform public.rois_get_research_invitation_link(current_setting('copy.qa.crm')::uuid,true);raise exception 'FAIL: anon repair';exception when insufficient_privilege then null;end;
 begin perform count(*) from rois_research_private.invitation_links;raise exception 'FAIL: anon direct read';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS: stable copy, private token storage, explicit legacy/expired replacement, no duplicate CRM, answered preservation, admin-only access; rollback complete' as result;
