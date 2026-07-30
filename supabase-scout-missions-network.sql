-- ROIS Scout missions network
-- Additive migration. It preserves legacy referral codes and commissions.

create extension if not exists pgcrypto;

alter table public.user_profiles
  add column if not exists scout_code text,
  add column if not exists scout_active boolean not null default true;

update public.user_profiles up
set scout_code = coalesce(
  nullif(trim(a.scout_code), ''),
  nullif(trim(f.scout_code), ''),
  'ROIS-' || upper(substr(replace(up.id::text, '-', ''), 1, 8))
)
from public.profiles p
left join public.athletes a
  on a.profile_id = p.id
  or lower(coalesce(a.email, a.contact, '')) = lower(coalesce(p.email, ''))
left join public.founders f
  on f.profile_id = p.id
  or lower(coalesce(f.email, '')) = lower(coalesce(p.email, ''))
where up.profile_id = p.id
  and nullif(trim(up.scout_code), '') is null;

update public.user_profiles
set scout_code = 'ROIS-' || upper(substr(replace(id::text, '-', ''), 1, 8))
where nullif(trim(scout_code), '') is null;

with duplicated_codes as (
  select
    id,
    row_number() over (
      partition by lower(scout_code)
      order by created_at asc, id asc
    ) as duplicate_position
  from public.user_profiles
  where nullif(trim(scout_code), '') is not null
)
update public.user_profiles up
set scout_code = 'ROIS-' || upper(substr(replace(up.id::text, '-', ''), 1, 8))
from duplicated_codes duplicate
where duplicate.id = up.id
  and duplicate.duplicate_position > 1;

create unique index if not exists user_profiles_scout_code_unique
  on public.user_profiles (lower(scout_code))
  where scout_code is not null;

create or replace function public.rois_assign_universal_scout_code()
returns trigger
language plpgsql
as $$
begin
  if nullif(trim(new.scout_code), '') is null then
    new.scout_code := 'ROIS-' || upper(substr(replace(new.id::text, '-', ''), 1, 8));
  end if;
  return new;
end;
$$;

drop trigger if exists user_profiles_assign_scout_code on public.user_profiles;
create trigger user_profiles_assign_scout_code
before insert or update of scout_code on public.user_profiles
for each row execute function public.rois_assign_universal_scout_code();

alter table public.opportunities
  add column if not exists scout_enabled boolean not null default false,
  add column if not exists scout_reward_event text not null default 'qualified',
  add column if not exists scout_reward_amount numeric(14,2) not null default 0,
  add column if not exists scout_reward_currency text not null default 'MXN',
  add column if not exists scout_terms text,
  add column if not exists scout_requires_approval boolean not null default false;

create table if not exists public.mission_scouts (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  scout_code text not null,
  scout_public_name text not null default '',
  status text not null default 'active'
    check (status in ('pending', 'active', 'paused', 'rejected', 'removed')),
  joined_at timestamptz not null default now(),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (opportunity_id, user_profile_id)
);

