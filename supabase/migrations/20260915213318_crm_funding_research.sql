-- Research v1: private answers attached to CRM, capability-based respondent submission.
-- No existing CRM records, stages, notes, invitations or emails are changed.
create schema if not exists rois_research_private;
revoke all on schema rois_research_private from public;
grant usage on schema rois_research_private to anon, authenticated;

create table public.research_invitations (
  id uuid primary key default gen_random_uuid(),
  crm_id uuid not null unique references public.crm(id) on delete restrict,
  token_hash text not null unique,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  responded_at timestamptz
);
create table public.research_responses (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null unique references public.research_invitations(id) on delete restrict,
  crm_id uuid not null unique references public.crm(id) on delete restrict,
  version integer not null check (version = 1),
  language text not null check (language in ('es','en')),
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  consent_at timestamptz not null default now(),
  contact_consent boolean not null default false,
  created_at timestamptz not null default now()
);
create index research_responses_created_idx on public.research_responses(created_at desc);
alter table public.research_invitations enable row level security;
alter table public.research_responses enable row level security;
revoke all on public.research_invitations, public.research_responses from public, anon, authenticated;
grant select on public.research_invitations, public.research_responses to authenticated;

create or replace function rois_research_private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles p where p.id=auth.uid() and p.role='admin' and p.status='approved'
  );
$$;
revoke all on function rois_research_private.is_admin() from public;
grant execute on function rois_research_private.is_admin() to authenticated;
create policy research_admin_read on public.research_invitations for select to authenticated
  using ((select rois_research_private.is_admin()));
create policy research_admin_read on public.research_responses for select to authenticated
  using ((select rois_research_private.is_admin()));

-- Privileged internals are outside exposed schemas. Every admin operation checks auth.uid().
create or replace function rois_research_private.create_invitation(p_crm_id uuid, p_company text, p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_crm uuid := p_crm_id; v_token text; v_inv uuid; v_expires timestamptz := now()+interval '30 days';
begin
  if not rois_research_private.is_admin() then raise exception 'admin_required' using errcode='42501'; end if;
  if v_crm is null then
    if p_company is null or length(trim(p_company)) not between 1 and 180
      or p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      then raise exception 'invalid_payload'; end if;
    perform pg_advisory_xact_lock(hashtextextended('research-email:'||lower(trim(p_email)),0));
    if exists(select 1 from public.crm where lower(email)=lower(trim(p_email))) then raise exception 'duplicate_email'; end if;
    insert into public.crm(name,organization,email,prospect_type,source,status,created_by)
      values(trim(p_company),trim(p_company),lower(trim(p_email)),'company','funding_research_v1','Nuevo',auth.uid()) returning id into v_crm;
  else
    perform 1 from public.crm where id=v_crm and prospect_type='company' for update;
    if not found then raise exception 'invalid_payload'; end if;
  end if;
  if exists(select 1 from public.research_responses where crm_id=v_crm) then raise exception 'already_answered'; end if;
  -- Two random UUIDs provide 244 random bits. Only a SHA-256 digest is persisted.
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text,'-','');
  insert into public.research_invitations(crm_id,token_hash,created_by,expires_at)
    values(v_crm,encode(sha256(convert_to(v_token,'UTF8')),'hex'),auth.uid(),v_expires)
    on conflict(crm_id) do update set token_hash=excluded.token_hash,created_by=excluded.created_by,
      created_at=now(),expires_at=excluded.expires_at
    where public.research_invitations.responded_at is null
    returning id into v_inv;
  if v_inv is null then raise exception 'already_answered'; end if;
  return jsonb_build_object('token',v_token,'crm_id',v_crm,'invitation_id',v_inv,'expires_at',v_expires);
end;
$$;
revoke all on function rois_research_private.create_invitation(uuid,text,text) from public;
grant execute on function rois_research_private.create_invitation(uuid,text,text) to authenticated;
create or replace function public.rois_create_research_invitation(p_crm_id uuid default null,p_company text default '',p_email text default '')
returns jsonb language sql security invoker set search_path = '' as $$
  select rois_research_private.create_invitation(p_crm_id,p_company,p_email);
$$;
revoke all on function public.rois_create_research_invitation(uuid,text,text) from public,anon;
grant execute on function public.rois_create_research_invitation(uuid,text,text) to authenticated;

