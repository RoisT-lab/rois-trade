-- ROIS dashboard data visibility hotfix
-- Run once in Supabase SQL Editor. This script does not delete data.

begin;

alter table public.payments enable row level security;

drop policy if exists "payments company read own" on public.payments;
create policy "payments company read own"
on public.payments
for select
to authenticated
using (
  exists (
    select 1
    from public.companies
    where lower(companies.contact) = lower(auth.jwt() ->> 'email')
      and lower(companies.name) = lower(payments.company)
  )
  or is_admin()
);

drop policy if exists "payments company insert own" on public.payments;
create policy "payments company insert own"
on public.payments
for insert
to authenticated
with check (
  status in ('pending', 'payment_started', 'review')
  and exists (
    select 1
    from public.companies
    where lower(companies.contact) = lower(auth.jwt() ->> 'email')
      and lower(companies.name) = lower(payments.company)
  )
);

commit;
