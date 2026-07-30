begin;

-- Audience is stored per network so eligibility does not depend on estimates.
alter table if exists public.athletes
  add column if not exists instagram_followers bigint not null default 0,
  add column if not exists tiktok_followers bigint not null default 0,
  add column if not exists facebook_followers bigint not null default 0,
  add column if not exists linkedin_followers bigint not null default 0;

alter table if exists public.founders
  add column if not exists instagram_followers bigint not null default 0,
  add column if not exists tiktok_followers bigint not null default 0,
  add column if not exists facebook_followers bigint not null default 0,
  add column if not exists linkedin_followers bigint not null default 0;

-- These fields extend the existing Impulso de marca tables without replacing data.
alter table if exists public.brand_growth_participants
  add column if not exists primary_network text,
  add column if not exists follower_count bigint not null default 0,
  add column if not exists collaboration_type text,
  add column if not exists deliverable_count integer not null default 1,
  add column if not exists usage_days integer not null default 0,
  add column if not exists exclusivity_days integer not null default 0,
  add column if not exists quote_min numeric,
  add column if not exists quote_recommended numeric,
  add column if not exists quote_max numeric,
  add column if not exists agreed_amount numeric,
  add column if not exists currency text not null default 'MXN',
  add column if not exists quote_status text not null default 'not_started',
  add column if not exists collaboration_notes text;

create index if not exists athletes_social_audience_idx
  on public.athletes (
    greatest(instagram_followers, tiktok_followers, facebook_followers, linkedin_followers)
  );

create index if not exists founders_social_audience_idx
  on public.founders (
    greatest(instagram_followers, tiktok_followers, facebook_followers, linkedin_followers)
  );

create index if not exists brand_growth_participant_audience_idx
  on public.brand_growth_participants (campaign_id, follower_count desc);

-- A participant can read their own row and the row paired directly with them.
-- This exposes only the collaboration counterpart, not the rest of the campaign.
drop policy if exists "brand growth participants own read" on public.brand_growth_participants;
create policy "brand growth participants own read"
on public.brand_growth_participants for select
to authenticated
using (
  profile_id = auth.uid()
  or lower(email) = lower(auth.jwt() ->> 'email')
  or paired_with_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.id = paired_with_id
      and lower(p.email) = lower(auth.jwt() ->> 'email')
  )
  or exists (
    select 1
    from public.profiles p
    where (p.id = auth.uid() or lower(p.email) = lower(auth.jwt() ->> 'email'))
      and p.role = 'admin'
  )
);

-- Participants can quote only their own collaborations. Admin retains moderation.
drop policy if exists "brand growth participants own update" on public.brand_growth_participants;
drop policy if exists "brand growth participants admin update" on public.brand_growth_participants;
drop policy if exists "brand growth participants own or admin update" on public.brand_growth_participants;
create policy "brand growth participants own or admin update"
on public.brand_growth_participants for update
to authenticated
using (
  profile_id = auth.uid()
  or lower(email) = lower(auth.jwt() ->> 'email')
  or exists (
    select 1
    from public.profiles p
    where (p.id = auth.uid() or lower(p.email) = lower(auth.jwt() ->> 'email'))
      and p.role = 'admin'
  )
)
with check (
  profile_id = auth.uid()
  or lower(email) = lower(auth.jwt() ->> 'email')
  or exists (
    select 1
    from public.profiles p
    where (p.id = auth.uid() or lower(p.email) = lower(auth.jwt() ->> 'email'))
      and p.role = 'admin'
  )
);

commit;

-- Operational verification. This does not modify data.
select
  profile_table,
  participation_type,
  quote_status,
  count(*) as participants
from public.brand_growth_participants
group by profile_table, participation_type, quote_status
order by profile_table, participation_type, quote_status;
