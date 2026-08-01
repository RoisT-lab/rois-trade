-- ROIS commercial records, localized invitations and promotional access.
-- Safe migration: preserves CRM records and existing athlete/creator access.

begin;

alter table public.crm
  add column if not exists country text,
  add column if not exists preferred_language text not null default 'auto',
  add column if not exists advanced_access_months integer not null default 0,
  add column if not exists advanced_access_status text not null default 'not_offered';

-- Keep this migration independently deployable if annual access was not installed first.
alter table public.athletes
  add column if not exists annual_fee_paid boolean not null default false,
  add column if not exists annual_payment_status text not null default 'not_requested',
  add column if not exists annual_access_started_at timestamptz,
  add column if not exists annual_access_expires_at timestamptz,
  add column if not exists marketplace_access_status text not null default 'locked';

alter table public.founders
  add column if not exists annual_fee_paid boolean not null default false,
  add column if not exists annual_payment_status text not null default 'not_requested',
  add column if not exists annual_access_started_at timestamptz,
  add column if not exists annual_access_expires_at timestamptz,
  add column if not exists marketplace_access_status text not null default 'locked';

alter table public.crm drop constraint if exists crm_preferred_language_check;
alter table public.crm
  add constraint crm_preferred_language_check
  check (preferred_language in ('auto', 'es', 'en', 'pt'));

alter table public.crm drop constraint if exists crm_advanced_access_months_check;
alter table public.crm
  add constraint crm_advanced_access_months_check
  check (advanced_access_months between 0 and 12);

alter table public.crm drop constraint if exists crm_advanced_access_status_check;
alter table public.crm
  add constraint crm_advanced_access_status_check
  check (advanced_access_status in ('not_offered', 'pending', 'redeemed', 'expired', 'cancelled'));

create index if not exists crm_country_type_idx
  on public.crm (country, prospect_type, created_at desc);

create index if not exists crm_promotional_access_idx
  on public.crm (lower(email), prospect_type, advanced_access_status)
  where advanced_access_months > 0;

create or replace function public.rois_apply_crm_promotional_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_crm_id uuid;
  v_months integer;
  v_type text;
begin
  v_email := lower(coalesce(to_jsonb(new) ->> 'email', to_jsonb(new) ->> 'contact', ''));
  v_type := case when tg_table_name = 'athletes' then 'athlete' else 'creator' end;

  if v_email = '' then return new; end if;

  select c.id, c.advanced_access_months
    into v_crm_id, v_months
  from public.crm c
  where lower(coalesce(c.email, '')) = v_email
    and c.prospect_type = v_type
    and c.advanced_access_months > 0
    and c.advanced_access_status = 'pending'
  order by c.created_at desc
  limit 1;

  if v_crm_id is null then return new; end if;

  new.annual_fee_paid := true;
  new.annual_payment_status := 'promotional_access';
  new.annual_access_started_at := coalesce(new.annual_access_started_at, now());
  new.annual_access_expires_at := greatest(
    coalesce(new.annual_access_expires_at, now()),
    now() + make_interval(months => v_months)
  );
  new.marketplace_access_status := 'active';

  update public.crm
  set advanced_access_status = 'redeemed', updated_at = now()
  where id = v_crm_id;

  return new;
end;
$$;

drop trigger if exists athletes_apply_crm_promotional_access on public.athletes;
drop trigger if exists athletes_insert_crm_promotional_access on public.athletes;
create trigger athletes_insert_crm_promotional_access
before insert on public.athletes
for each row execute function public.rois_apply_crm_promotional_access();

drop trigger if exists athletes_update_crm_promotional_access on public.athletes;
create trigger athletes_update_crm_promotional_access
before update of email, contact on public.athletes
for each row execute function public.rois_apply_crm_promotional_access();

drop trigger if exists founders_apply_crm_promotional_access on public.founders;
drop trigger if exists founders_insert_crm_promotional_access on public.founders;
create trigger founders_insert_crm_promotional_access
before insert on public.founders
for each row execute function public.rois_apply_crm_promotional_access();

drop trigger if exists founders_update_crm_promotional_access on public.founders;
create trigger founders_update_crm_promotional_access
before update of email on public.founders
for each row execute function public.rois_apply_crm_promotional_access();

create or replace function public.rois_redeem_talent_access_grant(p_email text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_total integer := 0;
  v_count integer := 0;
begin
  if v_email = '' then return 0; end if;

  update public.athletes a
  set annual_fee_paid = true,
      annual_payment_status = 'promotional_access',
      annual_access_started_at = coalesce(a.annual_access_started_at, now()),
      annual_access_expires_at = greatest(
        coalesce(a.annual_access_expires_at, now()),
        now() + make_interval(months => c.advanced_access_months)
      ),
      marketplace_access_status = 'active'
  from public.crm c
  where lower(coalesce(a.email, a.contact, '')) = v_email
    and lower(coalesce(c.email, '')) = v_email
    and c.prospect_type = 'athlete'
    and c.advanced_access_months > 0
    and c.advanced_access_status = 'pending';
  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  update public.founders f
  set annual_fee_paid = true,
      annual_payment_status = 'promotional_access',
      annual_access_started_at = coalesce(f.annual_access_started_at, now()),
      annual_access_expires_at = greatest(
        coalesce(f.annual_access_expires_at, now()),
        now() + make_interval(months => c.advanced_access_months)
      ),
      marketplace_access_status = 'active'
  from public.crm c
  where lower(coalesce(f.email, '')) = v_email
    and lower(coalesce(c.email, '')) = v_email
    and c.prospect_type = 'creator'
    and c.advanced_access_months > 0
    and c.advanced_access_status = 'pending';
  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  if v_total > 0 then
    update public.crm
    set advanced_access_status = 'redeemed', updated_at = now()
    where lower(coalesce(email, '')) = v_email
      and advanced_access_months > 0
      and advanced_access_status = 'pending';
  end if;

  return v_total;
end;
$$;

revoke all on function public.rois_redeem_talent_access_grant(text) from public;
grant execute on function public.rois_redeem_talent_access_grant(text) to service_role;

commit;

-- Verification: returns the commercial records grouped by account and language.
select
  coalesce(prospect_type, 'unclassified') as account_type,
  preferred_language,
  count(*) as records
from public.crm
group by coalesce(prospect_type, 'unclassified'), preferred_language
order by account_type, preferred_language;
