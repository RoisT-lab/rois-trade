-- ROIS Admin Growth Control
-- Run once in Supabase SQL Editor as postgres.

create index if not exists idx_profiles_growth_created_at on public.profiles (created_at desc);
create index if not exists idx_profiles_growth_status on public.profiles (status);
create index if not exists idx_companies_growth_created_at on public.companies (created_at desc);
create index if not exists idx_athletes_growth_status_visual on public.athletes (status, visual_status);
create index if not exists idx_athletes_growth_scout on public.athletes (scout_active, invited_by_scout_code);
create index if not exists idx_founders_growth_status_visual on public.founders (status, visual_status);
create index if not exists idx_founders_growth_scout on public.founders (scout_active, invited_by_scout_code);
create index if not exists idx_events_growth_status_visual on public.events (status, visual_status);
create index if not exists idx_sponsorships_growth_status on public.sponsorships (status);
create index if not exists idx_payments_growth_status_product on public.payments (status, product_key);
create index if not exists idx_company_subscriptions_growth_plan on public.company_subscriptions (status, plan);
create index if not exists idx_company_listings_growth_status on public.company_listings (status, visual_status);
create index if not exists idx_marketplace_leads_growth_status on public.marketplace_leads (status);

create or replace function public.admin_growth_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not exists (
    select 1
    from public.profiles p
    where p.role = 'admin'
      and (
        p.id = auth.uid()
        or lower(coalesce(p.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
  ) then
    raise exception 'ROIS admin access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'generatedAt', now(),
    'exact', true,
    'totalProfiles', (select count(*) from public.profiles),
    'totalCompanies', (select count(*) from public.companies where coalesce(status, '') <> 'deleted'),
    'totalAthletes', (select count(*) from public.athletes where coalesce(status, '') <> 'deleted'),
    'totalCreators', (select count(*) from public.founders where coalesce(status, '') <> 'deleted'),
    'registrations24h', (select count(*) from public.profiles where created_at >= now() - interval '24 hours'),
    'registrations7d', (select count(*) from public.profiles where created_at >= now() - interval '7 days'),
    'registrations30d', (select count(*) from public.profiles where created_at >= now() - interval '30 days'),
    'talent7d', (
      (select count(*) from public.athletes where created_at >= now() - interval '7 days') +
      (select count(*) from public.founders where created_at >= now() - interval '7 days')
    ),
    'companies7d', (select count(*) from public.companies where created_at >= now() - interval '7 days'),
    'accountLocations', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'location', geo.location,
            'type', geo.account_type,
            'count', geo.account_count,
            'latestAt', geo.latest_at
          )
          order by geo.account_count desc, geo.latest_at desc
        ),
        '[]'::jsonb
      )
      from (
        select
          located.location,
          located.account_type,
          count(*) as account_count,
          max(located.created_at) as latest_at
        from (
          select nullif(trim(location), '') as location, 'Athlete'::text as account_type, created_at
          from public.athletes
          where nullif(trim(location), '') is not null
            and coalesce(status, '') <> 'deleted'
          union all
          select nullif(trim(city), '') as location, 'Creador'::text as account_type, created_at
          from public.founders
          where nullif(trim(city), '') is not null
            and coalesce(status, '') <> 'deleted'
        ) located
        group by located.location, located.account_type
        order by account_count desc, latest_at desc
        limit 250
      ) geo
    ),
    'publicAthletes', (select count(*) from public.athletes where status = 'approved' and visual_status = 'approved'),
    'publicCreators', (select count(*) from public.founders where status = 'approved' and visual_status = 'approved'),
    'deckReady', (
      (select count(*) from public.athletes where status = 'approved' and visual_status = 'approved' and sponsor_deck_status = 'ready') +
      (select count(*) from public.founders where status = 'approved' and visual_status = 'approved' and sponsor_deck_status = 'ready')
    ),
    'activeScouts', (
      (select count(*) from public.athletes where scout_active is true and coalesce(status, '') not in ('blocked', 'deleted', 'rejected')) +
      (select count(*) from public.founders where scout_active is true and coalesce(status, '') not in ('blocked', 'deleted', 'rejected'))
    ),
    'referrals', (
      (select count(*) from public.athletes where nullif(trim(invited_by_scout_code), '') is not null) +
      (select count(*) from public.founders where nullif(trim(invited_by_scout_code), '') is not null)
    ),
    'validatedReferrals', (
      (select count(*) from public.athletes where nullif(trim(invited_by_scout_code), '') is not null and (scout_validation_status in ('validated', 'approved') or scout_commission_status in ('approved', 'paid'))) +
      (select count(*) from public.founders where nullif(trim(invited_by_scout_code), '') is not null and (scout_validation_status in ('validated', 'approved') or scout_commission_status in ('approved', 'paid')))
    ),
    'sponsorshipRequests', (
      select count(*)
      from public.sponsorships
      where coalesce(status, '') in ('review', 'payment_started', 'approved', 'active', 'paid')
    ),
    'activeSponsorships', (
      select count(*)
      from public.sponsorships
      where coalesce(status, '') in ('payment_started', 'approved', 'active', 'paid')
    ),
    'sponsorshipPipelineValue', (
      select coalesce(sum(amount), 0)
      from public.sponsorships
      where coalesce(status, '') in ('payment_started', 'approved', 'active', 'paid')
    ),
    'listingsLive', (select count(*) from public.company_listings where status = 'approved' and visual_status = 'approved'),
    'marketplaceLeads', (select count(*) from public.marketplace_leads),
    'closedLeads', (select count(*) from public.marketplace_leads where status = 'closed'),
    'pendingEvents', (select count(*) from public.events where status = 'pending' or visual_status = 'pending_review'),
    'activePro', (select count(*) from public.company_subscriptions where plan = 'pro' and status in ('active', 'trialing')),
    'activeBusiness', (select count(*) from public.company_subscriptions where plan = 'business' and status in ('active', 'trialing')),
    'paidRevenue', (select coalesce(sum(amount), 0) from public.payments where status = 'paid' and coalesce(product_key, '') not in ('manualExpense', 'fixedExpense')),
    'pendingRevenue', (select coalesce(sum(amount), 0) from public.payments where status <> 'paid' and coalesce(status, '') <> 'deleted' and coalesce(product_key, '') not in ('manualExpense', 'fixedExpense')),
    'financialCandles', (
      with days as (
        select generate_series(current_date - 29, current_date, interval '1 day')::date as day
      ),
      daily as (
        select
          d.day,
          coalesce(sum(
            case
              when p.status = 'paid' and coalesce(p.product_key, '') not in ('manualExpense', 'fixedExpense')
              then coalesce(p.amount, 0)
              else 0
            end
          ), 0)::numeric as income,
          coalesce(sum(
            case
              when p.status = 'paid' and coalesce(p.product_key, '') in ('manualExpense', 'fixedExpense')
              then coalesce(p.amount, 0)
              else 0
            end
          ), 0)::numeric as expense
        from days d
        left join public.payments p
          on p.created_at >= d.day
         and p.created_at < d.day + interval '1 day'
        group by d.day
      ),
      running as (
        select
          day,
          income,
          expense,
          coalesce(
            sum(income - expense) over (
              order by day
              rows between unbounded preceding and 1 preceding
            ),
            0
          )::numeric as open_value
        from daily
      )
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'date', day,
            'open', open_value,
            'high', open_value + income,
            'low', open_value - expense,
            'close', open_value + income - expense,
            'income', income,
            'expense', expense
          )
          order by day
        ),
        '[]'::jsonb
      )
      from running
    ),
    'pendingProfiles', (
      (select count(*) from public.profiles where status = 'pending') +
      (select count(*) from public.companies where status = 'pending')
    ),
    'pendingVisualTalent', (
      (select count(*) from public.athletes where status = 'pending' or visual_status = 'pending_review') +
      (select count(*) from public.founders where status = 'pending' or visual_status = 'pending_review')
    ),
    'pendingListings', (select count(*) from public.company_listings where status = 'pending' or visual_status = 'pending_review'),
    'sponsorReviews', (select count(*) from public.sponsorships where status = 'review'),
    'planRequests', (select count(*) from public.requests where type = 'Plan empresarial' and coalesce(status, '') <> 'closed'),
    'profileAlerts', (
      (select count(*) from public.athletes where profile_id is null or email is null or status is null or visual_status is null) +
      (select count(*) from public.founders where profile_id is null or email is null or status is null or visual_status is null)
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_growth_snapshot() from public;
grant execute on function public.admin_growth_snapshot() to authenticated;

comment on function public.admin_growth_snapshot() is
  'Exact aggregate metrics for the ROIS Admin growth control. Admin-only and read-only.';

-- The application invokes the function with the authenticated admin JWT.
-- Do not call it from SQL Editor: auth.uid() is intentionally unavailable there.
