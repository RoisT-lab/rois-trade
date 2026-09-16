-- Additive change: name-based research invitations, keeping the original RPC compatible.
alter table public.research_invitations
  add column if not exists recipient_name text not null default ''
  check (length(recipient_name) <= 160);

create or replace function rois_research_private.create_named_invitation(
  p_crm_id uuid, p_company text, p_recipient_name text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_crm uuid := p_crm_id; v_result jsonb;
begin
  if not rois_research_private.is_admin() then
    raise exception 'admin_required' using errcode='42501';
  end if;
  if p_recipient_name is null or length(trim(p_recipient_name)) not between 1 and 160 then
    raise exception 'invalid_payload: recipient_name';
  end if;
  if v_crm is null then
    if p_company is null or length(trim(p_company)) not between 1 and 180 then
      raise exception 'invalid_payload: company';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('research-person:'||lower(trim(p_company))||':'||lower(trim(p_recipient_name)),0));
    -- Do not silently merge different people or rotate a link after an uncertain response.
    if exists(select 1 from public.crm where source='funding_research_v1'
      and lower(trim(organization))=lower(trim(p_company))
      and lower(trim(name))=lower(trim(p_recipient_name))) then
      raise exception 'duplicate_recipient';
    end if;
    insert into public.crm(name,organization,email,prospect_type,source,status,created_by)
      values(trim(p_recipient_name),trim(p_company),null,'company','funding_research_v1','Nuevo',auth.uid())
      returning id into v_crm;
  end if;
  -- The existing helper locks/validates the company, rejects answered invitations and rotates tokens.
  v_result := rois_research_private.create_invitation(v_crm,'','');
  update public.research_invitations set recipient_name=trim(p_recipient_name)
    where id=(v_result->>'invitation_id')::uuid;
  return v_result;
end;
$$;
revoke all on function rois_research_private.create_named_invitation(uuid,text,text) from public,anon;
grant execute on function rois_research_private.create_named_invitation(uuid,text,text) to authenticated;

create or replace function public.rois_create_named_research_invitation(
  p_crm_id uuid default null, p_company text default '', p_recipient_name text default ''
) returns jsonb language sql security invoker set search_path = '' as $$
  select rois_research_private.create_named_invitation(p_crm_id,p_company,p_recipient_name);
$$;
revoke all on function public.rois_create_named_research_invitation(uuid,text,text) from public,anon;
grant execute on function public.rois_create_named_research_invitation(uuid,text,text) to authenticated;
comment on column public.research_invitations.recipient_name is
  'Intended recipient supplied by an administrator. Not identity verification; email is not required.';
