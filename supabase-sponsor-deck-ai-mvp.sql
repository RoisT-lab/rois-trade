-- ROIS Sponsor Deck AI MVP
-- Additive and idempotent. Run in Supabase SQL Editor before deploying app.js.

begin;

alter table if exists public.athletes
  add column if not exists sponsor_deck jsonb not null default '{}'::jsonb,
  add column if not exists sponsor_deck_status text not null default 'draft',
  add column if not exists sponsor_deck_score integer not null default 0,
  add column if not exists sponsor_deck_updated_at timestamptz;

alter table if exists public.founders
  add column if not exists sponsor_deck jsonb not null default '{}'::jsonb,
  add column if not exists sponsor_deck_status text not null default 'draft',
  add column if not exists sponsor_deck_score integer not null default 0,
  add column if not exists sponsor_deck_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'athletes_sponsor_deck_score_range'
  ) then
    alter table public.athletes
      add constraint athletes_sponsor_deck_score_range
      check (sponsor_deck_score between 0 and 100);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'founders_sponsor_deck_score_range'
  ) then
    alter table public.founders
      add constraint founders_sponsor_deck_score_range
      check (sponsor_deck_score between 0 and 100);
  end if;
end $$;

create index if not exists idx_athletes_sponsor_deck_ready
  on public.athletes (sponsor_deck_status, sponsor_deck_score desc)
  where sponsor_deck_status = 'ready';

create index if not exists idx_founders_sponsor_deck_ready
  on public.founders (sponsor_deck_status, sponsor_deck_score desc)
  where sponsor_deck_status = 'ready';

commit;

select 'athletes' as profile_type, count(*) as ready_decks
from public.athletes
where sponsor_deck_status = 'ready'
union all
select 'founders', count(*)
from public.founders
where sponsor_deck_status = 'ready';
