-- ROIS Agent Workspace V1. Run after the existing opportunities, corporate market,
-- Scout missions, Sponsor Deck and commercial invitation migrations.
-- Transactional / additive / rerunnable. No production data is seeded.
begin;

create table if not exists public.commercial_account_assignments (
 id uuid primary key default gen_random_uuid(),
 agent_profile_id uuid not null references public.profiles(id) on delete restrict,
 company_id uuid references public.companies(id) on delete restrict,
 user_profile_id uuid references public.user_profiles(id) on delete restrict,
 account_type text not null check (account_type in ('company','athlete','creator')),
 status text not null default 'active' check (status in ('active','withdrawn')),
 scope jsonb not null default '{}' check (jsonb_typeof(scope) = 'object'),
 assigned_by uuid references public.profiles(id) on delete restrict,
 assigned_at timestamptz not null default now(),
 service_started_at timestamptz,
 service_ends_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((account_type = 'company' and company_id is not null and user_profile_id is null)
     or (account_type in ('athlete','creator') and company_id is null and user_profile_id is not null)),
 check (service_ends_at is null or service_started_at is null or service_ends_at > service_started_at)
);
create unique index if not exists commercial_assignment_company_active
 on public.commercial_account_assignments(agent_profile_id, company_id) where status='active' and company_id is not null;
create unique index if not exists commercial_assignment_talent_active
 on public.commercial_account_assignments(agent_profile_id, user_profile_id) where status='active' and user_profile_id is not null;

