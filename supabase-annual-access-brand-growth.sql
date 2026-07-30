begin;

alter table if exists public.athletes
  add column if not exists annual numeric not null default 2500,
  add column if not exists annual_fee_required boolean not null default false,
  add column if not exists annual_fee_paid boolean not null default false,
  add column if not exists annual_payment_status text not null default 'not_requested',
  add column if not exists annual_payment_requested_at timestamptz,
  add column if not exists annual_access_started_at timestamptz,
  add column if not exists annual_access_expires_at timestamptz,
  add column if not exists marketplace_access_status text not null default 'locked',
  add column if not exists marketplace_access_requested_at timestamptz;

alter table if exists public.founders
  add column if not exists annual numeric not null default 2500,
  add column if not exists annual_fee_required boolean not null default false,
  add column if not exists annual_fee_paid boolean not null default false,
  add column if not exists annual_payment_status text not null default 'not_requested',
  add column if not exists annual_payment_requested_at timestamptz,
  add column if not exists annual_access_started_at timestamptz,
  add column if not exists annual_access_expires_at timestamptz,
  add column if not exists marketplace_access_status text not null default 'locked',
  add column if not exists marketplace_access_requested_at timestamptz;

-- Preserve the marketplace visibility of profiles that were already approved.
update public.athletes
set marketplace_access_status = 'active'
where status = 'approved'
  and visual_status = 'approved'
  and coalesce(marketplace_access_status, 'locked') = 'locked';

update public.founders
set marketplace_access_status = 'active'
where status = 'approved'
  and visual_status = 'approved'
  and coalesce(marketplace_access_status, 'locked') = 'locked';

create index if not exists athletes_marketplace_access_idx
  on public.athletes (marketplace_access_status, status, visual_status);

create index if not exists founders_marketplace_access_idx
  on public.founders (marketplace_access_status, status, visual_status);

create table if not exists public.brand_growth_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  objective text not null,
  brief text not null,
  deliverables text not null,
  start_date date,
  end_date date,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'closed')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.brand_growth_participants (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.brand_growth_campaigns(id) on delete cascade,
  profile_id uuid not null,
  profile_record_id uuid not null,
  profile_table text not null check (profile_table in ('athletes', 'founders')),
  email text not null,
  name text not null,
  positioning_score numeric not null default 0,
  participation_type text not null default 'pending'
    check (participation_type in ('pending', 'impulsor', 'crecimiento')),
  paired_with_id uuid,
  paired_with_name text,
  status text not null default 'joined'
    check (status in ('joined', 'matched', 'completed', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, profile_id)
);

create index if not exists brand_growth_campaign_status_idx
  on public.brand_growth_campaigns (status, created_at desc);

create index if not exists brand_growth_participant_campaign_idx
  on public.brand_growth_participants (campaign_id, positioning_score desc);

create index if not exists brand_growth_participant_profile_idx
  on public.brand_growth_participants (profile_id);

alter table public.brand_growth_campaigns enable row level security;
alter table public.brand_growth_participants enable row level security;

drop policy if exists "brand growth campaigns authenticated read" on public.brand_growth_campaigns;
create policy "brand growth campaigns authenticated read"
on public.brand_growth_campaigns for select
to authenticated
using (
  status = 'active'
  or exists (
    select 1 from public.profiles p
    where (p.id = auth.uid() or lower(p.email) = lower(auth.jwt() ->> 'email'))
      and p.role = 'admin'
  )
);

drop policy if exists "brand growth campaigns admin manage" on public.brand_growth_campaigns;
create policy "brand growth campaigns admin manage"
on public.brand_growth_campaigns for all
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where (p.id = auth.uid() or lower(p.email) = lower(auth.jwt() ->> 'email'))
      and p.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where (p.id = auth.uid() or lower(p.email) = lower(auth.jwt() ->> 'email'))
      and p.role = 'admin'
  )
);

drop policy if exists "brand growth participants own read" on public.brand_growth_participants;
create policy "brand growth participants own read"
on public.brand_growth_participants for select
to authenticated
using (
  profile_id = auth.uid()
  or lower(email) = lower(auth.jwt() ->> 'email')
  or exists (
    select 1 from public.profiles p
    where (p.id = auth.uid() or lower(p.email) = lower(auth.jwt() ->> 'email'))
      and p.role = 'admin'
  )
);

drop policy if exists "brand growth participants own insert" on public.brand_growth_participants;
create policy "brand growth participants own insert"
on public.brand_growth_participants for insert
to authenticated
with check (
  profile_id = auth.uid()
  or lower(email) = lower(auth.jwt() ->> 'email')
);

drop policy if exists "brand growth participants own update" on public.brand_growth_participants;
drop policy if exists "brand growth participants admin update" on public.brand_growth_participants;
create policy "brand growth participants admin update"
on public.brand_growth_participants for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where (p.id = auth.uid() or lower(p.email) = lower(auth.jwt() ->> 'email'))
      and p.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where (p.id = auth.uid() or lower(p.email) = lower(auth.jwt() ->> 'email'))
      and p.role = 'admin'
  )
);

commit;

-- Verification
select 'athletes' as source, marketplace_access_status, count(*)
from public.athletes
group by marketplace_access_status
union all
select 'founders' as source, marketplace_access_status, count(*)
from public.founders
group by marketplace_access_status;
