-- ROIS MVP schema for Supabase
-- Run this in Supabase SQL Editor, then create users in Authentication.

create table if not exists profiles (
  id uuid primary key,
  email text unique not null,
  role text not null check (role in ('admin', 'client', 'athlete')),
  name text not null,
  status text not null default 'pending',
  must_change_password boolean not null default false,
  created_at timestamptz not null default now()
);

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('admin', 'client', 'athlete'));

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact text,
  owner text,
  interest text,
  website text,
  description text,
  logo_url text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists athletes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid,
  email text,
  contact text,
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
  terms_accepted boolean not null default false,
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
  athlete_email text,
  company text,
  amount numeric default 5000,
  status text not null default 'review',
  created_at timestamptz not null default now()
);

create table if not exists athlete_posts (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid,
  athlete_email text,
  athlete_name text,
  title text not null,
  caption text,
  video_url text,
  image_url text,
  visual_status text not null default 'approved',
  visual_notes text,
  status text not null default 'pending_review',
  created_at timestamptz not null default now()
);

create table if not exists athlete_results (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid,
  athlete_email text,
  athlete_name text,
  month text,
  event text,
  summary text,
  proof_url text,
  status text not null default 'review',
  created_at timestamptz not null default now()
);

create table if not exists athlete_expenses (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid,
  athlete_email text,
  athlete_name text,
  date text,
  category text,
  amount numeric default 0,
  company text,
  ticket_url text,
  invoice_url text,
  notes text,
  status text not null default 'review',
  created_at timestamptz not null default now()
);

create table if not exists athlete_deposits (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid,
  athlete_email text,
  athlete_name text,
  month text,
  amount numeric default 0,
  company text,
  proof_url text,
  status text not null default 'paid',
  created_at timestamptz not null default now()
);

create table if not exists terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_email text,
  user_role text,
  version text,
  status text not null default 'accepted',
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
alter table athletes add column if not exists profile_id uuid;
alter table athletes add column if not exists email text;
alter table athletes add column if not exists contact text;
alter table athletes add column if not exists terms_accepted boolean not null default false;
alter table athletes add column if not exists category text;
alter table athletes add column if not exists location text;
alter table athletes add column if not exists ranking text;
alter table athletes add column if not exists video_url text;
alter table athletes add column if not exists sponsor_payment_url text;
alter table athletes add column if not exists sponsor_terms text;
alter table athletes add column if not exists sponsor_brands text;
alter table athletes add column if not exists sponsor_logos text;
alter table athletes add column if not exists max_sponsors numeric default 3;
alter table athletes add column if not exists proposal_url text;
alter table athletes add column if not exists proposal_name text;
alter table events add column if not exists brochure_url text;
alter table events add column if not exists brochure_name text;
alter table events add column if not exists event_scope text;
alter table events add column if not exists sponsor_levels text;
alter table companies add column if not exists website text;
alter table companies add column if not exists description text;
alter table companies add column if not exists logo_url text;
alter table sponsorships add column if not exists details text;
alter table sponsorships add column if not exists athlete_email text;
alter table payments add column if not exists product_key text;

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
alter table athlete_posts enable row level security;
alter table athlete_results enable row level security;
alter table athlete_expenses enable row level security;
alter table athlete_deposits enable row level security;
alter table terms_acceptances enable row level security;

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
drop policy if exists "companies self update" on companies;
drop policy if exists "companies self insert approved" on companies;
drop policy if exists "companies public insert pending" on companies;
drop policy if exists "athletes read approved" on athletes;
drop policy if exists "athletes admin write" on athletes;
drop policy if exists "athletes self read" on athletes;
drop policy if exists "athletes self update" on athletes;
drop policy if exists "athletes self insert pending" on athletes;
drop policy if exists "athletes public insert pending" on athletes;
drop policy if exists "events read approved" on events;
drop policy if exists "events public insert pending" on events;
drop policy if exists "events update admin" on events;
drop policy if exists "events delete admin" on events;
drop policy if exists "requests authenticated all" on requests;
drop policy if exists "sponsorships authenticated all" on sponsorships;
drop policy if exists "news read published" on news;
drop policy if exists "news admin write" on news;
drop policy if exists "partnerships read approved" on partnerships;
drop policy if exists "partnerships admin write" on partnerships;
drop policy if exists "site settings public read" on site_settings;
drop policy if exists "site settings admin write" on site_settings;
drop policy if exists "crm admin all" on crm;
drop policy if exists "crm client insert" on crm;
drop policy if exists "payments admin all" on payments;
drop policy if exists "uploads admin all" on uploads;
drop policy if exists "athlete posts read approved" on athlete_posts;
drop policy if exists "athlete posts self insert" on athlete_posts;
drop policy if exists "athlete posts self read" on athlete_posts;
drop policy if exists "athlete posts admin all" on athlete_posts;
drop policy if exists "athlete results self all" on athlete_results;
drop policy if exists "athlete results admin all" on athlete_results;
drop policy if exists "athlete expenses self all" on athlete_expenses;
drop policy if exists "athlete expenses admin all" on athlete_expenses;
drop policy if exists "athlete deposits self read" on athlete_deposits;
drop policy if exists "athlete deposits admin all" on athlete_deposits;
drop policy if exists "terms self insert" on terms_acceptances;
drop policy if exists "terms admin read" on terms_acceptances;