create or replace function public.rois_agent_role()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='commercial');
$$;
create or replace function public.rois_agent_can_manage_assignment(p_assignment_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.rois_is_admin() or exists(
 select 1 from public.commercial_account_assignments a join public.profiles p on p.id=a.agent_profile_id
 where a.id=p_assignment_id and a.agent_profile_id=auth.uid() and p.role='commercial' and p.status='approved'
 and a.status='active' and (a.service_started_at is null or a.service_started_at<=now())
 and (a.service_ends_at is null or a.service_ends_at>now()));
$$;
create or replace function public.rois_agent_can_manage_company(p_company_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.rois_is_admin() or exists(select 1 from public.commercial_account_assignments a
 where a.company_id=p_company_id and public.rois_agent_can_manage_assignment(a.id));
$$;
create or replace function public.rois_agent_can_manage_profile(p_user_profile_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.rois_is_admin() or exists(select 1 from public.commercial_account_assignments a
 where a.user_profile_id=p_user_profile_id and public.rois_agent_can_manage_assignment(a.id));
$$;

create table if not exists public.commercial_affinities (
 id uuid primary key default gen_random_uuid(),
 assignment_id uuid not null references public.commercial_account_assignments(id) on delete restrict,
 target_type text not null, target_id uuid, target_name text not null check(length(trim(target_name))>0),
 score integer check(score between 0 and 100), priority text not null default 'normal' check(priority in ('low','normal','high','critical')),
 reasons jsonb not null default '[]' check(jsonb_typeof(reasons)='array'), commercial_hypothesis text,
 potential_value numeric(14,2) check(potential_value>=0), currency text not null default 'MXN',
 status text not null default 'identified' check(status in ('identified','analyzed','prioritized','activated','converted','discarded')),
 next_action text, next_action_at timestamptz,
 source_lead_id uuid references public.scout_leads(id) on delete restrict,
 created_by uuid references public.profiles(id) on delete restrict,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists commercial_affinity_lead_unique
 on public.commercial_affinities(assignment_id,source_lead_id) where source_lead_id is not null;

create table if not exists public.commercial_proposal_variants (
 id uuid primary key default gen_random_uuid(),
 assignment_id uuid not null references public.commercial_account_assignments(id) on delete restrict,
 proposal_type text not null check(proposal_type in ('sponsorship','commercial')),
 master_entity_type text not null, master_entity_id uuid not null,
 counterparty_type text not null, counterparty_id uuid, counterparty_name text not null,
 affinity_id uuid references public.commercial_affinities(id) on delete restrict,
 title text not null check(length(trim(title))>0), commercial_thesis text,
 benefits jsonb not null default '[]' check(jsonb_typeof(benefits)='array'),
 activations jsonb not null default '[]' check(jsonb_typeof(activations)='array'),
 deliverables jsonb not null default '[]' check(jsonb_typeof(deliverables)='array'),
 economic_proposal jsonb not null default '{}' check(jsonb_typeof(economic_proposal)='object'),
 cta text, status text not null default 'draft'
 check(status in ('draft','review','approved','activated','negotiation','closed','discarded')),
 created_by uuid references public.profiles(id) on delete restrict,
 approved_by uuid references public.profiles(id) on delete restrict,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.commercial_connections (
 id uuid primary key default gen_random_uuid(),
 assignment_id uuid not null references public.commercial_account_assignments(id) on delete restrict,
 affinity_id uuid references public.commercial_affinities(id) on delete restrict,
 proposal_variant_id uuid references public.commercial_proposal_variants(id) on delete restrict,
 source_lead_id uuid references public.scout_leads(id) on delete restrict,
 counterparty_type text not null, counterparty_id uuid, counterparty_name text not null,
 context text, potential_value numeric(14,2) check(potential_value>=0), currency text not null default 'MXN',
 status text not null default 'identified'
 check(status in ('identified','proposed','activation_requested','accepted','conversation','negotiation','closed_won','closed_lost')),
 next_action text, next_action_at timestamptz, notes text,
 created_by uuid references public.profiles(id) on delete restrict,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), closed_at timestamptz
);
create unique index if not exists commercial_connection_lead_unique
 on public.commercial_connections(assignment_id,source_lead_id) where source_lead_id is not null;
create table if not exists public.commercial_followups (
 id uuid primary key default gen_random_uuid(),
 assignment_id uuid not null references public.commercial_account_assignments(id) on delete restrict,
 entity_type text not null, entity_id uuid not null,
 action text not null check(length(trim(action))>0), context text,
 priority text not null default 'normal' check(priority in ('low','normal','high','critical')),
 due_at timestamptz not null, status text not null default 'pending' check(status in ('pending','completed','cancelled')),
 created_by uuid references public.profiles(id) on delete restrict, completed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

-- Only metadata is added to existing entities. Originals remain the source of truth.
alter table public.opportunities add column if not exists commercial_assignment_id uuid references public.commercial_account_assignments(id) on delete restrict;
alter table public.opportunities add column if not exists corporate_listing_id uuid references public.company_listings(id) on delete restrict;
alter table public.opportunities add column if not exists scout_evidence_required text;
alter table public.company_listings add column if not exists commercial_assignment_id uuid references public.commercial_account_assignments(id) on delete restrict;
alter table public.company_listings add column if not exists commercial_target_market text;
alter table public.company_listings add column if not exists commercial_actor_id uuid references public.profiles(id) on delete restrict;
alter table public.scout_leads add column if not exists commercial_requested_information text;
alter table public.scout_leads add column if not exists commercial_invitation_crm_id uuid references public.crm(id) on delete restrict;
alter table public.crm add column if not exists commercial_assignment_id uuid references public.commercial_account_assignments(id) on delete restrict;
alter table public.analytics_events add column if not exists commercial_assignment_id uuid references public.commercial_account_assignments(id) on delete restrict;
alter table public.analytics_events add column if not exists commercial_actor_id uuid references public.profiles(id) on delete restrict;

create or replace function public.rois_agent_application_allowed(p_application_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.rois_is_admin() or exists(
 select 1 from public.opportunity_applications app join public.opportunities o on o.id=app.opportunity_id
 join public.company_verifications v on v.company_id=o.company_id and v.status='approved'
 join public.application_consents c on c.application_id=app.id and c.company_id=o.company_id
 where app.id=p_application_id and public.rois_agent_can_manage_company(o.company_id)
 and c.granted and c.revoked_at is null and (c.expires_at is null or c.expires_at>now()));
$$;

-- Lock an assignment for the duration of each mutation; withdrawal cannot race a write.
create or replace function public.rois_agent_require_assignment(p_assignment_id uuid)
returns public.commercial_account_assignments language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.commercial_account_assignments;
begin
 select * into a from public.commercial_account_assignments where id=p_assignment_id for share;
 if a.id is null or not public.rois_agent_can_manage_assignment(a.id) then
  raise exception 'Account assignment is not authorized' using errcode='42501';
 end if;
 return a;
end; $$;

create or replace function public.rois_agent_assignment_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.rois_is_admin() then raise exception 'Only Administration assigns accounts' using errcode='42501'; end if;
 if not exists(select 1 from public.profiles where id=new.agent_profile_id and role='commercial' and status='approved') then
  raise exception 'Agent must be an approved commercial profile';
 end if;
 if new.user_profile_id is not null and not exists(
  select 1 from public.user_profiles u join public.profiles p on p.id=u.profile_id where u.id=new.user_profile_id
  and ((new.account_type='athlete' and p.role='athlete') or (new.account_type='creator' and p.role='founder'))) then
  raise exception 'Account type does not match the represented profile';
 end if;
 if tg_op='UPDATE' and (new.agent_profile_id,new.company_id,new.user_profile_id,new.account_type)
 is distinct from (old.agent_profile_id,old.company_id,old.user_profile_id,old.account_type) then
  raise exception 'Withdraw and create a new assignment to change ownership';
 end if;
 if tg_op='INSERT' then new.assigned_by:=auth.uid(); new.assigned_at:=now(); new.created_at:=now(); end if;
 if nullif(new.scope->>'publishing_assignment_id','') is not null and not exists(
  select 1 from public.commercial_account_assignments publisher
  where publisher.id=(new.scope->>'publishing_assignment_id')::uuid and publisher.company_id is not null
  and publisher.agent_profile_id=new.agent_profile_id and publisher.status='active') then
  raise exception 'Publishing company must be assigned to the same agent';
 end if;
 new.updated_at:=now(); return new;
end; $$;
drop trigger if exists commercial_assignment_guard on public.commercial_account_assignments;
create trigger commercial_assignment_guard before insert or update on public.commercial_account_assignments
 for each row execute function public.rois_agent_assignment_guard();

create or replace function public.rois_agent_entity_belongs(p_assignment_id uuid,p_type text,p_id uuid)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare a public.commercial_account_assignments;
begin
 select * into a from public.commercial_account_assignments where id=p_assignment_id;
 if a.id is null then return false; end if;
 return case p_type
 when 'account' then p_id=a.id
 when 'affinity' then exists(select 1 from public.commercial_affinities where id=p_id and assignment_id=a.id)
 when 'proposal' then exists(select 1 from public.commercial_proposal_variants where id=p_id and assignment_id=a.id)
 when 'connection' then exists(select 1 from public.commercial_connections where id=p_id and assignment_id=a.id)
 when 'opportunity' then exists(select 1 from public.opportunities where id=p_id and (company_id=a.company_id or commercial_assignment_id=a.id) and deleted_at is null)
 when 'listing' then exists(select 1 from public.company_listings where id=p_id and (company_id=a.company_id or commercial_assignment_id=a.id))
 when 'lead' then exists(select 1 from public.scout_leads l join public.opportunities o on o.id=l.opportunity_id where l.id=p_id
  and (l.company_id=a.company_id or o.commercial_assignment_id=a.id) and l.consent and l.deleted_at is null)
 else false end;
end; $$;

create or replace function public.rois_agent_record_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.commercial_account_assignments; j jsonb; up public.user_profiles; master uuid;
begin
 a:=public.rois_agent_require_assignment(new.assignment_id);
 if tg_op='UPDATE' then
  if new.assignment_id<>old.assignment_id then raise exception 'Assignment is immutable'; end if;
  new.created_by:=old.created_by; new.created_at:=old.created_at;
 else new.created_by:=auth.uid(); new.created_at:=now(); end if;
 new.updated_at:=now(); j:=to_jsonb(new);
 if nullif(j->>'affinity_id','') is not null and not public.rois_agent_entity_belongs(a.id,'affinity',(j->>'affinity_id')::uuid) then
  raise exception 'Affinity belongs to another account';
 end if;
 if nullif(j->>'proposal_variant_id','') is not null and not public.rois_agent_entity_belongs(a.id,'proposal',(j->>'proposal_variant_id')::uuid) then
  raise exception 'Proposal belongs to another account';
 end if;
 if nullif(j->>'source_lead_id','') is not null then
  if not public.rois_agent_entity_belongs(a.id,'lead',(j->>'source_lead_id')::uuid)
  or not exists(select 1 from public.scout_leads where id=(j->>'source_lead_id')::uuid and status in ('qualified','meeting','activated')) then
   raise exception 'Lead must be consented, qualified and owned by this account';
  end if;
 end if;
 if tg_table_name='commercial_proposal_variants' then
  if new.proposal_type='sponsorship' then
   select * into up from public.user_profiles where id=a.user_profile_id;
   master:=case a.account_type when 'athlete' then coalesce(up.legacy_athlete_id,(select id from public.athletes where profile_id=up.profile_id order by created_at,id limit 1))
    else coalesce(up.legacy_founder_id,(select id from public.founders where profile_id=up.profile_id order by created_at,id limit 1)) end;
   if new.master_entity_id is distinct from master or new.master_entity_type is distinct from a.account_type then
    raise exception 'Sponsorship master must be the assigned talent';
   end if;
  elsif not ((new.master_entity_type='company' and new.master_entity_id=a.company_id)
   or (new.master_entity_type='listing' and public.rois_agent_entity_belongs(a.id,'listing',new.master_entity_id))) then
   raise exception 'Commercial master must belong to this account';
  end if;
  if tg_op='UPDATE' and not public.rois_is_admin() and old.status not in ('draft','review','discarded')
   and (to_jsonb(new)-array['status','updated_at']) is distinct from (to_jsonb(old)-array['status','updated_at']) then
   raise exception 'Approved proposal content is immutable; create a new variant';
  end if;
  if not public.rois_is_admin() then
   if tg_op='INSERT' and new.status not in ('draft','review') then raise exception 'Proposal requires administrative review'; end if;
   if tg_op='UPDATE' and new.status not in ('draft','review','discarded')
    and (old.approved_by is null or new.status='approved' and old.status<>'approved') then
    raise exception 'Only Administration approves proposals';
   end if;
   if tg_op='UPDATE' then new.approved_by:=old.approved_by; else new.approved_by:=null; end if;
  elsif new.status='approved' then new.approved_by:=auth.uid(); end if;
  if tg_op='UPDATE' and new.status in ('draft','review','discarded') then new.approved_by:=null; end if;
 end if;
 if tg_table_name='commercial_followups' then
  if not public.rois_agent_entity_belongs(a.id,new.entity_type,new.entity_id) then raise exception 'Follow-up entity is not owned by this account'; end if;
  new.completed_at:=case when new.status='completed' then coalesce(new.completed_at,now()) else null end;
 end if;
 if tg_table_name='commercial_connections' then
  new.closed_at:=case when new.status in ('closed_won','closed_lost') then coalesce(new.closed_at,now()) else null end;
 end if;
 return new;
end; $$;

-- Server-authored audit entries; no browser-supplied actor or timestamps.
create or replace function public.rois_agent_audit()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare j jsonb:=to_jsonb(new); aid uuid; cid uuid;
begin
 aid:=case when tg_table_name='commercial_account_assignments' then new.id
 else coalesce(nullif(j->>'assignment_id','')::uuid,nullif(j->>'commercial_assignment_id','')::uuid) end;
 if aid is null then
  select o.commercial_assignment_id into aid from public.opportunities o where o.id=nullif(j->>'opportunity_id','')::uuid;
 end if;
 if aid is null then
  select id into aid from public.commercial_account_assignments where company_id=nullif(j->>'company_id','')::uuid
  and status='active' and (service_started_at is null or service_started_at<=now()) and (service_ends_at is null or service_ends_at>now())
  and (not public.rois_agent_role() or public.rois_agent_can_manage_assignment(id)) order by created_at limit 1;
 end if;
 if aid is null then return new; end if;
 select company_id into cid from public.commercial_account_assignments where id=aid;
 insert into public.analytics_events(company_id,event_name,entity_type,entity_id,properties,commercial_assignment_id,commercial_actor_id)
 values(cid,'agent.'||lower(tg_op),tg_table_name,new.id,jsonb_build_object('status',j->>'status',
 'title',coalesce(j->>'title',j->>'target_name',j->>'counterparty_name',j->>'action',j->>'prospect_name'),
 'actor_name',(select name from public.profiles where id=auth.uid())),aid,auth.uid());
 return new;
end; $$;


alter table public.commercial_account_assignments enable row level security;
revoke all on public.commercial_account_assignments from anon,authenticated;
grant select on public.commercial_account_assignments to authenticated;
drop policy if exists agent_read on public.commercial_account_assignments;
create policy agent_read on public.commercial_account_assignments for select to authenticated using(public.rois_agent_can_manage_assignment(id));
drop trigger if exists agent_audit on public.commercial_account_assignments;
create trigger agent_audit after insert or update on public.commercial_account_assignments for each row execute function public.rois_agent_audit();

alter table public.commercial_affinities enable row level security;
revoke all on public.commercial_affinities from anon,authenticated;
grant select on public.commercial_affinities to authenticated;
drop policy if exists agent_read on public.commercial_affinities;
create policy agent_read on public.commercial_affinities for select to authenticated using(public.rois_agent_can_manage_assignment(assignment_id));
drop trigger if exists agent_audit on public.commercial_affinities;
create trigger agent_audit after insert or update on public.commercial_affinities for each row execute function public.rois_agent_audit();

create index if not exists commercial_affinities_assignment_idx on public.commercial_affinities(assignment_id,created_at desc);
drop trigger if exists agent_record_guard on public.commercial_affinities;
create trigger agent_record_guard before insert or update on public.commercial_affinities for each row execute function public.rois_agent_record_guard();

alter table public.commercial_proposal_variants enable row level security;
revoke all on public.commercial_proposal_variants from anon,authenticated;
grant select on public.commercial_proposal_variants to authenticated;
drop policy if exists agent_read on public.commercial_proposal_variants;
create policy agent_read on public.commercial_proposal_variants for select to authenticated using(public.rois_agent_can_manage_assignment(assignment_id));
drop trigger if exists agent_audit on public.commercial_proposal_variants;
create trigger agent_audit after insert or update on public.commercial_proposal_variants for each row execute function public.rois_agent_audit();

create index if not exists commercial_proposal_variants_assignment_idx on public.commercial_proposal_variants(assignment_id,created_at desc);
drop trigger if exists agent_record_guard on public.commercial_proposal_variants;
create trigger agent_record_guard before insert or update on public.commercial_proposal_variants for each row execute function public.rois_agent_record_guard();

alter table public.commercial_connections enable row level security;
revoke all on public.commercial_connections from anon,authenticated;
grant select on public.commercial_connections to authenticated;
drop policy if exists agent_read on public.commercial_connections;
create policy agent_read on public.commercial_connections for select to authenticated using(public.rois_agent_can_manage_assignment(assignment_id));
drop trigger if exists agent_audit on public.commercial_connections;
create trigger agent_audit after insert or update on public.commercial_connections for each row execute function public.rois_agent_audit();

create index if not exists commercial_connections_assignment_idx on public.commercial_connections(assignment_id,created_at desc);
drop trigger if exists agent_record_guard on public.commercial_connections;
create trigger agent_record_guard before insert or update on public.commercial_connections for each row execute function public.rois_agent_record_guard();

alter table public.commercial_followups enable row level security;
revoke all on public.commercial_followups from anon,authenticated;
grant select on public.commercial_followups to authenticated;
drop policy if exists agent_read on public.commercial_followups;
create policy agent_read on public.commercial_followups for select to authenticated using(public.rois_agent_can_manage_assignment(assignment_id));
drop trigger if exists agent_audit on public.commercial_followups;
create trigger agent_audit after insert or update on public.commercial_followups for each row execute function public.rois_agent_audit();

create index if not exists commercial_followups_assignment_idx on public.commercial_followups(assignment_id,created_at desc);
drop trigger if exists agent_record_guard on public.commercial_followups;
create trigger agent_record_guard before insert or update on public.commercial_followups for each row execute function public.rois_agent_record_guard();

grant insert,update on public.commercial_account_assignments to authenticated;
drop policy if exists admin_assign on public.commercial_account_assignments;
create policy admin_assign on public.commercial_account_assignments for all to authenticated
 using(public.rois_is_admin()) with check(public.rois_is_admin());

-- Restrictive policies AND with existing permissive policies: legacy global read policies
-- cannot expose unassigned records to commercial users. Other roles retain their policies.

drop policy if exists agent_scope_boundary on public.companies;
create policy agent_scope_boundary on public.companies as restrictive for select to authenticated
 using(not public.rois_agent_role() or (public.rois_agent_can_manage_company(id)));
drop policy if exists agent_delegated_read on public.companies;
create policy agent_delegated_read on public.companies for select to authenticated
 using(public.rois_agent_role() and (public.rois_agent_can_manage_company(id)));
drop policy if exists agent_no_direct_insert on public.companies;
create policy agent_no_direct_insert on public.companies as restrictive for insert to authenticated
  with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_update on public.companies;
create policy agent_no_direct_update on public.companies as restrictive for update to authenticated
 using(not public.rois_agent_role()) with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_delete on public.companies;
create policy agent_no_direct_delete on public.companies as restrictive for delete to authenticated
 using(not public.rois_agent_role()) ;

drop policy if exists agent_scope_boundary on public.user_profiles;
create policy agent_scope_boundary on public.user_profiles as restrictive for select to authenticated
 using(not public.rois_agent_role() or (public.rois_agent_can_manage_profile(id)));
drop policy if exists agent_delegated_read on public.user_profiles;
create policy agent_delegated_read on public.user_profiles for select to authenticated
 using(public.rois_agent_role() and (public.rois_agent_can_manage_profile(id)));
drop policy if exists agent_no_direct_insert on public.user_profiles;
create policy agent_no_direct_insert on public.user_profiles as restrictive for insert to authenticated
  with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_update on public.user_profiles;
create policy agent_no_direct_update on public.user_profiles as restrictive for update to authenticated
 using(not public.rois_agent_role()) with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_delete on public.user_profiles;
create policy agent_no_direct_delete on public.user_profiles as restrictive for delete to authenticated
 using(not public.rois_agent_role()) ;

drop policy if exists agent_scope_boundary on public.athletes;
create policy agent_scope_boundary on public.athletes as restrictive for select to authenticated
 using(not public.rois_agent_role() or (exists(select 1 from public.user_profiles u where u.legacy_athlete_id=athletes.id and public.rois_agent_can_manage_profile(u.id))));
drop policy if exists agent_delegated_read on public.athletes;
create policy agent_delegated_read on public.athletes for select to authenticated
 using(public.rois_agent_role() and (exists(select 1 from public.user_profiles u where u.legacy_athlete_id=athletes.id and public.rois_agent_can_manage_profile(u.id))));
drop policy if exists agent_no_direct_insert on public.athletes;
create policy agent_no_direct_insert on public.athletes as restrictive for insert to authenticated
  with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_update on public.athletes;
create policy agent_no_direct_update on public.athletes as restrictive for update to authenticated
 using(not public.rois_agent_role()) with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_delete on public.athletes;
create policy agent_no_direct_delete on public.athletes as restrictive for delete to authenticated
 using(not public.rois_agent_role()) ;

drop policy if exists agent_scope_boundary on public.founders;
create policy agent_scope_boundary on public.founders as restrictive for select to authenticated
 using(not public.rois_agent_role() or (exists(select 1 from public.user_profiles u where u.legacy_founder_id=founders.id and public.rois_agent_can_manage_profile(u.id))));
drop policy if exists agent_delegated_read on public.founders;
create policy agent_delegated_read on public.founders for select to authenticated
 using(public.rois_agent_role() and (exists(select 1 from public.user_profiles u where u.legacy_founder_id=founders.id and public.rois_agent_can_manage_profile(u.id))));
drop policy if exists agent_no_direct_insert on public.founders;
create policy agent_no_direct_insert on public.founders as restrictive for insert to authenticated
  with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_update on public.founders;
create policy agent_no_direct_update on public.founders as restrictive for update to authenticated
 using(not public.rois_agent_role()) with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_delete on public.founders;
create policy agent_no_direct_delete on public.founders as restrictive for delete to authenticated
 using(not public.rois_agent_role()) ;

drop policy if exists agent_scope_boundary on public.opportunities;
create policy agent_scope_boundary on public.opportunities as restrictive for select to authenticated
 using(not public.rois_agent_role() or (public.rois_agent_can_manage_company(company_id)));
drop policy if exists agent_delegated_read on public.opportunities;
create policy agent_delegated_read on public.opportunities for select to authenticated
 using(public.rois_agent_role() and (public.rois_agent_can_manage_company(company_id)));
drop policy if exists agent_no_direct_insert on public.opportunities;
create policy agent_no_direct_insert on public.opportunities as restrictive for insert to authenticated
  with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_update on public.opportunities;
create policy agent_no_direct_update on public.opportunities as restrictive for update to authenticated
 using(not public.rois_agent_role()) with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_delete on public.opportunities;
create policy agent_no_direct_delete on public.opportunities as restrictive for delete to authenticated
 using(not public.rois_agent_role()) ;

drop policy if exists agent_scope_boundary on public.company_listings;
create policy agent_scope_boundary on public.company_listings as restrictive for select to authenticated
 using(not public.rois_agent_role() or (public.rois_agent_can_manage_company(company_id)));
drop policy if exists agent_delegated_read on public.company_listings;
create policy agent_delegated_read on public.company_listings for select to authenticated
 using(public.rois_agent_role() and (public.rois_agent_can_manage_company(company_id)));
drop policy if exists agent_no_direct_insert on public.company_listings;
create policy agent_no_direct_insert on public.company_listings as restrictive for insert to authenticated
  with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_update on public.company_listings;
create policy agent_no_direct_update on public.company_listings as restrictive for update to authenticated
 using(not public.rois_agent_role()) with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_delete on public.company_listings;
create policy agent_no_direct_delete on public.company_listings as restrictive for delete to authenticated
 using(not public.rois_agent_role()) ;

drop policy if exists agent_scope_boundary on public.mission_scouts;
create policy agent_scope_boundary on public.mission_scouts as restrictive for select to authenticated
 using(not public.rois_agent_role() or (public.rois_agent_can_manage_company(company_id)));
drop policy if exists agent_delegated_read on public.mission_scouts;
create policy agent_delegated_read on public.mission_scouts for select to authenticated
 using(public.rois_agent_role() and (public.rois_agent_can_manage_company(company_id)));
drop policy if exists agent_no_direct_insert on public.mission_scouts;
create policy agent_no_direct_insert on public.mission_scouts as restrictive for insert to authenticated
  with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_update on public.mission_scouts;
create policy agent_no_direct_update on public.mission_scouts as restrictive for update to authenticated
 using(not public.rois_agent_role()) with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_delete on public.mission_scouts;
create policy agent_no_direct_delete on public.mission_scouts as restrictive for delete to authenticated
 using(not public.rois_agent_role()) ;

drop policy if exists agent_scope_boundary on public.scout_leads;
create policy agent_scope_boundary on public.scout_leads as restrictive for select to authenticated
 using(not public.rois_agent_role() or (public.rois_agent_can_manage_company(company_id) and consent and deleted_at is null));
drop policy if exists agent_delegated_read on public.scout_leads;
create policy agent_delegated_read on public.scout_leads for select to authenticated
 using(public.rois_agent_role() and (public.rois_agent_can_manage_company(company_id) and consent and deleted_at is null));
drop policy if exists agent_no_direct_insert on public.scout_leads;
create policy agent_no_direct_insert on public.scout_leads as restrictive for insert to authenticated
  with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_update on public.scout_leads;
create policy agent_no_direct_update on public.scout_leads as restrictive for update to authenticated
 using(not public.rois_agent_role()) with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_delete on public.scout_leads;
create policy agent_no_direct_delete on public.scout_leads as restrictive for delete to authenticated
 using(not public.rois_agent_role()) ;

drop policy if exists agent_scope_boundary on public.scout_mission_commissions;
create policy agent_scope_boundary on public.scout_mission_commissions as restrictive for select to authenticated
 using(not public.rois_agent_role() or (public.rois_agent_can_manage_company(company_id)));
drop policy if exists agent_delegated_read on public.scout_mission_commissions;
create policy agent_delegated_read on public.scout_mission_commissions for select to authenticated
 using(public.rois_agent_role() and (public.rois_agent_can_manage_company(company_id)));
drop policy if exists agent_no_direct_insert on public.scout_mission_commissions;
create policy agent_no_direct_insert on public.scout_mission_commissions as restrictive for insert to authenticated
  with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_update on public.scout_mission_commissions;
create policy agent_no_direct_update on public.scout_mission_commissions as restrictive for update to authenticated
 using(not public.rois_agent_role()) with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_delete on public.scout_mission_commissions;
create policy agent_no_direct_delete on public.scout_mission_commissions as restrictive for delete to authenticated
 using(not public.rois_agent_role()) ;

drop policy if exists agent_scope_boundary on public.opportunity_applications;
create policy agent_scope_boundary on public.opportunity_applications as restrictive for select to authenticated
 using(not public.rois_agent_role() or (public.rois_agent_application_allowed(id)));
drop policy if exists agent_delegated_read on public.opportunity_applications;
create policy agent_delegated_read on public.opportunity_applications for select to authenticated
 using(public.rois_agent_role() and (public.rois_agent_application_allowed(id)));
drop policy if exists agent_no_direct_insert on public.opportunity_applications;
create policy agent_no_direct_insert on public.opportunity_applications as restrictive for insert to authenticated
  with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_update on public.opportunity_applications;
create policy agent_no_direct_update on public.opportunity_applications as restrictive for update to authenticated
 using(not public.rois_agent_role()) with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_delete on public.opportunity_applications;
create policy agent_no_direct_delete on public.opportunity_applications as restrictive for delete to authenticated
 using(not public.rois_agent_role()) ;

drop policy if exists agent_scope_boundary on public.application_consents;
create policy agent_scope_boundary on public.application_consents as restrictive for select to authenticated
 using(not public.rois_agent_role() or (public.rois_agent_application_allowed(application_id)));
drop policy if exists agent_delegated_read on public.application_consents;
create policy agent_delegated_read on public.application_consents for select to authenticated
 using(public.rois_agent_role() and (public.rois_agent_application_allowed(application_id)));
drop policy if exists agent_no_direct_insert on public.application_consents;
create policy agent_no_direct_insert on public.application_consents as restrictive for insert to authenticated
  with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_update on public.application_consents;
create policy agent_no_direct_update on public.application_consents as restrictive for update to authenticated
 using(not public.rois_agent_role()) with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_delete on public.application_consents;
create policy agent_no_direct_delete on public.application_consents as restrictive for delete to authenticated
 using(not public.rois_agent_role()) ;

drop policy if exists agent_scope_boundary on public.participations;
create policy agent_scope_boundary on public.participations as restrictive for select to authenticated
 using(not public.rois_agent_role() or (exists(select 1 from public.opportunities o where o.id=participations.opportunity_id and public.rois_agent_can_manage_company(o.company_id))));
drop policy if exists agent_delegated_read on public.participations;
create policy agent_delegated_read on public.participations for select to authenticated
 using(public.rois_agent_role() and (exists(select 1 from public.opportunities o where o.id=participations.opportunity_id and public.rois_agent_can_manage_company(o.company_id))));
drop policy if exists agent_no_direct_insert on public.participations;
create policy agent_no_direct_insert on public.participations as restrictive for insert to authenticated
  with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_update on public.participations;
create policy agent_no_direct_update on public.participations as restrictive for update to authenticated
 using(not public.rois_agent_role()) with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_delete on public.participations;
create policy agent_no_direct_delete on public.participations as restrictive for delete to authenticated
 using(not public.rois_agent_role()) ;

drop policy if exists agent_scope_boundary on public.conversions;
create policy agent_scope_boundary on public.conversions as restrictive for select to authenticated
 using(not public.rois_agent_role() or (public.rois_agent_can_manage_company(company_id)));
drop policy if exists agent_delegated_read on public.conversions;
create policy agent_delegated_read on public.conversions for select to authenticated
 using(public.rois_agent_role() and (public.rois_agent_can_manage_company(company_id)));
drop policy if exists agent_no_direct_insert on public.conversions;
create policy agent_no_direct_insert on public.conversions as restrictive for insert to authenticated
  with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_update on public.conversions;
create policy agent_no_direct_update on public.conversions as restrictive for update to authenticated
 using(not public.rois_agent_role()) with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_delete on public.conversions;
create policy agent_no_direct_delete on public.conversions as restrictive for delete to authenticated
 using(not public.rois_agent_role()) ;

drop policy if exists agent_scope_boundary on public.crm;
create policy agent_scope_boundary on public.crm as restrictive for select to authenticated
 using(not public.rois_agent_role() or (commercial_assignment_id is not null and public.rois_agent_can_manage_assignment(commercial_assignment_id)));
drop policy if exists agent_delegated_read on public.crm;
create policy agent_delegated_read on public.crm for select to authenticated
 using(public.rois_agent_role() and (commercial_assignment_id is not null and public.rois_agent_can_manage_assignment(commercial_assignment_id)));
drop policy if exists agent_no_direct_insert on public.crm;
create policy agent_no_direct_insert on public.crm as restrictive for insert to authenticated
  with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_update on public.crm;
create policy agent_no_direct_update on public.crm as restrictive for update to authenticated
 using(not public.rois_agent_role()) with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_delete on public.crm;
create policy agent_no_direct_delete on public.crm as restrictive for delete to authenticated
 using(not public.rois_agent_role()) ;

drop policy if exists agent_scope_boundary on public.analytics_events;
create policy agent_scope_boundary on public.analytics_events as restrictive for select to authenticated
 using(not public.rois_agent_role() or (commercial_assignment_id is not null and public.rois_agent_can_manage_assignment(commercial_assignment_id)));
drop policy if exists agent_delegated_read on public.analytics_events;
create policy agent_delegated_read on public.analytics_events for select to authenticated
 using(public.rois_agent_role() and (commercial_assignment_id is not null and public.rois_agent_can_manage_assignment(commercial_assignment_id)));
drop policy if exists agent_no_direct_insert on public.analytics_events;
create policy agent_no_direct_insert on public.analytics_events as restrictive for insert to authenticated
  with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_update on public.analytics_events;
create policy agent_no_direct_update on public.analytics_events as restrictive for update to authenticated
 using(not public.rois_agent_role()) with check(not public.rois_agent_role());
drop policy if exists agent_no_direct_delete on public.analytics_events;
create policy agent_no_direct_delete on public.analytics_events as restrictive for delete to authenticated
 using(not public.rois_agent_role()) ;

-- Existing entities are mutated only through the controlled RPC below.
-- Their existing triggers still run (Scout commission derivation, identity, etc.).
drop trigger if exists agent_audit on public.opportunities;
create trigger agent_audit after insert or update on public.opportunities for each row execute function public.rois_agent_audit();
drop trigger if exists agent_audit on public.company_listings;
create trigger agent_audit after insert or update on public.company_listings for each row execute function public.rois_agent_audit();
drop trigger if exists agent_audit on public.mission_scouts;
create trigger agent_audit after insert or update on public.mission_scouts for each row execute function public.rois_agent_audit();
drop trigger if exists agent_audit on public.scout_leads;
create trigger agent_audit after insert or update on public.scout_leads for each row execute function public.rois_agent_audit();

create or replace function public.rois_agent_save(p_kind text,p_assignment_id uuid,p_id uuid default null,p_values jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.commercial_account_assignments; tbl text; allowed text[]; cols text; vals text; sets text;
 k text; result jsonb; existing jsonb; rid uuid:=coalesce(p_id,gen_random_uuid());
begin
 a:=public.rois_agent_require_assignment(p_assignment_id);
 if jsonb_typeof(p_values)<>'object' then raise exception 'Expected an object'; end if;
 case p_kind
 when 'affinity' then tbl:='commercial_affinities'; allowed:=array['target_type','target_id','target_name','score','priority','reasons','commercial_hypothesis','potential_value','currency','status','next_action','next_action_at','source_lead_id'];
 when 'proposal' then tbl:='commercial_proposal_variants'; allowed:=array['proposal_type','master_entity_type','master_entity_id','counterparty_type','counterparty_id','counterparty_name','affinity_id','title','commercial_thesis','benefits','activations','deliverables','economic_proposal','cta','status'];
 when 'connection' then tbl:='commercial_connections'; allowed:=array['affinity_id','proposal_variant_id','source_lead_id','counterparty_type','counterparty_id','counterparty_name','context','potential_value','currency','status','next_action','next_action_at','notes'];
 when 'followup' then tbl:='commercial_followups'; allowed:=array['entity_type','entity_id','action','context','priority','due_at','status'];
 else raise exception 'Unsupported workspace entity';
 end case;
 if p_id is not null then
  execute format('select to_jsonb(t) from public.%I t where id=$1 and assignment_id=$2 for update',tbl) into existing using p_id,a.id;
  if existing is null then raise exception 'Record not authorized' using errcode='42501'; end if;
 end if;
 for k in select jsonb_object_keys(p_values) loop
  if not k=any(allowed) then raise exception 'Field not allowed: %',k; end if;
  cols:=concat_ws(',',cols,format('%I',k));
  vals:=concat_ws(',',vals,format('(jsonb_populate_record(null::public.%I,$1)).%I',tbl,k));
  sets:=concat_ws(',',sets,format('%I=(jsonb_populate_record(null::public.%I,$1)).%I',k,tbl,k));
 end loop;
 if cols is null then raise exception 'No fields supplied'; end if;
 if p_id is null then
  -- A double lead conversion returns the same relationship rather than duplicating it.
  if p_kind in ('affinity','connection') and nullif(p_values->>'source_lead_id','') is not null then
   perform pg_advisory_xact_lock(hashtextextended(a.id::text||p_kind||(p_values->>'source_lead_id'),0));
   execute format('select to_jsonb(t) from public.%I t where assignment_id=$1 and source_lead_id=$2',tbl)
    into result using a.id,(p_values->>'source_lead_id')::uuid;
   if result is not null then return result; end if;
  end if;
  execute format('insert into public.%I(id,assignment_id,%s) select $2,$3,%s returning to_jsonb(%I.*)',tbl,cols,vals,tbl)
   into result using p_values,rid,a.id;
 else
  execute format('update public.%I set %s where id=$2 and assignment_id=$3 returning to_jsonb(%I.*)',tbl,sets,tbl)
   into result using p_values,rid,a.id;
 end if;
 return result;
end; $$;

create or replace function public.rois_agent_operate(p_kind text,p_assignment_id uuid,p_id uuid default null,p_values jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.commercial_account_assignments; tbl text; allowed text[]; k text;
 cols text; vals text; sets text; existing jsonb; result jsonb; rid uuid:=coalesce(p_id,gen_random_uuid());
begin
 a:=public.rois_agent_require_assignment(p_assignment_id);
 if a.company_id is null then
  -- Talent representation can use a publishing company explicitly linked by Admin.
  -- Both assignments must remain authorized. Never invent a company or impersonate its owner.
  a.company_id:=(public.rois_agent_require_assignment(nullif(a.scope->>'publishing_assignment_id','')::uuid)).company_id;
  if a.company_id is null then raise exception 'This operation requires an assigned publishing company'; end if;
 end if;
 case p_kind
 when 'opportunity' then
  tbl:='opportunities'; allowed:=array['title','description','opportunity_type','category','industry','objective','desired_profile','territory','location','modality','starts_at','closes_at','slots','compensation_type','compensation_amount','deliverables','acceptance_criteria','payment_terms','status'];
 when 'listing' then
  tbl:='company_listings'; allowed:=array['listing_type','category','title','summary','description','price','currency','price_label','location','inventory_count','availability','commercial_target_market','status'];
 when 'mission' then
  tbl:='opportunities'; allowed:=array['scout_enabled','scout_reward_event','scout_reward_amount','scout_reward_currency','scout_terms','scout_requires_approval','scout_evidence_required','objective','desired_profile','territory','closes_at','slots','corporate_listing_id'];
 when 'scout' then tbl:='mission_scouts'; allowed:=array['status'];
 when 'lead' then tbl:='scout_leads'; allowed:=array['status','company_notes','commercial_requested_information'];
 when 'application' then tbl:='opportunity_applications'; allowed:=array['status','company_notes','requested_information'];
 else raise exception 'Unsupported delegated operation';
 end case;
 if p_id is not null then
  if p_kind='application' then
   if not public.rois_agent_application_allowed(p_id) or not exists(select 1 from public.opportunity_applications app
    join public.opportunities o on o.id=app.opportunity_id where app.id=p_id and o.company_id=a.company_id) then
    raise exception 'Application consent or account access is not valid' using errcode='42501';
   end if;
   select to_jsonb(t) into existing from public.opportunity_applications t where id=p_id for update;
  else
   execute format('select to_jsonb(t) from public.%I t where id=$1 and company_id=$2 for update',tbl)
    into existing using p_id,a.company_id;
  end if;
  if existing is null or existing->>'deleted_at' is not null then raise exception 'Record not authorized' using errcode='42501'; end if;
 elsif p_kind not in ('opportunity','listing') then raise exception 'Existing record required';
 end if;
 if p_kind='lead' and not coalesce((existing->>'consent')::boolean,false) then raise exception 'Lead consent required'; end if;
 if p_kind='opportunity' then
  if existing is not null and existing->>'status' not in ('draft','in_review','rejected') then raise exception 'Only unpublished opportunities can be edited'; end if;
  if coalesce(p_values->>'status','draft') not in ('draft','in_review') then raise exception 'Administrative moderation is required'; end if;
 elsif p_kind='listing' then
  if existing is not null and existing->>'status' not in ('draft','pending','rejected') then raise exception 'Only unpublished listings can be edited'; end if;
  if coalesce(p_values->>'status','draft') not in ('draft','pending') then raise exception 'Administrative moderation is required'; end if;
  if p_id is null and not public.rois_company_can_create_listing(a.company_id) then raise exception 'Company listing entitlement or limit does not permit creation'; end if;
 elsif p_kind='mission' then
  if existing->>'status' not in ('draft','in_review','published','paused') then raise exception 'Opportunity cannot run a Scout mission'; end if;
  if nullif(p_values->>'corporate_listing_id','') is not null and not public.rois_agent_entity_belongs(a.id,'listing',(p_values->>'corporate_listing_id')::uuid) then
   raise exception 'Corporate asset is not owned by this account';
  end if;
  if coalesce((p_values->>'scout_reward_amount')::numeric,0)<0 or coalesce(p_values->>'scout_reward_event','qualified') not in ('qualified','meeting','activated') then raise exception 'Invalid Scout reward'; end if;
 elsif p_kind='application' and coalesce(p_values->>'status',existing->>'status') not in ('information_requested','accepted','rejected','in_execution','completed','cancelled','disputed') then
  raise exception 'Application transition is not delegated';
 elsif p_kind='lead' and coalesce(p_values->>'status',existing->>'status') not in ('submitted','contacted','qualified','meeting','activated','rejected','duplicate','cancelled') then raise exception 'Invalid lead status';
 end if;
 if jsonb_typeof(p_values)<>'object' then raise exception 'Expected an object'; end if;
 for k in select jsonb_object_keys(p_values) loop
  if not k=any(allowed) then raise exception 'Field not allowed: %',k; end if;
  cols:=concat_ws(',',cols,format('%I',k));
  vals:=concat_ws(',',vals,format('(jsonb_populate_record(null::public.%I,$1)).%I',tbl,k));
  sets:=concat_ws(',',sets,format('%I=(jsonb_populate_record(null::public.%I,$1)).%I',k,tbl,k));
 end loop;
 if cols is null then raise exception 'No fields supplied'; end if;
 if p_id is null then
  if p_kind='opportunity' then
   execute format('insert into public.opportunities(id,company_id,commercial_assignment_id,created_by,%s) select $2,$3,$4,auth.uid(),%s returning to_jsonb(opportunities.*)',cols,vals)
    into result using p_values,rid,a.company_id,a.id;
  else
   execute format('insert into public.company_listings(id,company_id,commercial_assignment_id,commercial_actor_id,profile_id,company_name,%s) select $2,$3,$4,auth.uid(),c.profile_id,c.name,%s from public.companies c where c.id=$3 returning to_jsonb(company_listings.*)',cols,vals)
    into result using p_values,rid,a.company_id,a.id;
  end if;
 else
  execute format('update public.%I set %s,updated_at=now() where id=$2 returning to_jsonb(%I.*)',tbl,sets,tbl)
   into result using p_values,rid;
 end if;
 -- Audits for updates to legacy entities without assignment metadata.
 if (result->>'commercial_assignment_id') is null and public.rois_is_admin() then
  insert into public.analytics_events(company_id,event_name,entity_type,entity_id,commercial_assignment_id,commercial_actor_id,properties)
  values(a.company_id,'agent.update',tbl,rid,a.id,auth.uid(),jsonb_build_object('status',result->>'status'));
 end if;
 return result;
end; $$;

-- A validated Scout professional becomes an existing CRM invitation record, not a second
-- invitation system. Email delivery remains the existing send-crm-invitation endpoint.
create or replace function public.rois_agent_prepare_invitation(p_assignment_id uuid,p_lead_id uuid,p_prospect_type text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.commercial_account_assignments; l public.scout_leads; r public.crm;
begin
 a:=public.rois_agent_require_assignment(p_assignment_id);
 select * into l from public.scout_leads where id=p_lead_id and public.rois_agent_entity_belongs(a.id,'lead',id) for update;
 if l.id is null or not l.consent or l.deleted_at is not null or l.status not in ('qualified','meeting','activated')
 or nullif(trim(l.prospect_email),'') is null or p_prospect_type not in ('athlete','creator') then
  raise exception 'A consented, validated professional with email is required';
 end if;
 if l.commercial_invitation_crm_id is not null then
  select * into r from public.crm where id=l.commercial_invitation_crm_id; return to_jsonb(r);
 end if;
 insert into public.crm(name,email,contact_name,prospect_type,organization,source,scout_code,status,created_by,commercial_assignment_id)
 values(l.prospect_name,l.prospect_email,l.prospect_name,p_prospect_type,l.prospect_company,'Scout mission',l.scout_code,'Nuevo',auth.uid(),a.id)
 returning * into r;
 update public.scout_leads set commercial_invitation_crm_id=r.id where id=l.id;
 return to_jsonb(r);
end; $$;

-- Filtered snapshot: only assigned accounts and only consented application fields.
-- Failures propagate to the UI. There is no fallback to cached or mock records.
create or replace function public.rois_agent_workspace()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb:='{}'; aids uuid[]; cids uuid[]; uids uuid[]; rows jsonb; tbl text;
begin
 if not public.rois_is_admin() and not exists(select 1 from public.profiles where id=auth.uid() and role='commercial' and status='approved') then
  raise exception 'Approved ROIS agent session required' using errcode='42501';
 end if;
 select coalesce(array_agg(id),'{}'),coalesce(array_agg(company_id) filter(where company_id is not null),'{}'),
 coalesce(array_agg(user_profile_id) filter(where user_profile_id is not null),'{}')
 into aids,cids,uids from public.commercial_account_assignments where public.rois_agent_can_manage_assignment(id);
 select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]') into rows from public.commercial_account_assignments a where id=any(aids);
 result:=result||jsonb_build_object('commercial_account_assignments',rows);
 foreach tbl in array array['commercial_affinities','commercial_proposal_variants','commercial_connections','commercial_followups'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by created_at desc),''[]'') from public.%I t where assignment_id=any($1)',tbl)
   into rows using aids;
  result:=result||jsonb_build_object(tbl,rows);
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'profile_id',c.profile_id,'name',c.name,'logo_url',c.logo_url,
 'description',c.description,'interest',c.interest,'website',c.website,'status',c.status,'created_at',c.created_at)),'[]')
 into rows from public.companies c where c.id=any(cids);
 result:=result||jsonb_build_object('companies',rows);
 select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'profile_id',u.profile_id,'name',u.name,'public_name',u.public_name,
 'image_url',u.image_url,'bio',u.bio,'city',u.city,'country',u.country,'interests',u.interests,'capabilities',u.capabilities,
 'legacy_athlete_id',coalesce(u.legacy_athlete_id,(select id from public.athletes where profile_id=u.profile_id order by created_at,id limit 1)),
 'legacy_founder_id',coalesce(u.legacy_founder_id,(select id from public.founders where profile_id=u.profile_id order by created_at,id limit 1)),'status',u.status)),'[]')
 into rows from public.user_profiles u where u.id=any(uids);
 result:=result||jsonb_build_object('user_profiles',rows);
 -- Objective facts and master decks are read-only; private family/financial/contact fields are excluded.
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'profile_id',t.profile_id,'name',t.name,'image_url',t.image_url,
 'sport',t.sport,'category',t.category,'location',t.location,'ranking',t.ranking,'stats',t.stats,'monthly',t.monthly,
 'max_sponsors',to_jsonb(t)->'max_sponsors','sponsor_deck',to_jsonb(t)->'sponsor_deck',
 'sponsor_deck_score',to_jsonb(t)->'sponsor_deck_score','sponsor_deck_status',to_jsonb(t)->'sponsor_deck_status')),'[]')
 into rows from public.athletes t join public.user_profiles u on coalesce(u.legacy_athlete_id,(select id from public.athletes where profile_id=u.profile_id order by created_at,id limit 1))=t.id where u.id=any(uids);
 result:=result||jsonb_build_object('athletes',rows);
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'profile_id',t.profile_id,'name',t.name,'public_name',t.public_name,
 'image_url',to_jsonb(t)->'image_url','creator_type',t.creator_type,'industry',t.industry,'city',t.city,'stats',t.stats,
 'monthly',t.monthly,'max_sponsors',t.max_sponsors,'audience_size',t.audience_size,'engagement_rate',t.engagement_rate,
 'sponsor_deck',to_jsonb(t)->'sponsor_deck','sponsor_deck_score',to_jsonb(t)->'sponsor_deck_score')),'[]')
 into rows from public.founders t join public.user_profiles u on coalesce(u.legacy_founder_id,(select id from public.founders where profile_id=u.profile_id order by created_at,id limit 1))=t.id where u.id=any(uids);
 result:=result||jsonb_build_object('founders',rows);
 foreach tbl in array array['opportunities','company_listings','mission_scouts','conversions','scout_mission_commissions'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by created_at desc),''[]'') from public.%I t where company_id=any($1)',tbl)
   into rows using cids;
  result:=result||jsonb_build_object(tbl,rows);
 end loop;
 select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc),'[]') into rows
 from public.scout_leads l where company_id=any(cids) and consent and deleted_at is null;
 result:=result||jsonb_build_object('scout_leads',rows);
 select coalesce(jsonb_agg(jsonb_build_object('lead_id',l.id,'company_id',l.company_id,'registered_at',u.created_at)),'[]')
 into rows from public.scout_leads l join public.crm r on r.id=l.commercial_invitation_crm_id
 join public.user_profiles u on lower(u.email)=lower(r.email)
 where l.company_id=any(cids) and l.consent and l.deleted_at is null
 and r.invitation_sent_at is not null and u.created_at>=r.invitation_sent_at;
 result:=result||jsonb_build_object('commercial_professional_outcomes',rows);
 select coalesce(jsonb_agg(to_jsonb(p)),'[]') into rows from public.participations p
 join public.opportunities o on o.id=p.opportunity_id where o.company_id=any(cids);
 result:=result||jsonb_build_object('participations',rows);
 select coalesce(jsonb_agg(jsonb_build_object('id',app.id,'opportunity_id',app.opportunity_id,'status',app.status,
 'message',app.message,'company_notes',app.company_notes,'created_at',app.created_at,'updated_at',app.updated_at,
 'shared_profile_snapshot',(select coalesce(jsonb_object_agg(k.key,k.value),'{}') from jsonb_each(app.shared_profile_snapshot) k
 where exists(select 1 from public.application_consents c where c.application_id=app.id and c.company_id=o.company_id
 and c.granted and c.revoked_at is null and (c.expires_at is null or c.expires_at>now()) and k.key=any(c.authorized_fields))))),'[]')
 into rows from public.opportunity_applications app join public.opportunities o on o.id=app.opportunity_id
 where o.company_id=any(cids) and public.rois_agent_application_allowed(app.id);
 result:=result||jsonb_build_object('opportunity_applications',rows);
 select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc),'[]') into rows from public.analytics_events e
 where e.commercial_assignment_id=any(aids) or (e.company_id=any(cids) and e.commercial_assignment_id is not null);
 result:=result||jsonb_build_object('analytics_events',rows);
 if public.rois_is_admin() then
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name)),'[]') into rows
  from public.profiles p where role='commercial' and status='approved';
  result:=result||jsonb_build_object('agent_catalog',rows);
  select coalesce(jsonb_agg(t),'[]') into rows from (
   select c.id,c.name,'company'::text as account_type from public.companies c
   union all select u.id,u.name,case p.role when 'athlete' then 'athlete' else 'creator' end
   from public.user_profiles u join public.profiles p on p.id=u.profile_id where p.role in ('athlete','founder')) t;
  result:=result||jsonb_build_object('account_catalog',rows);
 end if;
 return result||jsonb_build_object('loaded_at',now());
