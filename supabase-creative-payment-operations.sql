begin;

create extension if not exists pgcrypto;

alter table if exists public.brand_growth_campaigns
  add column if not exists company_id uuid references public.companies(id) on delete restrict;

create index if not exists brand_growth_campaign_company_idx
  on public.brand_growth_campaigns (company_id, created_at desc);

create table if not exists public.creative_payment_operations (
  id uuid primary key default gen_random_uuid(),
  participant_record_id uuid not null references public.brand_growth_participants(id) on delete restrict,
  campaign_id uuid not null references public.brand_growth_campaigns(id) on delete restrict,
  profile_id uuid not null,
  company_id uuid references public.companies(id) on delete restrict,
  gross_amount numeric(14,2) not null check (gross_amount > 0),
  rois_fee_rate numeric(5,4) not null default 0.3000 check (rois_fee_rate = 0.3000),
  rois_fee_amount numeric(14,2) not null check (rois_fee_amount >= 0),
  participant_net_amount numeric(14,2) not null check (participant_net_amount >= 0),
  currency text not null default 'MXN',
  payment_link text,
  payment_status text not null default 'pending_link'
    check (payment_status in ('pending_link', 'payment_enabled', 'paid', 'cancelled', 'disputed')),
  admin_notes text,
  payment_enabled_at timestamptz,
  paid_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (participant_record_id)
);

create index if not exists creative_payment_operations_campaign_idx
  on public.creative_payment_operations (campaign_id, created_at desc);
create index if not exists creative_payment_operations_profile_idx
  on public.creative_payment_operations (profile_id, created_at desc);
create index if not exists creative_payment_operations_company_idx
  on public.creative_payment_operations (company_id, created_at desc);
create index if not exists creative_payment_operations_status_idx
  on public.creative_payment_operations (payment_status, updated_at desc);

create or replace function public.creative_payment_amounts(p_value numeric)
returns table (
  gross_amount numeric(14,2),
  rois_fee_amount numeric(14,2),
  participant_net_amount numeric(14,2)
)
language sql
immutable
set search_path = public
as $$
  with amounts as (
    select round(greatest(coalesce(p_value, 0), 0)::numeric, 2) as gross
  )
  select
    gross::numeric(14,2),
    round(gross * 0.3000, 2)::numeric(14,2),
    round(gross - round(gross * 0.3000, 2), 2)::numeric(14,2)
  from amounts;
$$;

create or replace function public.valid_creative_payment_link(p_value text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    nullif(trim(coalesce(p_value, '')), '') is not null
    and lower(left(trim(p_value), 8)) = 'https://'
    and length(split_part(substring(trim(p_value) from 9), '/', 1)) > 0
    and trim(p_value) !~ '[[:space:][:cntrl:]]';
$$;

create or replace function public.rois_creative_payments_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where (p.id = auth.uid() or lower(coalesce(p.email, '')) = lower(coalesce(auth.jwt() ->> 'email', '')))
      and p.role = 'admin'
      and coalesce(p.status, 'approved') = 'approved'
  );
$$;

create or replace function public.rois_prepare_creative_payment_operation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amounts record;
begin
  select * into v_amounts from public.creative_payment_amounts(new.gross_amount);
  if v_amounts.gross_amount <= 0 then
    raise exception 'El monto bruto debe ser mayor que cero.' using errcode = '22023';
  end if;
  new.gross_amount := v_amounts.gross_amount;
  new.rois_fee_rate := 0.3000;
  new.rois_fee_amount := v_amounts.rois_fee_amount;
  new.participant_net_amount := v_amounts.participant_net_amount;
  new.currency := upper(coalesce(nullif(trim(new.currency), ''), 'MXN'));
  new.payment_link := nullif(trim(new.payment_link), '');
  if new.payment_status = 'payment_enabled' and not public.valid_creative_payment_link(new.payment_link) then
    raise exception 'Se requiere un enlace de pago HTTPS valido para habilitar el pago.' using errcode = '22023';
  end if;
  if new.payment_link is not null and not public.valid_creative_payment_link(new.payment_link) then
    raise exception 'El enlace de pago debe ser una URL HTTPS valida.' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists creative_payment_operations_prepare on public.creative_payment_operations;
