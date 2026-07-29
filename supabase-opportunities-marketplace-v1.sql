-- ROIS managed opportunities marketplace v1
-- Additive and idempotent. It does not delete or rename legacy ROIS tables.

create extension if not exists pgcrypto;

create or replace function public.rois_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role, '')) = 'admin'
      and lower(coalesce(p.status, 'approved')) = 'approved'
  );
$$;

create or replace function public.rois_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
  from public.companies c
  where c.profile_id = auth.uid()
     or lower(coalesce(c.contact, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  order by (c.profile_id = auth.uid()) desc
  limit 1;
$$;

create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique,
  legacy_athlete_id uuid,
  legacy_founder_id uuid,
  email text not null,
  name text not null,
  public_name text,
  image_url text,
  bio text,
  city text,
  state_region text,
  country text default 'Mexico',
  birth_date date,
  age_range text,
  languages text[] not null default '{}',
  availability text default 'available',
  capabilities text[] not null default '{}',
  interests text[] not null default '{}',
  industries text[] not null default '{}',
  territories text[] not null default '{}',
  sales_experience text,
  audience_size bigint not null default 0,
  audience_description text,
  travel_availability boolean not null default false,
  can_invoice boolean not null default false,
  badges text[] not null default '{}',
  verification_status text not null default 'unverified',
  status text not null default 'approved',
  visual_status text not null default 'approved',
  opportunities_completed integer not null default 0,
  sales_generated numeric(14,2) not null default 0,
  validated_leads integer not null default 0,
  average_rating numeric(4,2) not null default 0,
  completion_rate numeric(5,2) not null default 0,
  average_response_hours numeric(10,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Compatibility for databases that ran an earlier draft of this migration.
alter table public.user_profiles add column if not exists name text;
alter table public.user_profiles add column if not exists public_name text;
alter table public.user_profiles add column if not exists image_url text;
alter table public.user_profiles add column if not exists birth_date date;
alter table public.user_profiles add column if not exists industries text[] not null default '{}';
alter table public.user_profiles add column if not exists sales_experience text;
alter table public.user_profiles add column if not exists audience_description text;
alter table public.user_profiles add column if not exists travel_availability boolean not null default false;

update public.user_profiles
set
  name = coalesce(nullif(name, ''), nullif(to_jsonb(user_profiles) ->> 'display_name', ''), split_part(email, '@', 1)),
  public_name = coalesce(nullif(public_name, ''), nullif(to_jsonb(user_profiles) ->> 'display_name', ''), name),
  image_url = coalesce(nullif(image_url, ''), nullif(to_jsonb(user_profiles) ->> 'avatar_url', '')),
  industries = case
    when cardinality(industries) > 0 then industries
    when jsonb_typeof(to_jsonb(user_profiles) -> 'known_industries') = 'array'
      then array(select jsonb_array_elements_text(to_jsonb(user_profiles) -> 'known_industries'))
    else '{}'::text[]
  end,
  sales_experience = coalesce(sales_experience, to_jsonb(user_profiles) ->> 'commercial_experience'),
  audience_description = coalesce(audience_description, to_jsonb(user_profiles) ->> 'audience_type'),
  travel_availability = coalesce(
    travel_availability,
    nullif(to_jsonb(user_profiles) ->> 'travel_available', '')::boolean,
    false
  )
where name is null
   or public_name is null
   or image_url is null
   or cardinality(industries) = 0
   or sales_experience is null
   or audience_description is null;

alter table public.user_profiles alter column name set not null;

create unique index if not exists user_profiles_email_unique
  on public.user_profiles (lower(email)) where deleted_at is null;
create index if not exists user_profiles_capabilities_gin
  on public.user_profiles using gin (capabilities);
create index if not exists user_profiles_location_idx
  on public.user_profiles (country, state_region, city);

create table if not exists public.user_social_accounts (
  id uuid primary key default gen_random_uuid(),
  user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  platform text not null,
  url text not null,
  handle text,
  audience_size bigint not null default 0,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_profile_id, platform)
);

create table if not exists public.company_verifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  legal_name text,
  tax_id text,
  representative_name text,
  corporate_email text,
  website text,
  billing_data jsonb not null default '{}'::jsonb,
  document_paths jsonb not null default '[]'::jsonb,
  status text not null default 'pending',
  reviewed_by uuid,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_plan_definitions (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null unique,
  name text not null,
  description text,
  monthly_price numeric(12,2),
  annual_price numeric(12,2),
  transaction_fee_rate numeric(6,3) not null default 0,
  active_opportunity_limit integer not null default 1,
  features jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.company_plan_definitions
  (plan_key, name, description, active_opportunity_limit, features, sort_order)
values
  ('basic', 'Empresa basica', 'Perfil corporativo y una oportunidad activa.', 1, '{"analytics":"basic","applicant_access":"limited"}', 1),
  ('advanced', 'Empresa avanzada', 'Segmentacion, analitica de campanas y oportunidades destacadas.', 10, '{"analytics":"campaign","segments":true,"exports":"limited"}', 2),
  ('corporate', 'Empresa corporativa', 'Campanas administradas, inteligencia personalizada e integraciones.', 100, '{"analytics":"executive","custom_segments":true,"team":true,"integrations":true}', 3)
on conflict (plan_key) do nothing;

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid not null,
  title text not null,
  description text not null,
  opportunity_type text not null,
  category text not null,
  industry text,
  objective text,
  desired_profile text,
  territory text,
  location text,
  modality text not null default 'remote',
  starts_at timestamptz,
  closes_at timestamptz,
  slots integer,
  compensation_type text not null default 'commission',
  compensation_amount numeric(14,2),
  commission_rate numeric(7,3),
  margin_amount numeric(14,2),
  wholesale_price numeric(14,2),
  suggested_price numeric(14,2),
  minimum_purchase numeric(14,2),
  purchase_required boolean not null default false,
  inventory_available integer,
  delivery_method text,
  return_policy text,
  deliverables text,
  acceptance_criteria text,
  attribution_rules text,
  payment_terms text,
  requested_data_fields text[] not null default '{name,email,city,country,capabilities}',
  materials jsonb not null default '[]'::jsonb,
  legal_documents jsonb not null default '[]'::jsonb,
  status text not null default 'draft',
  moderation_notes text,
  approved_by uuid,
  approved_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint opportunities_type_check check (opportunity_type in ('sell','refer','create','collaborate')),
  constraint opportunities_status_check check (status in ('draft','in_review','published','paused','closed','rejected','cancelled'))
);

create index if not exists opportunities_public_feed_idx
  on public.opportunities (status, published_at desc, closes_at);
create index if not exists opportunities_company_idx
  on public.opportunities (company_id, created_at desc);
create index if not exists opportunities_filters_idx
  on public.opportunities (opportunity_type, category, industry, modality);

create table if not exists public.opportunity_applications (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  applicant_profile_id uuid not null,
  message text,
  shared_profile_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'submitted',
  company_notes text,
  requested_information text,
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(opportunity_id, user_profile_id),
  constraint applications_status_check check (status in (
    'submitted','information_requested','accepted','rejected','in_execution',
    'result_submitted','result_validated','commission_pending','commission_paid',
    'completed','cancelled','disputed'
  ))
);

create index if not exists applications_user_idx
  on public.opportunity_applications (applicant_profile_id, created_at desc);
create index if not exists applications_opportunity_idx
  on public.opportunity_applications (opportunity_id, status, created_at desc);

create or replace function public.rois_protect_application_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.rois_is_admin() and (
    new.opportunity_id is distinct from old.opportunity_id
    or new.user_profile_id is distinct from old.user_profile_id
    or new.applicant_profile_id is distinct from old.applicant_profile_id
    or new.message is distinct from old.message
    or new.shared_profile_snapshot is distinct from old.shared_profile_snapshot
    or new.submitted_at is distinct from old.submitted_at
  ) then
    raise exception 'Application identity and authorized snapshot are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists opportunity_applications_identity_guard on public.opportunity_applications;
create trigger opportunity_applications_identity_guard
before update on public.opportunity_applications
for each row execute function public.rois_protect_application_identity();

create table if not exists public.application_consents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.opportunity_applications(id) on delete cascade,
  user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete cascade,
  purpose text not null,
  authorized_fields text[] not null,
  requested_fields text[] not null default '{}',
  granted boolean not null default true,
  privacy_notice_version text not null default 'opportunities-v1',
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.application_consents add column if not exists opportunity_id uuid references public.opportunities(id) on delete cascade;
alter table public.application_consents add column if not exists requested_fields text[] not null default '{}';
alter table public.application_consents add column if not exists granted boolean not null default true;

create table if not exists public.participations (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.opportunity_applications(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  instructions text,
  materials jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tracking_links (
  id uuid primary key default gen_random_uuid(),
  participation_id uuid not null references public.participations(id) on delete cascade,
  user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  code text not null unique,
  destination_url text,
  clicks bigint not null default 0,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists public.conversions (
  id uuid primary key default gen_random_uuid(),
  participation_id uuid not null references public.participations(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  conversion_type text not null,
  economic_value numeric(14,2) not null default 0,
  commission_amount numeric(14,2) not null default 0,
  evidence jsonb not null default '[]'::jsonb,
  validation_status text not null default 'pending',
  estimated_payment_at timestamptz,
  validated_at timestamptz,
  validated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commissions (
  id uuid primary key default gen_random_uuid(),
  conversion_id uuid not null unique references public.conversions(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  user_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  gross_amount numeric(14,2) not null default 0,
  withholding_amount numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null default 0,
  status text not null default 'pending',
  estimated_payment_at timestamptz,
  paid_at timestamptz,
  payment_evidence_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commissions_user_idx
  on public.commissions (user_profile_id, status, created_at desc);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  participation_id uuid not null references public.participations(id) on delete cascade,
  reviewer_profile_id uuid not null,
  reviewed_profile_id uuid,
  reviewed_company_id uuid,
  rating integer not null check (rating between 1 and 5),
  comment text,
  status text not null default 'published',
  created_at timestamptz not null default now()
);

create table if not exists public.disputes (
  id uuid primary key default gen_random_uuid(),
  participation_id uuid references public.participations(id) on delete set null,
  application_id uuid references public.opportunity_applications(id) on delete set null,
  opened_by uuid not null,
  reason text not null,
  details text,
  evidence jsonb not null default '[]'::jsonb,
  status text not null default 'open',
  resolution text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.privacy_consents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  consent_type text not null,
  purpose text not null,
  scope jsonb not null default '{}'::jsonb,
  recipient_company_id uuid references public.companies(id) on delete set null,
  version text not null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.data_subject_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  request_type text not null,
  details text,
  status text not null default 'submitted',
  response_notes text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.data_access_logs (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid,
  company_id uuid references public.companies(id) on delete set null,
  subject_profile_id uuid,
  application_id uuid references public.opportunity_applications(id) on delete set null,
  purpose text not null,
  fields_accessed text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid,
  company_id uuid,
  event_name text not null,
  entity_type text,
  entity_id uuid,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_name_time_idx
  on public.analytics_events (event_name, created_at desc);

-- Backfill specialized profiles without changing their legacy records.
insert into public.user_profiles
  (profile_id, legacy_founder_id, email, name, public_name, image_url, bio, city,
   capabilities, industries, audience_size, badges, verification_status,
   status, visual_status, created_at)
select
  f.profile_id, f.id, lower(f.email), coalesce(nullif(f.public_name, ''), f.name),
  coalesce(nullif(f.public_name, ''), f.name),
  f.image_url, f.stats, f.city,
  array_remove(array['content_creation','recommendation','brand_representation',
    case when lower(coalesce(f.creator_type, '')) = 'founder' then 'entrepreneurship' end], null),
  case when nullif(f.industry, '') is null then '{}'::text[] else array[f.industry] end,
  coalesce(f.audience_size, 0), array['creator'], 'legacy_verified',
  coalesce(f.status, 'approved'), coalesce(f.visual_status, 'approved'),
  coalesce(f.created_at, now())
from public.founders f
where f.profile_id is not null and nullif(trim(f.email), '') is not null
on conflict (profile_id) do update set
  legacy_founder_id = excluded.legacy_founder_id,
  name = excluded.name,
  public_name = excluded.public_name,
  image_url = coalesce(excluded.image_url, public.user_profiles.image_url),
  badges = array(select distinct unnest(public.user_profiles.badges || excluded.badges)),
  updated_at = now();

insert into public.user_profiles
  (profile_id, legacy_athlete_id, email, name, public_name, image_url, bio, city,
   capabilities, industries, badges, verification_status,
   status, visual_status, created_at)
select
  a.profile_id, a.id, lower(coalesce(a.email, a.contact)), a.name, a.name,
  a.image_url, a.stats, a.location,
  array['sports','brand_representation','appearances'],
  case when nullif(a.sport, '') is null then '{}'::text[] else array[a.sport] end,
  array['athlete'], 'legacy_verified',
  coalesce(a.status, 'approved'), coalesce(a.visual_status, 'approved'),
  coalesce(a.created_at, now())
from public.athletes a
where a.profile_id is not null
  and nullif(trim(coalesce(a.email, a.contact, '')), '') is not null
on conflict (profile_id) do update set
  legacy_athlete_id = excluded.legacy_athlete_id,
  name = excluded.name,
  public_name = excluded.public_name,
  image_url = coalesce(excluded.image_url, public.user_profiles.image_url),
  badges = array(select distinct unnest(public.user_profiles.badges || excluded.badges)),
  updated_at = now();

alter table public.user_profiles enable row level security;
alter table public.user_social_accounts enable row level security;
alter table public.company_verifications enable row level security;
alter table public.company_plan_definitions enable row level security;
alter table public.opportunities enable row level security;
alter table public.opportunity_applications enable row level security;
alter table public.application_consents enable row level security;
alter table public.participations enable row level security;
alter table public.tracking_links enable row level security;
alter table public.conversions enable row level security;
alter table public.commissions enable row level security;
alter table public.reviews enable row level security;
alter table public.disputes enable row level security;
alter table public.privacy_consents enable row level security;
alter table public.data_subject_requests enable row level security;
alter table public.data_access_logs enable row level security;
alter table public.analytics_events enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'user_profiles','user_social_accounts','company_verifications',
    'company_plan_definitions','opportunities','opportunity_applications',
    'application_consents','participations','tracking_links','conversions',
    'commissions','reviews','disputes','privacy_consents',
    'data_subject_requests','data_access_logs','analytics_events'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.rois_is_admin()) with check (public.rois_is_admin())',
      t || '_admin_all', t
    );
  end loop;
end $$;

drop policy if exists user_profiles_owner on public.user_profiles;
create policy user_profiles_owner on public.user_profiles
  for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

drop policy if exists user_profiles_authorized_company_read on public.user_profiles;
-- Companies consume only opportunity_applications.shared_profile_snapshot,
-- which is built from the fields explicitly authorized for that application.

drop policy if exists user_social_accounts_owner on public.user_social_accounts;
create policy user_social_accounts_owner on public.user_social_accounts
  for all to authenticated
  using (exists (
    select 1 from public.user_profiles u
    where u.id = user_social_accounts.user_profile_id and u.profile_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.user_profiles u
    where u.id = user_social_accounts.user_profile_id and u.profile_id = auth.uid()
  ));

drop policy if exists company_verifications_owner on public.company_verifications;
drop policy if exists company_verifications_owner_read on public.company_verifications;
create policy company_verifications_owner_read on public.company_verifications
  for select to authenticated
  using (company_id = public.rois_company_id());

drop policy if exists company_verifications_owner_insert on public.company_verifications;
create policy company_verifications_owner_insert on public.company_verifications
  for insert to authenticated
  with check (company_id = public.rois_company_id() and status = 'pending');

drop policy if exists company_verifications_owner_update on public.company_verifications;
create policy company_verifications_owner_update on public.company_verifications
  for update to authenticated
  using (
    company_id = public.rois_company_id()
    and status in ('pending', 'rejected')
  )
  with check (company_id = public.rois_company_id() and status = 'pending');

drop policy if exists company_plan_definitions_read on public.company_plan_definitions;
create policy company_plan_definitions_read on public.company_plan_definitions
  for select to authenticated using (status = 'active');

drop policy if exists opportunities_public_read on public.opportunities;
create policy opportunities_public_read on public.opportunities
  for select to authenticated
  using (status = 'published' and deleted_at is null);

drop policy if exists opportunities_company_owner on public.opportunities;
drop policy if exists opportunities_company_owner_read on public.opportunities;
create policy opportunities_company_owner_read on public.opportunities
  for select to authenticated
  using (company_id = public.rois_company_id());

drop policy if exists opportunities_company_owner_insert on public.opportunities;
create policy opportunities_company_owner_insert on public.opportunities
  for insert to authenticated
  with check (
    company_id = public.rois_company_id()
    and created_by = auth.uid()
    and status in ('draft', 'in_review')
  );

drop policy if exists opportunities_company_owner_update on public.opportunities;
create policy opportunities_company_owner_update on public.opportunities
  for update to authenticated
  using (
    company_id = public.rois_company_id()
    and status in ('draft', 'in_review', 'rejected')
  )
  with check (
    company_id = public.rois_company_id()
    and created_by = auth.uid()
    and status in ('draft', 'in_review')
  );

drop policy if exists applications_applicant on public.opportunity_applications;
drop policy if exists applications_applicant_read on public.opportunity_applications;
create policy applications_applicant_read on public.opportunity_applications
  for select to authenticated
  using (applicant_profile_id = auth.uid());

drop policy if exists applications_applicant_insert on public.opportunity_applications;
create policy applications_applicant_insert on public.opportunity_applications
  for insert to authenticated
  with check (
    applicant_profile_id = auth.uid()
    and status = 'submitted'
    and exists (
      select 1
      from public.user_profiles u
      where u.id = opportunity_applications.user_profile_id
        and u.profile_id = auth.uid()
        and u.deleted_at is null
    )
    and exists (
      select 1
      from public.opportunities o
      where o.id = opportunity_applications.opportunity_id
        and o.status = 'published'
        and (o.closes_at is null or o.closes_at >= current_date)
    )
  );

drop policy if exists applications_applicant_cancel on public.opportunity_applications;
create policy applications_applicant_cancel on public.opportunity_applications
  for update to authenticated
  using (applicant_profile_id = auth.uid())
  with check (
    applicant_profile_id = auth.uid()
    and status = 'cancelled'
    and exists (
      select 1 from public.user_profiles u
      where u.id = opportunity_applications.user_profile_id and u.profile_id = auth.uid()
    )
  );

drop policy if exists applications_company_read on public.opportunity_applications;
create policy applications_company_read on public.opportunity_applications
  for select to authenticated
  using (exists (
    select 1 from public.opportunities o
    join public.company_verifications v on v.company_id = o.company_id
    join public.application_consents consent
      on consent.application_id = opportunity_applications.id
      and consent.company_id = o.company_id
      and consent.granted = true
      and consent.revoked_at is null
    where o.id = opportunity_applications.opportunity_id
      and o.company_id = public.rois_company_id()
      and v.status = 'approved'
  ));

drop policy if exists applications_company_update on public.opportunity_applications;
create policy applications_company_update on public.opportunity_applications
  for update to authenticated
  using (exists (
    select 1 from public.opportunities o
    join public.company_verifications v on v.company_id = o.company_id
    join public.application_consents consent
      on consent.application_id = opportunity_applications.id
      and consent.company_id = o.company_id
      and consent.granted = true
      and consent.revoked_at is null
    where o.id = opportunity_applications.opportunity_id
      and o.company_id = public.rois_company_id()
      and v.status = 'approved'
  ))
  with check (exists (
    select 1 from public.opportunities o
    join public.company_verifications v on v.company_id = o.company_id
    join public.application_consents consent
      on consent.application_id = opportunity_applications.id
      and consent.company_id = o.company_id
      and consent.granted = true
      and consent.revoked_at is null
    where o.id = opportunity_applications.opportunity_id
      and o.company_id = public.rois_company_id()
      and v.status = 'approved'
  ) and status in (
    'information_requested','accepted','rejected','in_execution',
    'result_validated','completed','cancelled','disputed'
  ));

drop policy if exists consents_owner on public.application_consents;
create policy consents_owner on public.application_consents
  for all to authenticated
  using (exists (
    select 1 from public.user_profiles u
    where u.id = application_consents.user_profile_id and u.profile_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.user_profiles u
    where u.id = application_consents.user_profile_id and u.profile_id = auth.uid()
  ));

drop policy if exists consents_company_read on public.application_consents;
create policy consents_company_read on public.application_consents
  for select to authenticated
  using (company_id = public.rois_company_id() and revoked_at is null);

drop policy if exists participations_parties on public.participations;
create policy participations_parties on public.participations
  for select to authenticated
  using (
    company_id = public.rois_company_id()
    or exists (select 1 from public.user_profiles u where u.id = participations.user_profile_id and u.profile_id = auth.uid())
  );

drop policy if exists participations_company_insert on public.participations;
create policy participations_company_insert on public.participations
  for insert to authenticated
  with check (
    company_id = public.rois_company_id()
    and exists (
      select 1
      from public.opportunity_applications a
      join public.opportunities o on o.id = a.opportunity_id
      join public.company_verifications v on v.company_id = o.company_id
      join public.application_consents consent
        on consent.application_id = a.id
        and consent.company_id = o.company_id
        and consent.granted = true
        and consent.revoked_at is null
      where a.id = participations.application_id
        and a.opportunity_id = participations.opportunity_id
        and a.user_profile_id = participations.user_profile_id
        and a.status = 'accepted'
        and o.company_id = public.rois_company_id()
        and v.status = 'approved'
    )
  );

drop policy if exists tracking_links_owner_read on public.tracking_links;
create policy tracking_links_owner_read on public.tracking_links
  for select to authenticated
  using (exists (select 1 from public.user_profiles u where u.id = tracking_links.user_profile_id and u.profile_id = auth.uid()));

drop policy if exists conversions_parties_read on public.conversions;
create policy conversions_parties_read on public.conversions
  for select to authenticated
  using (
    company_id = public.rois_company_id()
    or exists (select 1 from public.user_profiles u where u.id = conversions.user_profile_id and u.profile_id = auth.uid())
  );

drop policy if exists commissions_owner_read on public.commissions;
create policy commissions_owner_read on public.commissions
  for select to authenticated
  using (exists (select 1 from public.user_profiles u where u.id = commissions.user_profile_id and u.profile_id = auth.uid()));

drop policy if exists reviews_participant_insert on public.reviews;
create policy reviews_participant_insert on public.reviews
  for insert to authenticated
  with check (exists (
    select 1 from public.user_profiles u
    where u.id = reviews.reviewer_profile_id and u.profile_id = auth.uid()
  ));

drop policy if exists reviews_read on public.reviews;
create policy reviews_read on public.reviews
  for select to authenticated using (status = 'published');

drop policy if exists disputes_owner on public.disputes;
create policy disputes_owner on public.disputes
  for insert to authenticated with check (opened_by = auth.uid());
drop policy if exists disputes_owner_read on public.disputes;
create policy disputes_owner_read on public.disputes
  for select to authenticated using (opened_by = auth.uid());

drop policy if exists privacy_consents_owner on public.privacy_consents;
create policy privacy_consents_owner on public.privacy_consents
  for all to authenticated
  using (exists (select 1 from public.user_profiles u where u.id = privacy_consents.profile_id and u.profile_id = auth.uid()))
  with check (exists (select 1 from public.user_profiles u where u.id = privacy_consents.profile_id and u.profile_id = auth.uid()));

drop policy if exists data_subject_requests_owner on public.data_subject_requests;
create policy data_subject_requests_owner on public.data_subject_requests
  for all to authenticated
  using (exists (select 1 from public.user_profiles u where u.id = data_subject_requests.profile_id and u.profile_id = auth.uid()))
  with check (exists (select 1 from public.user_profiles u where u.id = data_subject_requests.profile_id and u.profile_id = auth.uid()));

drop policy if exists analytics_events_own_insert on public.analytics_events;
create policy analytics_events_own_insert on public.analytics_events
  for insert to authenticated
  with check (
    (profile_id is not null or company_id is not null)
    and (
      profile_id is null
      or exists (
        select 1
        from public.user_profiles u
        where u.id = analytics_events.profile_id
          and u.profile_id = auth.uid()
      )
    )
    and (
      company_id is null
      or company_id = public.rois_company_id()
    )
  );

grant execute on function public.rois_is_admin() to authenticated;
grant execute on function public.rois_company_id() to authenticated;

-- Operational verification.
select 'user_profiles' as entity, count(*) as rows from public.user_profiles
union all select 'opportunities', count(*) from public.opportunities
union all select 'applications', count(*) from public.opportunity_applications
union all select 'commissions', count(*) from public.commissions;