end; $$;

-- Application rows are consumed only through the consent-filtered snapshot RPC for agents.
drop policy if exists agent_scope_boundary on public.opportunity_applications;
create policy agent_scope_boundary on public.opportunity_applications as restrictive for select to authenticated
 using(not public.rois_agent_role());
-- Legacy grants/billing are never delegated.
do $$
declare t text; op text;
begin
 foreach t in array array['payments','company_access_grants','company_subscriptions','commissions','requests','sponsorships','profiles'] loop
  if to_regclass('public.'||t) is null then continue; end if;
  foreach op in array array['insert','update','delete'] loop
   execute format('drop policy if exists agent_no_direct_%s on public.%I',op,t);
   execute format('create policy agent_no_direct_%s on public.%I as restrictive for %s to authenticated %s %s',
    op,t,op,case when op<>'insert' then 'using(not public.rois_agent_role())' else '' end,
    case when op<>'delete' then 'with check(not public.rois_agent_role())' else '' end);
  end loop;
 end loop;
end $$;

-- Never expose definer helper functions or triggers to anonymous callers.

-- Newly added metadata cannot be forged through legacy owner policies.
create or replace function public.rois_agent_metadata_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare j jsonb:=to_jsonb(new); oldj jsonb;
begin
 if tg_op='UPDATE' then oldj:=to_jsonb(old); else oldj:='{}'; end if;
 if not public.rois_is_admin() and not public.rois_agent_role() and
 ((j->>'commercial_assignment_id') is distinct from (oldj->>'commercial_assignment_id')
 or (j->>'commercial_actor_id') is distinct from (oldj->>'commercial_actor_id')
 or (j->>'commercial_requested_information') is distinct from (oldj->>'commercial_requested_information')
 or (j->>'commercial_invitation_crm_id') is distinct from (oldj->>'commercial_invitation_crm_id')) then
  raise exception 'Delegated metadata is server-managed' using errcode='42501';
 end if;
 return new;
