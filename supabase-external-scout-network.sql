-- Canonical external Scout infrastructure, recovered from the local legacy migration.
-- Safe coexistence: never converts commercial accounts or rewrites existing Scout codes.
-- Run after the base schema and CRM invitations; before Agent Workspace V1.
begin;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
 check(role in ('admin','commercial','scout','client','athlete','founder'));

create table if not exists public.scouts (
 id uuid primary key default gen_random_uuid(), profile_id uuid unique references public.profiles(id) on delete cascade,
 email text unique not null, name text not null, scout_code text unique not null,
 status text not null default 'approved' check(status in ('pending','approved','blocked','deleted','rejected')),
 commission_per_active_referral numeric not null default 500,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
comment on column public.scouts.commission_per_active_referral is
 'Legacy one-time referral amount; not a mission reward. Existing amounts are not rewritten.';
create unique index if not exists scouts_email_lower_key on public.scouts(lower(email));
create unique index if not exists scouts_code_normalized_key
 on public.scouts((regexp_replace(upper(scout_code),'[^A-Z0-9]','','g')));
create index if not exists scouts_profile_id_idx on public.scouts(profile_id);

create or replace function public.rois_current_scout_code()
returns text language sql stable security definer set search_path=public,pg_temp as $$
 select s.scout_code from public.scouts s join public.profiles p on p.id=s.profile_id
 where p.id=auth.uid() and p.role='scout' and p.status='approved' and s.status='approved';
$$;
create or replace function public.register_external_scout(scout_name text,scout_email text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.profiles; s public.scouts; n text:=trim(coalesce(scout_name,''));
 e text:=lower(trim(coalesce(scout_email,'')));
begin
 if auth.uid() is null or e='' or e<>lower(trim(coalesce(auth.jwt()->>'email',''))) then
  raise exception 'Authenticated email is required' using errcode='42501';
 end if;
 if n='' then raise exception 'Scout name is required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into p from public.profiles where id=auth.uid() for update;
 if p.id is null then
  insert into public.profiles(id,email,role,name,status,must_change_password)
  values(auth.uid(),e,'scout',n,'approved',false) returning * into p;
 elsif p.role<>'scout' or lower(p.email)<>e or p.status<>'approved' then
  raise exception 'Existing identity or approval cannot be changed through Scout registration' using errcode='42501';
 end if;
 select * into s from public.scouts where profile_id=p.id for update;
 if s.id is null then
  insert into public.scouts(profile_id,email,name,scout_code,status)
  values(p.id,e,n,'ROIS-'||upper(substr(md5(e||p.id::text),1,6)),'approved') returning * into s;
 elsif s.status<>'approved' then
  raise exception 'Scout approval is required' using errcode='42501';
 end if;
 return jsonb_build_object('profile_id',p.id,'email',s.email,'name',s.name,'role','scout','scout_code',s.scout_code,'status',s.status);
end; $$;

-- Existing Scout-only policies are retained; restrictive boundaries constrain any
-- older broad grants. Approval, identity, canonical code and economics are admin-owned.
create or replace function public.rois_external_scout_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.rois_is_admin() and (to_jsonb(new)-array['name','updated_at'])
  is distinct from (to_jsonb(old)-array['name','updated_at']) then
  raise exception 'Scout identity, approval and economics are administered by ROIS' using errcode='42501';
 end if;
 new.updated_at:=now(); return new;
end; $$;
drop trigger if exists scouts_identity_guard on public.scouts;
create trigger scouts_identity_guard before update on public.scouts for each row execute function public.rois_external_scout_guard();
alter table public.scouts enable row level security;
drop policy if exists external_scout_read on public.scouts;
create policy external_scout_read on public.scouts for select to authenticated using(public.rois_is_admin() or profile_id=auth.uid());
drop policy if exists external_scout_read_boundary on public.scouts;
create policy external_scout_read_boundary on public.scouts as restrictive for select to authenticated using(public.rois_is_admin() or profile_id=auth.uid());
drop policy if exists external_scout_admin on public.scouts;
create policy external_scout_admin on public.scouts for all to authenticated using(public.rois_is_admin()) with check(public.rois_is_admin());
drop policy if exists external_scout_update on public.scouts;
create policy external_scout_update on public.scouts for update to authenticated using(profile_id=auth.uid()) with check(profile_id=auth.uid());
drop policy if exists external_scout_write_boundary on public.scouts;
create policy external_scout_write_boundary on public.scouts as restrictive for update to authenticated
 using(public.rois_is_admin() or profile_id=auth.uid()) with check(public.rois_is_admin() or profile_id=auth.uid());
drop policy if exists external_scout_insert_boundary on public.scouts;
create policy external_scout_insert_boundary on public.scouts as restrictive for insert to authenticated with check(public.rois_is_admin());
drop policy if exists external_scout_delete_boundary on public.scouts;
create policy external_scout_delete_boundary on public.scouts as restrictive for delete to authenticated using(public.rois_is_admin());
grant select,insert,update on public.scouts to authenticated;

drop policy if exists external_scout_crm on public.crm;
create policy external_scout_crm on public.crm for all to authenticated
 using(created_by=auth.uid() and prospect_type in ('athlete','creator') and scout_code=public.rois_current_scout_code())
 with check(created_by=auth.uid() and prospect_type in ('athlete','creator') and scout_code=public.rois_current_scout_code());
drop policy if exists external_scout_crm_boundary on public.crm;
create policy external_scout_crm_boundary on public.crm as restrictive for all to authenticated
 using(not exists(select 1 from public.profiles where id=auth.uid() and role='scout')
  or (created_by=auth.uid() and prospect_type in ('athlete','creator') and scout_code=public.rois_current_scout_code()))
 with check(not exists(select 1 from public.profiles where id=auth.uid() and role='scout')
  or (created_by=auth.uid() and prospect_type in ('athlete','creator') and scout_code=public.rois_current_scout_code()));

drop policy if exists external_scout_crm_no_delete on public.crm;
create policy external_scout_crm_no_delete on public.crm as restrictive for delete to authenticated
 using(not exists(select 1 from public.profiles where id=auth.uid() and role='scout'));

-- Extend the existing athlete/creator code validator to canonical external Scouts.
create or replace function public.is_active_scout_code(code text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare n text:=regexp_replace(upper(coalesce(code,'')),'[^A-Z0-9]','','g');
begin
 if n='' then return false; end if;
 return exists(select 1 from public.scouts s join public.profiles p on p.id=s.profile_id
  where regexp_replace(upper(s.scout_code),'[^A-Z0-9]','','g')=n and s.status='approved' and p.role='scout' and p.status='approved')
 or exists(select 1 from public.athletes where regexp_replace(upper(coalesce(scout_code,'')),'[^A-Z0-9]','','g')=n
  and (scout_active or status='approved') and coalesce(status,'pending') not in ('blocked','deleted','rejected'))
 or exists(select 1 from public.founders where regexp_replace(upper(coalesce(scout_code,'')),'[^A-Z0-9]','','g')=n
  and (scout_active or status='approved') and coalesce(status,'pending') not in ('blocked','deleted','rejected'));
end; $$;
revoke all on function public.is_active_scout_code(text) from public;
grant execute on function public.is_active_scout_code(text) to anon,authenticated;
revoke all on function public.rois_current_scout_code(),public.register_external_scout(text,text),public.rois_external_scout_guard() from public,anon;
grant execute on function public.rois_current_scout_code(),public.register_external_scout(text,text) to authenticated;
commit;
