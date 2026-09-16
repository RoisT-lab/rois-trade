-- Recoverable links are private: never returned by CRM/list queries or readable by clients.
create table if not exists rois_research_private.invitation_links (
  invitation_id uuid primary key references public.research_invitations(id) on delete cascade,
  token text not null check (token ~ '^[a-f0-9]{64}$')
);
alter table rois_research_private.invitation_links enable row level security;
revoke all on rois_research_private.invitation_links from public, anon, authenticated;
create policy invitation_links_no_client_access on rois_research_private.invitation_links
  for all to anon, authenticated using (false) with check (false);

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
  insert into rois_research_private.invitation_links(invitation_id,token)
    values(v_inv,v_token) on conflict(invitation_id) do update set token=excluded.token;
  return jsonb_build_object('token',v_token,'crm_id',v_crm,'invitation_id',v_inv,'expires_at',v_expires);
end;
$$;
revoke all on function rois_research_private.create_invitation(uuid,text,text) from public;
grant execute on function rois_research_private.create_invitation(uuid,text,text) to authenticated;

create or replace function rois_research_private.get_invitation_link(p_crm_id uuid,p_replace boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_inv public.research_invitations; v_token text; v_result jsonb; v_name text;
begin
  if not rois_research_private.is_admin() then raise exception 'admin_required' using errcode='42501';end if;
  -- Consistent lock ordering with the creation helper: CRM, then invitation.
  select name into v_name from public.crm where id=p_crm_id and prospect_type='company' for update;
  if not found then raise exception 'invalid_payload';end if;
  select * into v_inv from public.research_invitations where crm_id=p_crm_id for update;
  if v_inv.id is not null then
    select token into v_token from rois_research_private.invitation_links where invitation_id=v_inv.id;
    if v_token is not null and v_inv.expires_at>now()
      and encode(sha256(convert_to(v_token,'UTF8')),'hex')=v_inv.token_hash then
      return jsonb_build_object('token',v_token,'crm_id',p_crm_id,'expires_at',v_inv.expires_at,'answered',v_inv.responded_at is not null);
    end if;
    if v_inv.responded_at is not null or exists(select 1 from public.research_responses where crm_id=p_crm_id) then
      raise exception 'already_answered';
    end if;
  end if;
  if not coalesce(p_replace,false) then raise exception 'link_unavailable';end if;
  -- Explicit repair only: replaces an expired or historical non-recoverable capability.
  v_result := rois_research_private.create_invitation(p_crm_id,'','');
  update public.research_invitations set recipient_name=coalesce(nullif(recipient_name,''),left(v_name,160))
    where id=(v_result->>'invitation_id')::uuid;
  return v_result;
end;
$$;
revoke all on function rois_research_private.get_invitation_link(uuid,boolean) from public,anon;
grant execute on function rois_research_private.get_invitation_link(uuid,boolean) to authenticated;
create or replace function public.rois_get_research_invitation_link(p_crm_id uuid,p_replace boolean default false)
returns jsonb language sql security invoker set search_path = '' as $$
  select rois_research_private.get_invitation_link(p_crm_id,p_replace);
$$;
revoke all on function public.rois_get_research_invitation_link(uuid,boolean) from public,anon;
grant execute on function public.rois_get_research_invitation_link(uuid,boolean) to authenticated;
