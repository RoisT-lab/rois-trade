-- ROIS Commercial CRM + automatic account invitations
-- Safe migration: preserves every existing CRM record.

begin;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'commercial', 'client', 'athlete', 'founder'));

alter table public.crm
  add column if not exists contact_name text,
  add column if not exists email text,
  add column if not exists prospect_type text,
  add column if not exists organization text,
  add column if not exists phone text,
  add column if not exists source text,
  add column if not exists notes text,
  add column if not exists scout_code text,
  add column if not exists invitation_status text not null default 'not_sent',
  add column if not exists invitation_sent_at timestamptz,
  add column if not exists invitation_attempts integer not null default 0,
  add column if not exists invitation_error text,
  add column if not exists last_contact_at timestamptz,
  add column if not exists next_follow_up_at timestamptz,
  add column if not exists created_by uuid,
  add column if not exists updated_at timestamptz not null default now();

alter table public.crm drop constraint if exists crm_prospect_type_check;
alter table public.crm
  add constraint crm_prospect_type_check
  check (prospect_type is null or prospect_type in ('company', 'creator', 'athlete'));

alter table public.crm drop constraint if exists crm_invitation_status_check;
alter table public.crm
  add constraint crm_invitation_status_check
  check (invitation_status in ('not_sent', 'queued', 'sending', 'sent', 'email_error'));

create index if not exists crm_email_lower_idx on public.crm (lower(email)) where email is not null;
create index if not exists crm_prospect_type_idx on public.crm (prospect_type, created_at desc);
create index if not exists crm_invitation_status_idx on public.crm (invitation_status, created_at desc);
create index if not exists crm_follow_up_idx on public.crm (next_follow_up_at) where next_follow_up_at is not null;

create or replace function public.is_commercial_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where (
      p.id = auth.uid()
      or lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
    and p.role in ('admin', 'commercial')
    and p.status = 'approved'
  );
$$;

revoke all on function public.is_commercial_operator() from public;
grant execute on function public.is_commercial_operator() to authenticated;

alter table public.crm enable row level security;

drop policy if exists "crm client insert" on public.crm;
drop policy if exists "crm commercial select" on public.crm;
drop policy if exists "crm commercial insert" on public.crm;
drop policy if exists "crm commercial update" on public.crm;

create policy "crm commercial select"
on public.crm
for select
to authenticated
using (public.is_commercial_operator());

create policy "crm commercial insert"
on public.crm
for insert
to authenticated
with check (public.is_commercial_operator());

create policy "crm commercial update"
on public.crm
for update
to authenticated
using (public.is_commercial_operator())
with check (public.is_commercial_operator());

grant select, insert, update on public.crm to authenticated;

commit;

-- AFTER creating the future sales user in Supabase Authentication, promote it once:
-- update public.profiles
-- set role = 'commercial', status = 'approved', must_change_password = false
-- where lower(email) = lower('sales-user@your-domain.com');

-- Verification:
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'crm'
order by ordinal_position;