create trigger creative_payment_operations_prepare
before insert or update on public.creative_payment_operations
for each row execute function public.rois_prepare_creative_payment_operation();

create or replace function public.create_creative_payment_operation(p_participant_record_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acceptance public.brand_growth_participants%rowtype;
  v_payee public.brand_growth_participants%rowtype;
  v_campaign public.brand_growth_campaigns%rowtype;
  v_operation_id uuid;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if p_participant_record_id is null then
    raise exception 'participant_record_id es obligatorio.' using errcode = '22023';
  end if;

  select * into v_acceptance
  from public.brand_growth_participants
  where id = p_participant_record_id
  for update;

  if not found then
    raise exception 'No existe la participacion indicada.' using errcode = 'P0002';
  end if;
  if lower(coalesce(v_acceptance.quote_status, '')) <> 'accepted' then
    raise exception 'La cotizacion no tiene una aceptacion valida.' using errcode = '22023';
  end if;
  if coalesce(v_acceptance.agreed_amount, 0) <= 0 then
    raise exception 'La cotizacion aceptada no tiene un monto mayor que cero.' using errcode = '22023';
  end if;
  if not public.rois_creative_payments_is_admin()
     and v_acceptance.profile_id <> auth.uid()
     and lower(coalesce(v_acceptance.email, '')) <> v_email then
    raise exception 'No puedes crear una operacion para otra participacion.' using errcode = '42501';
  end if;

  select * into v_campaign
  from public.brand_growth_campaigns
  where id = v_acceptance.campaign_id;
  if not found then
    raise exception 'No existe la campana vinculada.' using errcode = 'P0002';
  end if;

  select * into v_payee
  from public.brand_growth_participants
  where campaign_id = v_acceptance.campaign_id
    and profile_id = v_acceptance.paired_with_id
    and paired_with_id = v_acceptance.profile_id
    and lower(coalesce(quote_status, '')) = 'quoted'
  order by created_at asc
  limit 1;
  if not found then
    raise exception 'No existe la cotizacion original vinculada al participante.' using errcode = 'P0002';
  end if;

  insert into public.creative_payment_operations (
    participant_record_id, campaign_id, profile_id, company_id,
    gross_amount, rois_fee_rate, rois_fee_amount, participant_net_amount,
    currency, payment_status, created_by, updated_by
  ) values (
    v_acceptance.id, v_campaign.id, v_payee.profile_id, v_campaign.company_id,
    v_acceptance.agreed_amount, 0.3000, 0, 0,
    coalesce(nullif(upper(trim(v_acceptance.currency)), ''), 'MXN'), 'pending_link',
    auth.uid(), auth.uid()
  )
  on conflict (participant_record_id) do nothing
  returning id into v_operation_id;

  if v_operation_id is null then
    select id into v_operation_id
    from public.creative_payment_operations
    where participant_record_id = v_acceptance.id;
  end if;

  return v_operation_id;
end;
$$;

create or replace function public.rois_create_payment_after_quote_acceptance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(new.quote_status, '')) = 'accepted'
     and coalesce(new.agreed_amount, 0) > 0
     and (
       tg_op = 'INSERT'
       or lower(coalesce(old.quote_status, '')) <> 'accepted'
       or old.agreed_amount is distinct from new.agreed_amount
     ) then
    perform public.create_creative_payment_operation(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists brand_growth_create_payment_after_acceptance on public.brand_growth_participants;
create trigger brand_growth_create_payment_after_acceptance
after insert or update of quote_status, agreed_amount on public.brand_growth_participants
for each row execute function public.rois_create_payment_after_quote_acceptance();

-- Backfill only valid historical acceptances. The unique constraint makes this safe to rerun.
insert into public.creative_payment_operations (
  participant_record_id, campaign_id, profile_id, company_id,
  gross_amount, rois_fee_rate, rois_fee_amount, participant_net_amount,
  currency, payment_status, created_by, updated_by
)
select
  acceptance.id,
  campaign.id,
  payee.profile_id,
  campaign.company_id,
  acceptance.agreed_amount,
  0.3000,
  0,
  0,
  coalesce(nullif(upper(trim(acceptance.currency)), ''), 'MXN'),
  'pending_link',
  null,
  null
from public.brand_growth_participants acceptance
join public.brand_growth_campaigns campaign on campaign.id = acceptance.campaign_id
join public.brand_growth_participants payee
  on payee.campaign_id = acceptance.campaign_id
  and payee.profile_id = acceptance.paired_with_id
  and payee.paired_with_id = acceptance.profile_id
  and lower(coalesce(payee.quote_status, '')) = 'quoted'
where lower(coalesce(acceptance.quote_status, '')) = 'accepted'
  and coalesce(acceptance.agreed_amount, 0) > 0
on conflict (participant_record_id) do nothing;

create or replace function public.rois_lock_paid_creative_quote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.creative_payment_operations o where o.participant_record_id = old.id
  ) and (
    old.campaign_id is distinct from new.campaign_id
    or old.profile_id is distinct from new.profile_id
    or old.paired_with_id is distinct from new.paired_with_id
    or old.quote_status is distinct from new.quote_status
    or old.agreed_amount is distinct from new.agreed_amount
    or old.currency is distinct from new.currency
  ) then
    raise exception 'La cotizacion original esta bloqueada porque ya tiene una operacion de pago.' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists brand_growth_lock_paid_quote on public.brand_growth_participants;