-- Anonymous respondents authenticate by a high-entropy, expiring, single-response capability.
-- No lookup endpoint, public table reads, client-selected CRM id or email-based merge exists.
create or replace function rois_research_private.submit(p_token text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_inv public.research_invitations; v_old public.research_responses; a jsonb; k text; choices jsonb;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'invalid_token'; end if;
  select * into v_inv from public.research_invitations
    where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
  if not found or v_inv.expires_at < now() then raise exception 'invalid_token_or_expired'; end if;
  if p_payload is null or octet_length(p_payload::text)>35000 or jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload->'version' is distinct from '1'::jsonb or p_payload->'consent' is distinct from 'true'::jsonb
    or jsonb_typeof(p_payload->'contact_consent') is distinct from 'boolean'
    or coalesce(p_payload->>'language','') not in ('es','en')
    or jsonb_typeof(p_payload->'answers') is distinct from 'object' then raise exception 'invalid_payload'; end if;
  a := p_payload->'answers';
  foreach k in array array['company','respondent','role','country','sector','business_model','stage','funding_type','funding_recency','objective','obstacle','impact','attempts','current_solution','decision_maker','category','budget','urgency'] loop
    if jsonb_typeof(a->k) is distinct from 'string' or length(trim(a->>k))=0 or length(a->>k)>2000 then raise exception 'invalid_payload: %',k; end if;
  end loop;
  if length(a->>'company')>180 or length(a->>'respondent')>160 or length(a->>'role')>160 or length(a->>'country')>100 or length(a->>'sector')>160 then raise exception 'invalid_payload'; end if;
  if a ? 'funding_amount' and (jsonb_typeof(a->'funding_amount') is distinct from 'string' or length(a->>'funding_amount')>40) then raise exception 'invalid_payload'; end if;
  if exists(select 1 from jsonb_object_keys(a) t(key) where key <> all(array['company','respondent','role','country','sector','business_model','stage','funding_type','funding_recency','funding_amount','objective','obstacle','impact','attempts','current_solution','decision_maker','category','budget','urgency'])) then raise exception 'invalid_payload'; end if;
  choices := '{"business_model":["b2b","b2c","b2b2c","other"],"stage":["pre_revenue","early_revenue","growth","established"],"funding_type":["equity","debt","mixed","other","none"],"funding_recency":["0_3","4_6","7_12","over_12","na"],"funding_amount":["","under_250k","250k_1m","1m_5m","5m_20m","over_20m","undisclosed"],"category":["customers","expansion","operations","talent","product","finance","compliance","other","none","unknown"],"budget":["approved","pending","none","unknown"],"urgency":["30d","90d","180d","later","none"]}'::jsonb;
  for k in select jsonb_object_keys(choices) loop
    if not (choices->k ? coalesce(a->>k,'')) then raise exception 'invalid_payload: %',k; end if;
  end loop;
  if a->>'funding_type'='none' and a->>'funding_recency'<>'na' then raise exception 'invalid_payload'; end if;
  select * into v_old from public.research_responses where invitation_id=v_inv.id;
  if found then
    if v_old.answers=a and v_old.language=p_payload->>'language' and v_old.contact_consent=(p_payload->>'contact_consent')::boolean then
      return jsonb_build_object('status','saved'); -- safe retry after a lost network response
    end if;
    raise exception 'already_answered';
  end if;
  insert into public.research_responses(invitation_id,crm_id,version,language,answers,contact_consent)
    values(v_inv.id,v_inv.crm_id,1,p_payload->>'language',a,(p_payload->>'contact_consent')::boolean);
  update public.research_invitations set responded_at=now() where id=v_inv.id;
  return jsonb_build_object('status','saved');
end;
$$;
revoke all on function rois_research_private.submit(text,jsonb) from public;
grant execute on function rois_research_private.submit(text,jsonb) to anon,authenticated;
create or replace function public.rois_submit_research(p_token text,p_payload jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select rois_research_private.submit(p_token,p_payload);
$$;
revoke all on function public.rois_submit_research(text,jsonb) from public;
grant execute on function public.rois_submit_research(text,jsonb) to anon,authenticated;
comment on table public.research_responses is 'Funding research v1. Admin-only identified responses; external results must be aggregated. Contact opt-in is separate from research consent.';
