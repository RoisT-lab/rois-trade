-- ROIS corporate marketplace and PRO/Business entitlements.
-- Safe, additive and idempotent. Run once in the Supabase SQL Editor.

create extension if not exists pgcrypto;

alter table public.companies add column if not exists profile_id uuid;
alter table public.events add column if not exists company_id uuid;
alter table public.events add column if not exists profile_id uuid;
alter table public.events add column if not exists success_fee_level text;
alter table public.events add column if not exists success_fee_rate numeric;
alter table public.events add column if not exists image_path text;
alter table public.events add column if not exists updated_at timestamptz not null default now();

update public.companies c
set profile_id = p.id
from public.profiles p
where c.profile_id is null
  and lower(coalesce(c.contact, '')) = lower(coalesce(p.email, ''));

create index if not exists companies_profile_id_idx on public.companies (profile_id);
create index if not exists companies_contact_lower_idx on public.companies (lower(contact));
create index if not exists events_company_status_created_idx on public.events (company_id, status, created_at desc);
create index if not exists events_profile_id_idx on public.events (profile_id);

create table if not exists public.company_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid,
  company_name text not null,
  plan text not null default 'free' check (plan in ('free', 'pro', 'business')),
  status text not null default 'inactive' check (status in ('inactive', 'trialing', 'active', 'past_due', 'canceled')),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  listing_limit integer not null default 0 check (listing_limit >= 0),
  event_limit_monthly integer not null default 0 check (event_limit_monthly >= 0),
  seats_limit integer not null default 1 check (seats_limit >= 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id)
);

-- Compatibility with earlier ROIS versions where this table may already exist.
alter table public.company_subscriptions add column if not exists company_name text;
update public.company_subscriptions s
set company_name = c.name
from public.companies c
where s.company_id = c.id
  and coalesce(s.company_name, '') = '';