create trigger brand_growth_lock_paid_quote
before update on public.brand_growth_participants
for each row execute function public.rois_lock_paid_creative_quote();

create or replace function public.admin_update_creative_payment_operation(
  p_operation_id uuid,
  p_payment_link text,
  p_payment_status text,
  p_admin_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := lower(trim(coalesce(p_payment_status, '')));
begin
  if not public.rois_creative_payments_is_admin() then
    raise exception 'Solo Administracion puede modificar operaciones de pago.' using errcode = '42501';
  end if;
  if v_status not in ('pending_link', 'payment_enabled', 'paid', 'cancelled', 'disputed') then
    raise exception 'Estado de pago no valido.' using errcode = '22023';
  end if;
  if v_status = 'payment_enabled' and not public.valid_creative_payment_link(p_payment_link) then
    raise exception 'Se requiere un enlace HTTPS valido para habilitar el pago.' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_payment_link, '')), '') is not null
     and not public.valid_creative_payment_link(p_payment_link) then
    raise exception 'El enlace de pago debe ser una URL HTTPS valida.' using errcode = '22023';
  end if;

  update public.creative_payment_operations
  set
    payment_link = nullif(trim(coalesce(p_payment_link, '')), ''),
    payment_status = v_status,
    admin_notes = nullif(trim(coalesce(p_admin_notes, '')), ''),
    payment_enabled_at = case
      when v_status = 'payment_enabled' then coalesce(payment_enabled_at, now())
      when v_status = 'pending_link' then null
      else payment_enabled_at
    end,
    paid_at = case when v_status = 'paid' then coalesce(paid_at, now()) else paid_at end,
    updated_by = auth.uid()
  where id = p_operation_id;

  if not found then
    raise exception 'No existe la operacion indicada.' using errcode = 'P0002';
  end if;
  return p_operation_id;
end;
$$;

