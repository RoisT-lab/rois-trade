-- ROIS hotfix: registro de deportistas por Scout y reparacion de ficha deportiva.
-- Ejecuta este archivo en Supabase SQL Editor.

create or replace function is_active_scout_code(code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text := regexp_replace(upper(coalesce(code, '')), '[^A-Z0-9]', '', 'g');
begin
  if normalized_code ~ '^ROIS[A-Z0-9]{6}$' then
    return true;
  end if;

  return exists (
    select 1
    from athletes
    where regexp_replace(
      upper(coalesce(nullif(athletes.scout_code, ''), rois_make_scout_code(athletes.name, athletes.email))),
      '[^A-Z0-9]',
      '',
      'g'
    ) = normalized_code
    and (athletes.scout_active = true or athletes.status = 'approved')
    and coalesce(athletes.status, 'pending') not in ('blocked', 'deleted', 'rejected')
  );
end;
$$;

drop policy if exists "athletes self insert pending" on athletes;
create policy "athletes self insert pending" on athletes
  for insert to authenticated
  with check (
    email = (auth.jwt() ->> 'email')
    and status in ('approved', 'pending')
    and (
      is_active_scout_code(invited_by_scout_code)
      or profile_id = auth.uid()
    )
  );

update profiles
set role = 'athlete',
    status = 'approved',
    name = 'Jafet Said Lira Reyes',
    must_change_password = false
where lower(email) = lower('saidr1521@gmail.com');

update athletes
set profile_id = p.id,
    name = coalesce(nullif(athletes.name, ''), 'Jafet Said Lira Reyes'),
    email = p.email,
    sport = coalesce(nullif(athletes.sport, ''), 'Golf competitivo'),
    category = coalesce(nullif(athletes.category, ''), 'Profesional'),
    location = coalesce(nullif(athletes.location, ''), 'Queretaro, Mexico'),
    monthly = coalesce(athletes.monthly, 5000),
    max_sponsors = coalesce(athletes.max_sponsors, 10),
    annual = 2500,
    annual_fee_required = false,
    scout_code = 'ROIS-IDO351',
    scout_active = true,
    annual_fee_paid = false,
    scout_validation_status = 'approved',
    scout_commission_status = 'pending',
    status = 'approved',
    visual_status = 'approved',
    terms_accepted = true
from profiles p
where lower(p.email) = lower('saidr1521@gmail.com')
  and lower(athletes.email) = lower('saidr1521@gmail.com');

insert into athletes (
  profile_id,
  email,
  name,
  sport,
  category,
  location,
  ranking,
  stats,
  annual,
  annual_fee_required,
  monthly,
  max_sponsors,
  scout_code,
  scout_active,
  annual_fee_paid,
  scout_validation_status,
  scout_commission_status,
  status,
  visual_status,
  terms_accepted
)
select
  p.id,
  p.email,
  'Jafet Said Lira Reyes',
  'Golf competitivo',
  'Profesional',
  'Queretaro, Mexico',
  'En evaluacion',
  '',
  2500,
  false,
  5000,
  10,
  'ROIS-IDO351',
  true,
  false,
  'approved',
  'pending',
  'approved',
  'approved',
  true
from profiles p
where lower(p.email) = lower('saidr1521@gmail.com')
  and not exists (
    select 1
    from athletes a
    where lower(a.email) = lower('saidr1521@gmail.com')
  );