create table if not exists public.scout_leads (
  id uuid primary key default gen_random_uuid(),
  mission_scout_id uuid not null references public.mission_scouts(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  scout_user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  scout_code text not null,
  prospect_type text not null default 'person',
  prospect_name text not null,
  prospect_email text,
  prospect_phone text,
  prospect_company text,
  country text,
  city text,
  industry text,
  consent boolean not null default false,
  consent_at timestamptz,
  notes text,
  company_notes text,
  economic_value numeric(14,2) not null default 0,
  status text not null default 'submitted'
    check (status in ('submitted', 'contacted', 'qualified', 'meeting', 'activated', 'rejected', 'duplicate', 'cancelled')),
  submitted_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scout_mission_commissions (
  id uuid primary key default gen_random_uuid(),
  mission_scout_id uuid not null references public.mission_scouts(id) on delete cascade,
  lead_id uuid not null unique references public.scout_leads(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  scout_code text not null,
  trigger_type text not null,
  gross_amount numeric(14,2) not null default 0,
  withholding_amount numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null default 0,
  currency text not null default 'MXN',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'paid', 'rejected', 'disputed')),
  estimated_payment_at timestamptz,
  approved_at timestamptz,
  paid_at timestamptz,
  payment_evidence_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mission_scouts_company_idx
  on public.mission_scouts (company_id, status, created_at desc);
create index if not exists mission_scouts_user_idx
  on public.mission_scouts (user_profile_id, status, created_at desc);
create index if not exists scout_leads_company_idx
  on public.scout_leads (company_id, status, created_at desc);
create index if not exists scout_leads_scout_idx
  on public.scout_leads (scout_user_profile_id, status, created_at desc);
create index if not exists scout_mission_commissions_company_idx
  on public.scout_mission_commissions (company_id, status, created_at desc);
create index if not exists scout_mission_commissions_user_idx
  on public.scout_mission_commissions (user_profile_id, status, created_at desc);
create unique index if not exists scout_leads_opportunity_email_unique
  on public.scout_leads (opportunity_id, lower(prospect_email))
  where nullif(trim(prospect_email), '') is not null and deleted_at is null;

create or replace function public.rois_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists mission_scouts_touch_updated_at on public.mission_scouts;
create trigger mission_scouts_touch_updated_at
before update on public.mission_scouts
for each row execute function public.rois_touch_updated_at();

drop trigger if exists scout_leads_touch_updated_at on public.scout_leads;
create trigger scout_leads_touch_updated_at
before update on public.scout_leads
for each row execute function public.rois_touch_updated_at();

drop trigger if exists scout_mission_commissions_touch_updated_at on public.scout_mission_commissions;
create trigger scout_mission_commissions_touch_updated_at
before update on public.scout_mission_commissions
for each row execute function public.rois_touch_updated_at();

create or replace function public.rois_protect_mission_scout_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.rois_is_admin() and (
    new.opportunity_id is distinct from old.opportunity_id
    or new.company_id is distinct from old.company_id
    or new.user_profile_id is distinct from old.user_profile_id
    or lower(new.scout_code) is distinct from lower(old.scout_code)
  ) then
    raise exception 'Mission Scout identity fields cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists mission_scouts_protect_identity on public.mission_scouts;
create trigger mission_scouts_protect_identity
before update on public.mission_scouts
for each row execute function public.rois_protect_mission_scout_identity();

create or replace function public.rois_protect_scout_lead_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.rois_is_admin() and (
    new.mission_scout_id is distinct from old.mission_scout_id
    or new.opportunity_id is distinct from old.opportunity_id
    or new.company_id is distinct from old.company_id
    or new.scout_user_profile_id is distinct from old.scout_user_profile_id
    or lower(new.scout_code) is distinct from lower(old.scout_code)
  ) then
    raise exception 'Scout lead identity fields cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists scout_leads_protect_identity on public.scout_leads;
create trigger scout_leads_protect_identity
before update on public.scout_leads
for each row execute function public.rois_protect_scout_lead_identity();

create or replace function public.rois_create_scout_mission_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mission public.mission_scouts%rowtype;
  opportunity public.opportunities%rowtype;
begin
  if new.deleted_at is not null then
    return new;
  end if;

  select * into mission
  from public.mission_scouts
  where id = new.mission_scout_id;

  select * into opportunity
  from public.opportunities
  where id = new.opportunity_id;

  if mission.status = 'active'
     and opportunity.scout_enabled = true
     and new.status = opportunity.scout_reward_event
     and opportunity.scout_reward_amount > 0 then
    insert into public.scout_mission_commissions (
      mission_scout_id,
      lead_id,
      opportunity_id,
      company_id,
      user_profile_id,
      scout_code,
      trigger_type,
      gross_amount,
      net_amount,
      currency,
      status
    ) values (
      mission.id,
      new.id,
      new.opportunity_id,
      new.company_id,
      mission.user_profile_id,
      mission.scout_code,
      opportunity.scout_reward_event,
      opportunity.scout_reward_amount,
      opportunity.scout_reward_amount,
      opportunity.scout_reward_currency,
      'pending'
    )
    on conflict (lead_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists scout_lead_create_commission on public.scout_leads;
create trigger scout_lead_create_commission
after insert or update of status on public.scout_leads
for each row execute function public.rois_create_scout_mission_commission();

alter table public.mission_scouts enable row level security;
alter table public.scout_leads enable row level security;
alter table public.scout_mission_commissions enable row level security;

drop policy if exists mission_scouts_read_own on public.mission_scouts;
create policy mission_scouts_read_own on public.mission_scouts
for select to authenticated
using (
  public.rois_is_admin()
  or company_id = public.rois_company_id()
  or exists (
    select 1 from public.user_profiles up
    where up.id = mission_scouts.user_profile_id
      and up.profile_id = auth.uid()
  )
);

drop policy if exists mission_scouts_join_own on public.mission_scouts;
create policy mission_scouts_join_own on public.mission_scouts
for insert to authenticated
with check (
  exists (
    select 1
    from public.user_profiles up
    join public.opportunities o on o.id = mission_scouts.opportunity_id
    where up.id = mission_scouts.user_profile_id
      and up.profile_id = auth.uid()
      and lower(up.scout_code) = lower(mission_scouts.scout_code)
      and up.scout_active = true
      and o.company_id = mission_scouts.company_id
      and o.status = 'published'
      and o.scout_enabled = true
      and mission_scouts.status = case
        when o.scout_requires_approval then 'pending'
        else 'active'
      end
  )
);

drop policy if exists mission_scouts_company_update on public.mission_scouts;
create policy mission_scouts_company_update on public.mission_scouts
for update to authenticated
using (public.rois_is_admin() or company_id = public.rois_company_id())
with check (public.rois_is_admin() or company_id = public.rois_company_id());

drop policy if exists scout_leads_read_authorized on public.scout_leads;
create policy scout_leads_read_authorized on public.scout_leads
for select to authenticated
using (
  public.rois_is_admin()
  or company_id = public.rois_company_id()
  or exists (
    select 1 from public.user_profiles up
    where up.id = scout_leads.scout_user_profile_id
      and up.profile_id = auth.uid()
  )
);

drop policy if exists scout_leads_create_own on public.scout_leads;
create policy scout_leads_create_own on public.scout_leads
for insert to authenticated
with check (
  consent = true
  and exists (
    select 1
    from public.mission_scouts ms
    join public.user_profiles up on up.id = ms.user_profile_id
    where ms.id = scout_leads.mission_scout_id
      and ms.opportunity_id = scout_leads.opportunity_id
      and ms.company_id = scout_leads.company_id
      and ms.user_profile_id = scout_leads.scout_user_profile_id
      and lower(ms.scout_code) = lower(scout_leads.scout_code)
      and ms.status = 'active'
      and up.profile_id = auth.uid()
  )
);

drop policy if exists scout_leads_company_update on public.scout_leads;
create policy scout_leads_company_update on public.scout_leads
for update to authenticated
using (public.rois_is_admin() or company_id = public.rois_company_id())
with check (public.rois_is_admin() or company_id = public.rois_company_id());

drop policy if exists scout_commissions_read_authorized on public.scout_mission_commissions;
create policy scout_commissions_read_authorized on public.scout_mission_commissions
for select to authenticated
using (
  public.rois_is_admin()
  or company_id = public.rois_company_id()
  or exists (
    select 1 from public.user_profiles up
    where up.id = scout_mission_commissions.user_profile_id
      and up.profile_id = auth.uid()
  )
);

drop policy if exists scout_commissions_admin_update on public.scout_mission_commissions;
create policy scout_commissions_admin_update on public.scout_mission_commissions
for update to authenticated
using (public.rois_is_admin())
with check (public.rois_is_admin());

grant select, insert, update on public.mission_scouts to authenticated;
grant select, insert, update on public.scout_leads to authenticated;
grant select, update on public.scout_mission_commissions to authenticated;

-- Verification summary.
select
  (select count(*) from public.user_profiles where scout_code is not null) as universal_scout_codes,
  (select count(*) from public.opportunities where scout_enabled = true) as scout_missions,
  (select count(*) from public.mission_scouts) as mission_memberships,
  (select count(*) from public.scout_leads) as registered_leads;
