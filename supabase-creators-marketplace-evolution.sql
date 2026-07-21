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