create or replace function public.list_creative_payment_operations()
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_is_admin boolean := public.rois_creative_payments_is_admin();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  return query
  select jsonb_strip_nulls(jsonb_build_object(
    'id', o.id,
    'participant_record_id', o.participant_record_id,
    'campaign_id', o.campaign_id,
    'profile_id', o.profile_id,
    'company_id', o.company_id,
    'campaign_title', c.title,
    'company_name', co.name,
    'participant_name', coalesce(nullif(payee.name, ''), nullif(a.name, ''), nullif(f.public_name, ''), f.name, 'Participante ROIS'),
    'profile_table', payee.profile_table,
    'gross_amount', o.gross_amount,
    'rois_fee_rate', case when v_is_admin or o.profile_id = auth.uid() or lower(coalesce(payee.email, '')) = v_email then o.rois_fee_rate else null end,
    'rois_fee_amount', case when v_is_admin or o.profile_id = auth.uid() or lower(coalesce(payee.email, '')) = v_email then o.rois_fee_amount else null end,
    'participant_net_amount', case when v_is_admin or o.profile_id = auth.uid() or lower(coalesce(payee.email, '')) = v_email then o.participant_net_amount else null end,
    'currency', o.currency,
    'payment_link', case when o.payment_status in ('payment_enabled', 'paid') then o.payment_link when v_is_admin then o.payment_link else null end,
    'payment_link_saved', case when v_is_admin then o.payment_link is not null when o.profile_id = auth.uid() or lower(coalesce(payee.email, '')) = v_email then o.payment_link is not null else null end,
    'payment_status', o.payment_status,
    'admin_notes', case when v_is_admin then o.admin_notes else null end,
    'payment_enabled_at', o.payment_enabled_at,
    'paid_at', o.paid_at,
    'created_at', o.created_at,
    'updated_at', o.updated_at
  ))
  from public.creative_payment_operations o
  join public.brand_growth_campaigns c on c.id = o.campaign_id
  join public.brand_growth_participants payee
    on payee.campaign_id = o.campaign_id and payee.profile_id = o.profile_id
  left join public.companies co on co.id = o.company_id
  left join public.athletes a on payee.profile_table = 'athletes' and a.id = payee.profile_record_id
  left join public.founders f on payee.profile_table = 'founders' and f.id = payee.profile_record_id
  where
    v_is_admin
    or o.profile_id = auth.uid()
    or lower(coalesce(payee.email, '')) = v_email
    or exists (
      select 1 from public.companies own_company
      where own_company.id = o.company_id
        and (own_company.profile_id = auth.uid() or lower(coalesce(own_company.contact, '')) = v_email)
    )
  order by o.created_at desc;
end;
$$;

alter table public.creative_payment_operations enable row level security;

drop policy if exists "creative payments admin read" on public.creative_payment_operations;
create policy "creative payments admin read"
on public.creative_payment_operations for select to authenticated
using (public.rois_creative_payments_is_admin());

drop policy if exists "creative payments participant read" on public.creative_payment_operations;
create policy "creative payments participant read"
on public.creative_payment_operations for select to authenticated
using (
  profile_id = auth.uid()
  or exists (
    select 1 from public.brand_growth_participants p
    where p.campaign_id = creative_payment_operations.campaign_id
      and p.profile_id = creative_payment_operations.profile_id
      and lower(coalesce(p.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
);

drop policy if exists "creative payments company read" on public.creative_payment_operations;
create policy "creative payments company read"
on public.creative_payment_operations for select to authenticated
using (
  exists (
    select 1 from public.companies c
    where c.id = creative_payment_operations.company_id
      and (c.profile_id = auth.uid() or lower(coalesce(c.contact, '')) = lower(coalesce(auth.jwt() ->> 'email', '')))
  )
);

drop policy if exists "creative payments admin insert" on public.creative_payment_operations;
create policy "creative payments admin insert"
on public.creative_payment_operations for insert to authenticated
with check (public.rois_creative_payments_is_admin());

drop policy if exists "creative payments admin update" on public.creative_payment_operations;
create policy "creative payments admin update"
on public.creative_payment_operations for update to authenticated
using (public.rois_creative_payments_is_admin())
with check (public.rois_creative_payments_is_admin());

revoke all on table public.creative_payment_operations from public, anon, authenticated;
revoke all on function public.create_creative_payment_operation(uuid) from public, anon;
revoke all on function public.admin_update_creative_payment_operation(uuid, text, text, text) from public, anon;
revoke all on function public.list_creative_payment_operations() from public, anon;
grant execute on function public.create_creative_payment_operation(uuid) to authenticated;
grant execute on function public.admin_update_creative_payment_operation(uuid, text, text, text) to authenticated;
grant execute on function public.list_creative_payment_operations() to authenticated;

commit;

-- Verification (read-only).
select
  to_regclass('public.creative_payment_operations') as payment_operations_table,
  has_function_privilege('authenticated', 'public.create_creative_payment_operation(uuid)', 'EXECUTE') as create_rpc,
  has_function_privilege('authenticated', 'public.list_creative_payment_operations()', 'EXECUTE') as list_rpc,
  has_function_privilege('authenticated', 'public.admin_update_creative_payment_operation(uuid,text,text,text)', 'EXECUTE') as admin_update_rpc;
