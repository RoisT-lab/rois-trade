-- ROIS MVP schema for Supabase
-- Run this in Supabase SQL Editor, then create users in Authentication.

create table if not exists profiles (
  id uuid primary key,
  email text unique not null,
  role text not null check (role in ('admin', 'client')),
  name text not null,
  status text not null default 'pending',
  must_change_password boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact text,
  owner text,
  interest text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists athletes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sport text not null,
  stats text,
  monthly numeric default 5000,
  annual numeric default 1000,
  category text,
  location text,
  ranking text,
  video_url text,
  image_url text,
  visual_status text not null default 'approved',
  visual_notes text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  venue text,
  date text,
  image_url text,
  visual_status text not null default 'approved',
  visual_notes text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists requests (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  title text not null,
  owner text,
  details text,
  priority text,
  status text not null default 'review',
  created_at timestamptz not null default now()
);

create table if not exists sponsorships (
  id uuid primary key default gen_random_uuid(),
  athlete text not null,
  company text,
  amount numeric default 5000,
  status text not null default 'review',
  created_at timestamptz not null default now()
);

create table if not exists news (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text,
  image_url text,
  visual_status text not null default 'approved',
  visual_notes text,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

create table if not exists partnerships (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text,
  tier text,
  url text,
  description text,
  image_url text,
  visual_status text not null default 'approved',
  visual_notes text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists site_settings (
  id text primary key,
  value text,
  created_at timestamptz not null default now()
);

create table if not exists crm (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  volume numeric default 0,
  status text not null default 'Activo',
  created_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  concept text not null,
  amount numeric default 0,
  company text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists uploads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text,
  size numeric,
  image_url text,
  visual_status text not null default 'pending_review',
  visual_notes text,
  status text not null default 'registered',
  created_at timestamptz not null default now()
);

alter table athletes add column if not exists annual numeric default 1000;
alter table athletes add column if not exists category text;
alter table athletes add column if not exists location text;
alter table athletes add column if not exists ranking text;
alter table athletes add column if not exists video_url text;

alter table profiles enable row level security;
alter table companies enable row level security;
alter table athletes enable row level security;
alter table events enable row level security;
alter table requests enable row level security;
alter table sponsorships enable row level security;
alter table news enable row level security;
alter table partnerships enable row level security;
alter table site_settings enable row level security;
alter table crm enable row level security;
alter table payments enable row level security;
alter table uploads enable row level security;

create or replace function is_admin()
returns boolean
language sql
security definer
as $$
  select exists (
    select 1 from profiles
    where profiles.id = auth.uid()
    and profiles.role = 'admin'
    and profiles.status = 'approved'
  );
$$;

drop policy if exists "profiles select own or admin" on profiles;
drop policy if exists "profiles self insert client" on profiles;
drop policy if exists "profiles update admin" on profiles;
drop policy if exists "profiles clear own password flag" on profiles;
drop policy if exists "profiles delete admin" on profiles;
drop policy if exists "companies all admin" on companies;
drop policy if exists "companies self read" on companies;
drop policy if exists "companies self insert approved" on companies;
drop policy if exists "companies public insert pending" on companies;
drop policy if exists "athletes read approved" on athletes;
drop policy if exists "athletes admin write" on athletes;
drop policy if exists "athletes public insert pending" on athletes;
drop policy if exists "events read approved" on events;
drop policy if exists "events public insert pending" on events;
drop policy if exists "events update admin" on events;
drop policy if exists "requests authenticated all" on requests;
drop policy if exists "sponsorships authenticated all" on sponsorships;
drop policy if exists "news read published" on news;
drop policy if exists "news admin write" on news;
drop policy if exists "partnerships read approved" on partnerships;
drop policy if exists "partnerships admin write" on partnerships;
drop policy if exists "site settings public read" on site_settings;
drop policy if exists "site settings admin write" on site_settings;
drop policy if exists "crm admin all" on crm;
drop policy if exists "payments admin all" on payments;
drop policy if exists "uploads admin all" on uploads;

create policy "profiles select own or admin" on profiles for select using (id = auth.uid() or is_admin());
create policy "profiles self insert client" on profiles
for insert
to authenticated
with check (
  id = auth.uid()
  and email = (auth.jwt() ->> 'email')
  and role = 'client'
  and status = 'approved'
  and must_change_password = false
);
create policy "profiles update admin" on profiles for update using (is_admin());
create policy "profiles clear own password flag" on profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid() and must_change_password = false);
create policy "profiles delete admin" on profiles for delete using (is_admin() and id <> auth.uid());

create policy "companies all admin" on companies for all using (is_admin()) with check (is_admin());
create policy "companies self read" on companies
for select
to authenticated
using (contact = (auth.jwt() ->> 'email') or is_admin());
create policy "companies self insert approved" on companies
for insert
to authenticated
with check (
  contact = (auth.jwt() ->> 'email')
  and status = 'approved'
);
create policy "athletes read approved" on athletes for select using (status = 'approved' or is_admin());
create policy "athletes admin write" on athletes for all using (is_admin()) with check (is_admin());
create policy "athletes public insert pending" on athletes for insert to anon, authenticated with check (
  status = 'pending'
  and coalesce(visual_status, 'approved') in ('approved', 'pending_review')
);
create policy "events read approved" on events for select using (status = 'approved' or is_admin());
create policy "events public insert pending" on events for insert to anon, authenticated with check (
  status = 'pending'
  and coalesce(visual_status, 'approved') in ('approved', 'pending_review')
);
create policy "events update admin" on events for update using (is_admin());
create policy "requests authenticated all" on requests for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "sponsorships authenticated all" on sponsorships for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "news read published" on news for select using (status = 'published' or is_admin());
create policy "news admin write" on news for all using (is_admin()) with check (is_admin());
create policy "partnerships read approved" on partnerships for select using (status = 'approved' or is_admin());
create policy "partnerships admin write" on partnerships for all using (is_admin()) with check (is_admin());
create policy "site settings public read" on site_settings for select using (true);
create policy "site settings admin write" on site_settings for all using (is_admin()) with check (is_admin());
create policy "crm admin all" on crm for all using (is_admin()) with check (is_admin());
create policy "payments admin all" on payments for all using (is_admin()) with check (is_admin());
create policy "uploads admin all" on uploads for all using (is_admin()) with check (is_admin());

grant usage on schema public to anon, authenticated;
grant select on profiles, companies, athletes, events, requests, sponsorships, news, partnerships, site_settings, crm, payments, uploads to anon, authenticated;
grant insert on profiles to authenticated;
grant update (must_change_password) on profiles to authenticated;
grant insert on athletes, events to anon, authenticated;
grant insert on companies to authenticated;
grant insert, update on requests, sponsorships, payments to authenticated;