end; $$;
do $$
declare t text;
begin
 foreach t in array array['opportunities','company_listings','scout_leads','crm'] loop
  execute format('drop trigger if exists agent_metadata_guard on public.%I',t);
  execute format('create trigger agent_metadata_guard before insert or update on public.%I for each row execute function public.rois_agent_metadata_guard()',t);
 end loop;
end $$;
create or replace function public.rois_agent_audit_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if (new.commercial_assignment_id is not null or new.commercial_actor_id is not null)
 and pg_trigger_depth()<2 and not public.rois_is_admin() then
  raise exception 'Agent activity is server-authored' using errcode='42501';
 end if;
 return new;
end; $$;
drop trigger if exists agent_audit_guard on public.analytics_events;
create trigger agent_audit_guard before insert or update on public.analytics_events
 for each row execute function public.rois_agent_audit_guard();
-- Preserve the existing first-login password reset, without granting role changes.
drop policy if exists agent_no_direct_update on public.profiles;
create policy agent_no_direct_update on public.profiles as restrictive for update to authenticated
 using(not public.rois_agent_role() or id=auth.uid())
 with check(not public.rois_agent_role() or (id=auth.uid() and must_change_password=false));
create or replace function public.rois_agent_profile_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if public.rois_agent_role() and (to_jsonb(new)-'must_change_password') is distinct from (to_jsonb(old)-'must_change_password') then
  raise exception 'Agents cannot change profile identity or permissions';
 end if;
 return new;