create policy "profiles select own or admin" on profiles for select using (id = auth.uid() or is_admin());
create policy "profiles self insert client" on profiles
for insert
to authenticated
with check (
  id = auth.uid()
  and email = (auth.jwt() ->> 'email')
  and role in ('client', 'athlete')
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
create policy "companies self update" on companies
for update
to authenticated
using (contact = (auth.jwt() ->> 'email'))
with check (
  contact = (auth.jwt() ->> 'email')
  and status = 'approved'
);
create policy "athletes read approved" on athletes for select using (status = 'approved' or is_admin());
create policy "athletes admin write" on athletes for all using (is_admin()) with check (is_admin());
create policy "athletes self read" on athletes for select to authenticated using (email = (auth.jwt() ->> 'email'));
create policy "athletes self insert pending" on athletes for insert to authenticated with check (
  email = (auth.jwt() ->> 'email')
  and status = 'pending'
);
create policy "athletes self update" on athletes for update to authenticated using (email = (auth.jwt() ->> 'email')) with check (
  email = (auth.jwt() ->> 'email')
);
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
create policy "events delete admin" on events for delete using (is_admin());
create policy "requests authenticated all" on requests for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "sponsorships authenticated all" on sponsorships for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "news read published" on news for select using (status = 'published' or is_admin());
create policy "news admin write" on news for all using (is_admin()) with check (is_admin());
create policy "partnerships read approved" on partnerships for select using (status = 'approved' or is_admin());
create policy "partnerships admin write" on partnerships for all using (is_admin()) with check (is_admin());
create policy "site settings public read" on site_settings for select using (true);
create policy "site settings admin write" on site_settings for all using (is_admin()) with check (is_admin());
create policy "crm admin all" on crm for all using (is_admin()) with check (is_admin());
create policy "crm client insert" on crm
for insert
to authenticated
with check (status = 'Nuevo cliente');
create policy "payments admin all" on payments for all using (is_admin()) with check (is_admin());
create policy "uploads admin all" on uploads for all using (is_admin()) with check (is_admin());
create policy "athlete posts read approved" on athlete_posts for select using ((status = 'approved' and coalesce(visual_status, 'approved') = 'approved') or is_admin());
create policy "athlete posts self read" on athlete_posts for select to authenticated using (athlete_email = (auth.jwt() ->> 'email'));
create policy "athlete posts self insert" on athlete_posts for insert to authenticated with check (athlete_email = (auth.jwt() ->> 'email'));
create policy "athlete posts admin all" on athlete_posts for all using (is_admin()) with check (is_admin());
create policy "athlete results self all" on athlete_results for all to authenticated using (athlete_email = (auth.jwt() ->> 'email')) with check (athlete_email = (auth.jwt() ->> 'email'));
create policy "athlete results admin all" on athlete_results for all using (is_admin()) with check (is_admin());
create policy "athlete expenses self all" on athlete_expenses for all to authenticated using (athlete_email = (auth.jwt() ->> 'email')) with check (athlete_email = (auth.jwt() ->> 'email'));
create policy "athlete expenses admin all" on athlete_expenses for all using (is_admin()) with check (is_admin());
create policy "athlete deposits self read" on athlete_deposits for select to authenticated using (athlete_email = (auth.jwt() ->> 'email'));
create policy "athlete deposits admin all" on athlete_deposits for all using (is_admin()) with check (is_admin());
create policy "terms self insert" on terms_acceptances for insert to authenticated with check (user_email = (auth.jwt() ->> 'email'));
create policy "terms admin read" on terms_acceptances for select using (is_admin());

grant usage on schema public to anon, authenticated;
grant select on profiles, companies, athletes, events, requests, sponsorships, news, partnerships, site_settings, crm, payments, uploads, athlete_posts, athlete_results, athlete_expenses, athlete_deposits, terms_acceptances to anon, authenticated;
grant insert on profiles to authenticated;
grant update (name, role, status, must_change_password) on profiles to authenticated;
grant insert on athletes, events to anon, authenticated;
grant update (
  name,
  sport,
  stats,
  monthly,
  annual,
  category,
  location,
  ranking,
  image_url,
  visual_status,
  max_sponsors,
  sponsor_logos,
  video_url,
  proposal_url,
  proposal_name,
  terms_accepted
) on athletes to authenticated;
grant insert on companies to authenticated;
grant update (name, owner, interest, website, description, logo_url, status) on companies to authenticated;
grant insert on crm to authenticated;
grant insert, update on requests, sponsorships, payments to authenticated;
grant insert, update, delete on site_settings to authenticated;
grant insert on uploads to authenticated;
grant update, delete on athletes, events, news, partnerships, uploads to authenticated;
grant insert, update, delete on athlete_posts, athlete_results, athlete_expenses to authenticated;
grant insert on athlete_deposits to authenticated;
grant insert on terms_acceptances to authenticated;
