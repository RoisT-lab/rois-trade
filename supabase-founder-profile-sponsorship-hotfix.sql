-- ROIS Founder profile persistence + sponsorship links hotfix
-- Run once in Supabase SQL Editor. This script does not delete data.

begin;

alter table public.founders add column if not exists ranking text;
alter table public.founders add column if not exists image_url text;
alter table public.founders add column if not exists image_path text;
alter table public.founders add column if not exists image_name text;
alter table public.founders add column if not exists image_mime text;
alter table public.founders add column if not exists proposal_url text;
alter table public.founders add column if not exists proposal_path text;
alter table public.founders add column if not exists proposal_name text;
alter table public.founders add column if not exists proposal_mime text;
alter table public.founders add column if not exists video_url text;
alter table public.founders add column if not exists instagram_url text;
alter table public.founders add column if not exists tiktok_url text;
alter table public.founders add column if not exists facebook_url text;
alter table public.founders add column if not exists linkedin_url text;
alter table public.founders add column if not exists sponsor_payment_url text;
alter table public.founders add column if not exists sponsor_terms text;
alter table public.founders add column if not exists sponsor_logos text;
alter table public.founders add column if not exists terms_accepted boolean not null default false;
alter table public.founders add column if not exists updated_at timestamptz default now();

create index if not exists founders_profile_id_idx on public.founders (profile_id);
create index if not exists founders_email_lower_idx on public.founders (lower(email));

alter table public.founders enable row level security;

drop policy if exists "founders read approved" on public.founders;
create policy "founders read approved"
on public.founders
for select
using (
  (status = 'approved' and visual_status = 'approved')
  or profile_id = auth.uid()
  or lower(email) = lower(auth.jwt() ->> 'email')
  or is_admin()
);

drop policy if exists "founders self insert" on public.founders;
create policy "founders self insert"
on public.founders
for insert
to authenticated
with check (
  profile_id = auth.uid()
  or lower(email) = lower(auth.jwt() ->> 'email')
  or is_admin()
);

drop policy if exists "founders self update" on public.founders;
create policy "founders self update"
on public.founders
for update
to authenticated
using (
  profile_id = auth.uid()
  or lower(email) = lower(auth.jwt() ->> 'email')
  or is_admin()
)
with check (
  profile_id = auth.uid()
  or lower(email) = lower(auth.jwt() ->> 'email')
  or is_admin()
);

commit;

select
  id,
  profile_id,
  email,
  name,
  venture_name,
  industry,
  stage,
  city,
  sponsor_payment_url,
  status,
  visual_status
from public.founders
order by created_at desc;