end; $$;
drop trigger if exists agent_profile_guard on public.profiles;
create trigger agent_profile_guard before update on public.profiles for each row execute function public.rois_agent_profile_guard();

do $$
declare t text;
begin
 foreach t in array array['payments','company_access_grants','company_subscriptions','requests','sponsorships'] loop
  if to_regclass('public.'||t) is null then continue; end if;
  execute format('drop policy if exists agent_private_read_boundary on public.%I',t);
  execute format('create policy agent_private_read_boundary on public.%I as restrictive for select to authenticated using(not public.rois_agent_role())',t);
 end loop;
end $$;

do $$
declare f record;
begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'rois_agent_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 end loop;
end $$;
grant execute on function public.rois_agent_role(),public.rois_agent_can_manage_assignment(uuid),
 public.rois_agent_can_manage_company(uuid),public.rois_agent_can_manage_profile(uuid),
 public.rois_agent_application_allowed(uuid) to authenticated;
grant execute on function public.rois_agent_workspace(),public.rois_agent_save(text,uuid,uuid,jsonb),
 public.rois_agent_operate(text,uuid,uuid,jsonb),public.rois_agent_prepare_invitation(uuid,uuid,text) to authenticated;
comment on table public.commercial_account_assignments is 'Admin-managed representation, never impersonation. Withdraw instead of deleting.';
comment on table public.commercial_proposal_variants is 'Counterparty-specific commercial narrative; Sponsor Deck master and objective evidence stay read-only.';
notify pgrst,'reload schema';

-- Bridge existing approved external Scouts to the universal mission identity.
-- Does not introduce a role, replace Scout registration, or create a new network.
create or replace function public.rois_scout_mission_profile()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.profiles; s jsonb; u public.user_profiles;
begin
 select * into p from public.profiles where id=auth.uid() and role='scout' and status='approved';
 if p.id is null then raise exception 'Approved external Scout required' using errcode='42501'; end if;
 if to_regclass('public.scouts') is null then raise exception 'Existing external Scout migration is required'; end if;
 execute 'select to_jsonb(s) from public.scouts s where profile_id=$1 and status=''approved'' limit 1' into s using p.id;
 if s is null or nullif(s->>'scout_code','') is null then raise exception 'Active Scout identity is required'; end if;
 insert into public.user_profiles(profile_id,email,name,public_name,scout_code,scout_active,status)
 values(p.id,p.email,p.name,p.name,s->>'scout_code',true,'approved')
 on conflict(profile_id) do nothing;
 select * into u from public.user_profiles where profile_id=p.id;
 return to_jsonb(u);
end; $$;
revoke all on function public.rois_scout_mission_profile() from public,anon;
grant execute on function public.rois_scout_mission_profile() to authenticated;

commit;
