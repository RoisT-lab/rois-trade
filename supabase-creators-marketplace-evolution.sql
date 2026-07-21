-- ROIS Creator Marketplace evolution.
-- Additive and idempotent: preserves every existing founder record.
-- Run once in the Supabase SQL Editor after the founders table exists.

begin;

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
alter table public.founders add column if not exists invited_by_scout_code text;
alter table public.founders add column if not exists scout_validation_status text default 'pending';
alter table public.founders add column if not exists scout_commission_status text default 'pending';

update public.founders
set
  creator_type = coalesce(nullif(creator_type, ''), 'founder'),
  public_name = coalesce(nullif(public_name, ''), name),
  content_categories = coalesce(nullif(content_categories, ''), nullif(industry, ''), 'Por definir'),
  availability = coalesce(nullif(availability, ''), 'available'),
  audience_size = greatest(coalesce(audience_size, 0), 0),
  engagement_rate = greatest(coalesce(engagement_rate, 0), 0);

alter table public.founders alter column creator_type set default 'founder';
alter table public.founders alter column audience_size set default 0;
alter table public.founders alter column engagement_rate set default 0;
alter table public.founders alter column availability set default 'available';

create index if not exists founders_creator_market_idx
  on public.founders (status, visual_status, creator_type, created_at desc);

create index if not exists founders_primary_platform_idx
  on public.founders (primary_platform)
  where primary_platform is not null and primary_platform <> '';

create index if not exists founders_invited_by_scout_code_idx
  on public.founders (invited_by_scout_code)
  where invited_by_scout_code is not null and invited_by_scout_code <> '';

create or replace function public.is_active_scout_code(code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text := regexp_replace(upper(coalesce(code, '')), '[^A-Z0-9]', '', 'g');
begin
  if normalized_code = '' then
    return false;
  end if;

  return exists (
    select 1
    from public.athletes
    where regexp_replace(upper(coalesce(scout_code, '')), '[^A-Z0-9]', '', 'g') = normalized_code
      and (scout_active = true or status = 'approved')
      and coalesce(status, 'pending') not in ('blocked', 'deleted', 'rejected')
  ) or exists (
    select 1
    from public.founders
    where regexp_replace(upper(coalesce(scout_code, '')), '[^A-Z0-9]', '', 'g') = normalized_code
      and (scout_active = true or status = 'approved')
      and coalesce(status, 'pending') not in ('blocked', 'deleted', 'rejected')
  );
end;
$$;

grant execute on function public.is_active_scout_code(text) to anon, authenticated;

create index if not exists founders_audience_size_idx
  on public.founders (audience_size desc)
  where status = 'approved' and visual_status = 'approved';

commit;

-- Verification: legacy records should remain and appear as creator_type founder.
select
  id,
  email,
  name,
  public_name,
  creator_type,
  primary_platform,
  audience_size,
  engagement_rate,
  status,
  visual_status
from public.founders
order by created_at desc;