create table if not exists public.company_listings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid,
  listing_type text not null check (listing_type in ('product', 'service', 'asset', 'opportunity')),
  category text not null,
  subcategory text,
  title text not null,
  summary text not null,
  description text,
  price numeric check (price is null or price >= 0),
  currency text not null default 'MXN',
  price_label text,
  location text,
  inventory_count integer check (inventory_count is null or inventory_count >= 0),
  availability text not null default 'available' check (availability in ('available', 'limited', 'on_request', 'sold_out')),
  contact_email text,
  contact_phone text,
  website_url text,
  primary_image_url text,
  primary_image_path text,
  plan_required text not null default 'pro' check (plan_required in ('pro', 'business')),
  featured boolean not null default false,
  featured_until timestamptz,
  status text not null default 'pending' check (status in ('draft', 'pending', 'approved', 'rejected', 'archived')),
  visual_status text not null default 'pending_review' check (visual_status in ('pending_review', 'approved', 'rejected')),
  visual_notes text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_listing_media (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.company_listings(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  storage_path text not null,
  public_url text not null,
  original_name text,
  mime_type text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.company_listings add column if not exists company_name text;
update public.company_listings l
set company_name = c.name
from public.companies c
where l.company_id = c.id and coalesce(l.company_name, '') = '';

create table if not exists public.marketplace_leads (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.company_listings(id) on delete cascade,
  seller_company_id uuid not null references public.companies(id) on delete cascade,
  buyer_company_id uuid references public.companies(id) on delete set null,
  requester_profile_id uuid,
  requester_email text not null,
  requester_name text,
  requester_company text,
  message text,
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'closed', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists company_subscriptions_profile_id_idx on public.company_subscriptions (profile_id);
create index if not exists company_subscriptions_status_plan_idx on public.company_subscriptions (status, plan);
create index if not exists company_listings_public_feed_idx on public.company_listings (status, visual_status, featured desc, created_at desc);
create index if not exists company_listings_company_status_idx on public.company_listings (company_id, status, created_at desc);
create index if not exists company_listings_category_idx on public.company_listings (category, status, created_at desc);
create index if not exists company_listings_expires_idx on public.company_listings (expires_at) where expires_at is not null;
create index if not exists company_listing_media_listing_idx on public.company_listing_media (listing_id, sort_order);
create index if not exists marketplace_leads_seller_status_idx on public.marketplace_leads (seller_company_id, status, created_at desc);
create index if not exists marketplace_leads_buyer_idx on public.marketplace_leads (buyer_company_id, created_at desc);

create or replace function public.rois_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.rois_seed_company_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.company_subscriptions (
    company_id, profile_id, company_name, plan, status, listing_limit, event_limit_monthly, seats_limit
  ) values (
    new.id, new.profile_id, coalesce(nullif(new.name, ''), 'Empresa ROIS'), 'free', 'inactive', 0, 0, 1
  ) on conflict (company_id) do nothing;
  return new;
end;
$$;

drop trigger if exists company_subscriptions_touch_updated_at on public.company_subscriptions;
create trigger company_subscriptions_touch_updated_at
before update on public.company_subscriptions
for each row execute function public.rois_touch_updated_at();

drop trigger if exists company_listings_touch_updated_at on public.company_listings;
create trigger company_listings_touch_updated_at
before update on public.company_listings
for each row execute function public.rois_touch_updated_at();

drop trigger if exists marketplace_leads_touch_updated_at on public.marketplace_leads;
create trigger marketplace_leads_touch_updated_at
before update on public.marketplace_leads
for each row execute function public.rois_touch_updated_at();

drop trigger if exists events_touch_updated_at on public.events;
create trigger events_touch_updated_at
before update on public.events
for each row execute function public.rois_touch_updated_at();

drop trigger if exists companies_seed_subscription on public.companies;
create trigger companies_seed_subscription
after insert on public.companies
for each row execute function public.rois_seed_company_subscription();

create or replace function public.rois_company_owned(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.companies c
    where c.id = target_company_id
      and (
        c.profile_id = auth.uid()
        or lower(coalesce(c.contact, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
  );
$$;

create or replace function public.rois_company_entitled(target_company_id uuid, entitlement text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1
    from public.company_subscriptions s
    where s.company_id = target_company_id
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
      and case entitlement
        when 'publish_listings' then s.plan in ('pro', 'business') and s.listing_limit > 0
        when 'publish_events' then s.plan in ('pro', 'business') and s.event_limit_monthly > 0
        when 'featured_listings' then s.plan = 'business'
        when 'team_seats' then s.plan = 'business' and s.seats_limit > 1
        else false
      end
  );
$$;

create or replace function public.rois_company_can_create_listing(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1
    from public.company_subscriptions s
    where s.company_id = target_company_id
      and s.status in ('active', 'trialing')
      and s.plan in ('pro', 'business')
      and (s.current_period_end is null or s.current_period_end > now())
      and (
        select count(*)
        from public.company_listings l
        where l.company_id = target_company_id
          and l.status in ('draft', 'pending', 'approved')
      ) < s.listing_limit
  );
$$;

create or replace function public.rois_company_can_create_event(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1
    from public.company_subscriptions s
    where s.company_id = target_company_id
      and s.status in ('active', 'trialing')
      and s.plan in ('pro', 'business')
      and (s.current_period_end is null or s.current_period_end > now())
      and (
        select count(*)
        from public.events e
        where e.company_id = target_company_id
          and e.created_at >= date_trunc('month', now())
          and e.status <> 'rejected'
      ) < s.event_limit_monthly
  );
$$;

grant execute on function public.rois_company_owned(uuid) to authenticated;
grant execute on function public.rois_company_entitled(uuid, text) to authenticated;
grant execute on function public.rois_company_can_create_listing(uuid) to authenticated;
grant execute on function public.rois_company_can_create_event(uuid) to authenticated;

alter table public.company_subscriptions enable row level security;
alter table public.company_listings enable row level security;
alter table public.company_listing_media enable row level security;
alter table public.marketplace_leads enable row level security;

drop policy if exists "company subscriptions own read" on public.company_subscriptions;
create policy "company subscriptions own read"
on public.company_subscriptions for select to authenticated
using (public.rois_company_owned(company_id) or public.is_admin());

drop policy if exists "company subscriptions admin write" on public.company_subscriptions;
create policy "company subscriptions admin write"
on public.company_subscriptions for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "company listings visible read" on public.company_listings;
create policy "company listings visible read"
on public.company_listings for select to authenticated
using (
  (status = 'approved' and visual_status = 'approved' and (expires_at is null or expires_at > now()))
  or public.rois_company_owned(company_id)
  or public.is_admin()
);

drop policy if exists "company listings owner insert" on public.company_listings;
create policy "company listings owner insert"
on public.company_listings for insert to authenticated
with check (
  public.rois_company_owned(company_id)
  and profile_id = auth.uid()
  and public.rois_company_can_create_listing(company_id)
  and status in ('draft', 'pending')
  and visual_status = 'pending_review'
  and featured = false
);

drop policy if exists "company listings owner update" on public.company_listings;
create policy "company listings owner update"
on public.company_listings for update to authenticated
using (public.rois_company_owned(company_id))
with check (
  public.rois_company_owned(company_id)
  and profile_id = auth.uid()
  and public.rois_company_entitled(company_id, 'publish_listings')
  and status in ('draft', 'pending', 'archived')
  and featured = false
);

drop policy if exists "company listings admin write" on public.company_listings;
create policy "company listings admin write"
on public.company_listings for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "company listing media visible read" on public.company_listing_media;
create policy "company listing media visible read"
on public.company_listing_media for select to authenticated
using (
  public.rois_company_owned(company_id)
  or public.is_admin()
  or exists (
    select 1 from public.company_listings l
    where l.id = listing_id and l.status = 'approved' and l.visual_status = 'approved'
  )
);

drop policy if exists "company listing media owner write" on public.company_listing_media;
create policy "company listing media owner write"
on public.company_listing_media for all to authenticated
using (public.rois_company_owned(company_id) or public.is_admin())
with check (public.rois_company_owned(company_id) or public.is_admin());

drop policy if exists "marketplace leads participant read" on public.marketplace_leads;
create policy "marketplace leads participant read"
on public.marketplace_leads for select to authenticated
using (
  requester_profile_id = auth.uid()
  or public.rois_company_owned(seller_company_id)
  or (buyer_company_id is not null and public.rois_company_owned(buyer_company_id))
  or public.is_admin()
);

drop policy if exists "marketplace leads buyer insert" on public.marketplace_leads;
create policy "marketplace leads buyer insert"
on public.marketplace_leads for insert to authenticated
with check (
  requester_profile_id = auth.uid()
  and lower(requester_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  and (buyer_company_id is null or public.rois_company_owned(buyer_company_id))
  and status = 'new'
);

drop policy if exists "marketplace leads seller update" on public.marketplace_leads;
create policy "marketplace leads seller update"
on public.marketplace_leads for update to authenticated
using (public.rois_company_owned(seller_company_id) or public.is_admin())
with check (public.rois_company_owned(seller_company_id) or public.is_admin());

-- Event creation becomes a PRO/Business entitlement. Existing approved events remain readable.
drop policy if exists "events public insert pending" on public.events;
drop policy if exists "events company insert pro" on public.events;
create policy "events company insert pro"
on public.events for insert to authenticated
with check (
  status = 'pending'
  and company_id is not null
  and profile_id = auth.uid()
  and public.rois_company_owned(company_id)
  and public.rois_company_can_create_event(company_id)
  and coalesce(visual_status, 'approved') in ('approved', 'pending_review')
);

drop policy if exists "events company read own" on public.events;
create policy "events company read own"
on public.events for select to authenticated
using (public.rois_company_owned(company_id));

drop policy if exists "events company update own" on public.events;
create policy "events company update own"
on public.events for update to authenticated
using (public.rois_company_owned(company_id))
with check (
  public.rois_company_owned(company_id)
  and profile_id = auth.uid()
  and public.rois_company_entitled(company_id, 'publish_events')
  and status in ('pending', 'draft')
);

grant select on public.company_subscriptions, public.company_listings, public.company_listing_media, public.marketplace_leads to authenticated;
grant insert, update, delete on public.company_subscriptions, public.company_listings, public.company_listing_media, public.marketplace_leads to authenticated;
grant update (profile_id) on public.companies to authenticated;
grant update (company_id, profile_id, image_url, image_path, visual_status, event_scope, sponsor_levels, success_fee_level, success_fee_rate) on public.events to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-media',
  'company-media',
  true,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "company media public read" on storage.objects;
create policy "company media public read"
on storage.objects for select
using (bucket_id = 'company-media');

drop policy if exists "company media owner insert" on storage.objects;
create policy "company media owner insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'company-media'
  and (storage.foldername(name))[1] = 'companies'
  and public.rois_company_owned(((storage.foldername(name))[2])::uuid)
);

drop policy if exists "company media owner update" on storage.objects;
create policy "company media owner update"
on storage.objects for update to authenticated
using (
  bucket_id = 'company-media'
  and public.rois_company_owned(((storage.foldername(name))[2])::uuid)
)
with check (
  bucket_id = 'company-media'
  and public.rois_company_owned(((storage.foldername(name))[2])::uuid)
);

drop policy if exists "company media owner delete" on storage.objects;
create policy "company media owner delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'company-media'
  and public.rois_company_owned(((storage.foldername(name))[2])::uuid)
);

-- Every existing company starts Free. Admin or a Stripe webhook can activate PRO/Business later.
insert into public.company_subscriptions (
  company_id,
  profile_id,
  company_name,
  plan,
  status,
  listing_limit,
  event_limit_monthly,
  seats_limit
)
select c.id, c.profile_id, coalesce(nullif(c.name, ''), 'Empresa ROIS'), 'free', 'inactive', 0, 0, 1
from public.companies c
on conflict (company_id) do nothing;

-- Operational verification.
select
  c.id,
  c.name,
  c.contact,
  c.profile_id,
  s.plan,
  s.status,
  s.listing_limit,
  s.event_limit_monthly
from public.companies c
left join public.company_subscriptions s on s.company_id = c.id
order by c.created_at desc;
