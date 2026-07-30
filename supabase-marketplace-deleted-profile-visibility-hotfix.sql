begin;

-- A universal marketplace profile is publishable only while its base ROIS
-- profile still exists. This prevents deleted accounts from remaining visible
-- through an orphaned user_profiles mirror.
create or replace view public.marketplace_user_profiles as
select
  universal.id,
  universal.profile_id,
  universal.legacy_athlete_id,
  universal.legacy_founder_id,
  universal.name,
  universal.public_name,
  universal.image_url,
  universal.bio,
  universal.city,
  universal.state_region,
  universal.country,
  universal.languages,
  universal.availability,
  universal.capabilities,
  universal.interests,
  universal.industries,
  universal.sales_experience,
  universal.territories,
  universal.audience_size,
  universal.audience_description,
  universal.travel_availability,
  universal.can_invoice,
  universal.badges,
  universal.status,
  universal.visual_status,
  universal.verification_status,
  universal.scout_code,
  universal.scout_active,
  universal.created_at,
  universal.updated_at
from public.user_profiles universal
join public.profiles account on account.id = universal.profile_id
where universal.deleted_at is null
  and coalesce(lower(universal.status), 'active') not in ('blocked', 'deleted', 'rejected')
  and coalesce(lower(universal.visual_status), 'active') not in ('blocked', 'deleted', 'rejected')
  and coalesce(lower(account.status), 'active') not in ('blocked', 'deleted', 'rejected');

create or replace view public.marketplace_user_social_accounts as
select
  social.id,
  social.user_profile_id,
  social.platform,
  social.url,
  social.handle,
  social.audience_size,
  social.verified,
  social.created_at,
  social.updated_at
from public.user_social_accounts social
join public.user_profiles universal on universal.id = social.user_profile_id
join public.profiles account on account.id = universal.profile_id
where universal.deleted_at is null
  and coalesce(lower(universal.status), 'active') not in ('blocked', 'deleted', 'rejected')
  and coalesce(lower(universal.visual_status), 'active') not in ('blocked', 'deleted', 'rejected')
  and coalesce(lower(account.status), 'active') not in ('blocked', 'deleted', 'rejected');

revoke all on public.marketplace_user_profiles from public, anon;
revoke all on public.marketplace_user_social_accounts from public, anon;
grant select on public.marketplace_user_profiles to authenticated;
grant select on public.marketplace_user_social_accounts to authenticated;

commit;
