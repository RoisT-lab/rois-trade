-- ROIS profile persistence + Storage migration
-- Run once in Supabase SQL Editor. This migration does not delete profile data.

begin;

create table if not exists public.founders (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid,
  email text unique not null,
  name text not null,
  venture_name text,
  industry text,
  stage text,
  city text,
  stats text,
  monthly numeric default 2500,
  max_sponsors numeric default 10,
  scout_code text,
  scout_active boolean default false,
  invited_by_scout_code text,
  scout_validation_status text default 'pending',
  scout_commission_status text default 'pending',
  status text default 'approved',
  visual_status text default 'approved',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.athletes add column if not exists image_path text;
alter table public.athletes add column if not exists image_name text;
alter table public.athletes add column if not exists image_mime text;
alter table public.athletes add column if not exists proposal_path text;
alter table public.athletes add column if not exists proposal_mime text;
alter table public.athletes add column if not exists instagram_url text;
alter table public.athletes add column if not exists tiktok_url text;
alter table public.athletes add column if not exists facebook_url text;
alter table public.athletes add column if not exists linkedin_url text;
alter table public.athletes add column if not exists updated_at timestamptz default now();

alter table public.founders add column if not exists ranking text;
alter table public.founders add column if not exists creator_type text default 'founder';
alter table public.founders add column if not exists public_name text;
alter table public.founders add column if not exists content_categories text;
alter table public.founders add column if not exists primary_platform text;
alter table public.founders add column if not exists audience_size bigint default 0;
alter table public.founders add column if not exists engagement_rate numeric(7, 3) default 0;
alter table public.founders add column if not exists audience_location text;
alter table public.founders add column if not exists audience_demographics text;
alter table public.founders add column if not exists brand_categories text;
alter table public.founders add column if not exists past_collaborations text;
alter table public.founders add column if not exists deliverables text;
alter table public.founders add column if not exists availability text default 'available';
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
alter table public.founders add column if not exists invited_by_scout_code text;
alter table public.founders add column if not exists scout_validation_status text default 'pending';
alter table public.founders add column if not exists scout_commission_status text default 'pending';
alter table public.founders add column if not exists updated_at timestamptz default now();

create index if not exists athletes_profile_id_idx on public.athletes (profile_id);
create index if not exists athletes_email_lower_idx on public.athletes (lower(email));
create index if not exists athletes_contact_lower_idx on public.athletes (lower(contact));
create index if not exists founders_profile_id_idx on public.founders (profile_id);
create index if not exists founders_email_lower_idx on public.founders (lower(email));

alter table public.founders enable row level security;

drop policy if exists "profiles self insert client" on public.profiles;
drop policy if exists "profiles self insert roles" on public.profiles;
create policy "profiles self insert roles"
on public.profiles
for insert
to authenticated
with check (
  id = auth.uid()
  and lower(email) = lower(auth.jwt() ->> 'email')
  and role in ('client', 'athlete', 'founder')
  and status = 'approved'
  and must_change_password = false
);

drop policy if exists "athletes self read" on public.athletes;
create policy "athletes self read"
on public.athletes
for select
to authenticated
using (
  profile_id = auth.uid()
  or lower(email) = lower(auth.jwt() ->> 'email')
  or lower(contact) = lower(auth.jwt() ->> 'email')
  or is_admin()
);

drop policy if exists "athletes self insert pending" on public.athletes;
create policy "athletes self insert own"
on public.athletes
for insert
to authenticated
with check (
  profile_id = auth.uid()
  or lower(email) = lower(auth.jwt() ->> 'email')
  or lower(contact) = lower(auth.jwt() ->> 'email')
  or is_admin()
);

drop policy if exists "athletes self update" on public.athletes;
create policy "athletes self update"
on public.athletes
for update
to authenticated
using (
  profile_id = auth.uid()
  or lower(email) = lower(auth.jwt() ->> 'email')
  or lower(contact) = lower(auth.jwt() ->> 'email')
  or is_admin()
)
with check (
  profile_id = auth.uid()
  or lower(email) = lower(auth.jwt() ->> 'email')
  or lower(contact) = lower(auth.jwt() ->> 'email')
  or is_admin()
);

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

drop policy if exists "founders admin delete" on public.founders;
create policy "founders admin delete"
on public.founders
for delete
using (is_admin());

drop policy if exists "terms self read" on public.terms_acceptances;
create policy "terms self read"
on public.terms_acceptances
for select
to authenticated
using (
  lower(user_email) = lower(auth.jwt() ->> 'email')
  or is_admin()
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-media',
  'profile-media',
  true,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile media public read" on storage.objects;
create policy "profile media public read"
on storage.objects
for select
using (bucket_id = 'profile-media');

drop policy if exists "profile media owner insert" on storage.objects;
create policy "profile media owner insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-media'
  and split_part(name, '/', 1) in ('athletes', 'founders')
  and (
    split_part(name, '/', 2) = auth.uid()::text
    or public.is_admin()
  )
);

drop policy if exists "profile media owner update" on storage.objects;
create policy "profile media owner update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'profile-media'
  and (
    split_part(name, '/', 2) = auth.uid()::text
    or public.is_admin()
  )
)
with check (
  bucket_id = 'profile-media'
  and (
    split_part(name, '/', 2) = auth.uid()::text
    or public.is_admin()
  )
);

drop policy if exists "profile media owner delete" on storage.objects;
create policy "profile media owner delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-media'
  and (
    split_part(name, '/', 2) = auth.uid()::text
    or public.is_admin()
  )
);

commit;

-- Diagnostics only. Review results; this script does not repair or delete rows.
select 'auth_without_profile' as issue, u.id, u.email
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

select id, email, profile_id, image_url
from public.athletes
where image_url like 'data:%';

select id, email, profile_id, image_url
from public.founders
where image_url like 'data:%';

select 'athlete_missing_profile' as issue, a.id, a.email, a.profile_id
from public.athletes a
left join public.profiles p on p.id = a.profile_id
where a.profile_id is null or p.id is null;

select 'founder_missing_profile' as issue, f.id, f.email, f.profile_id
from public.founders f
left join public.profiles p on p.id = f.profile_id
where f.profile_id is null or p.id is null;

select 'athlete_email_mismatch' as issue, a.id, a.email as record_email, p.email as profile_email
from public.athletes a
join public.profiles p on p.id = a.profile_id
where lower(coalesce(a.email, a.contact, '')) <> lower(coalesce(p.email, ''));

select 'founder_email_mismatch' as issue, f.id, f.email as record_email, p.email as profile_email
from public.founders f
join public.profiles p on p.id = f.profile_id
where lower(coalesce(f.email, '')) <> lower(coalesce(p.email, ''));

select lower(coalesce(email, contact)) as normalized_email, count(*) as duplicate_count
from public.athletes
group by lower(coalesce(email, contact))
having count(*) > 1;

select lower(email) as normalized_email, count(*) as duplicate_count
from public.founders
group by lower(email)
having count(*) > 1;
