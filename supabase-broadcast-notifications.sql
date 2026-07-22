begin;

alter table public.athlete_notifications
  add column if not exists broadcast_id uuid,
  add column if not exists recipient_type text not null default 'athlete';

create index if not exists athlete_notifications_broadcast_idx
  on public.athlete_notifications (broadcast_id, created_at desc);

create table if not exists public.notification_email_queue (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid,
  notification_id uuid not null unique references public.athlete_notifications(id) on delete cascade,
  recipient_email text not null,
  recipient_name text,
  subject text not null,
  message text,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'email_error')),
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notification_email_queue_processing_idx
  on public.notification_email_queue (status, attempts, created_at);
create index if not exists notification_email_queue_broadcast_idx
  on public.notification_email_queue (broadcast_id, status);

alter table public.notification_email_queue enable row level security;

drop policy if exists "notification email queue admin read" on public.notification_email_queue;
create policy "notification email queue admin read"
on public.notification_email_queue for select to authenticated
using (public.is_admin());

grant select on public.notification_email_queue to authenticated;

create or replace function public.queue_rois_notification_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email_status = 'queued' and nullif(trim(new.athlete_email), '') is not null then
    insert into public.notification_email_queue (
      broadcast_id, notification_id, recipient_email, recipient_name, subject, message
    ) values (
      new.broadcast_id, new.id, lower(trim(new.athlete_email)), new.athlete_name, new.title, new.message
    ) on conflict (notification_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists athlete_notification_email_queue_trigger on public.athlete_notifications;
create trigger athlete_notification_email_queue_trigger
after insert on public.athlete_notifications
for each row execute function public.queue_rois_notification_email();

create or replace function public.admin_broadcast_notification(
  p_audience text,
  p_title text,
  p_message text,
  p_category text default 'sistema',
  p_priority text default 'normal'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_broadcast_id uuid := gen_random_uuid();
  v_recipient_count integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Solo administracion puede enviar comunicados colectivos.' using errcode = '42501';
  end if;
  if p_audience not in ('athletes', 'creators', 'all_talent') then
    raise exception 'Audiencia no valida.' using errcode = '22023';
  end if;
  if nullif(trim(p_title), '') is null or nullif(trim(p_message), '') is null then
    raise exception 'Asunto y mensaje son obligatorios.' using errcode = '22023';
  end if;

  with candidates as (
    select a.id as recipient_id, lower(trim(a.email)) as email, a.name, 'athlete'::text as recipient_type
    from public.athletes a
    where p_audience in ('athletes', 'all_talent')
      and nullif(trim(a.email), '') is not null
      and lower(coalesce(a.status, 'approved')) not in ('blocked', 'deleted', 'rejected')
    union all
    select f.id, lower(trim(f.email)), coalesce(nullif(trim(f.public_name), ''), f.name), 'creator'::text
    from public.founders f
    where p_audience in ('creators', 'all_talent')
      and nullif(trim(f.email), '') is not null
      and lower(coalesce(f.status, 'approved')) not in ('blocked', 'deleted', 'rejected')
  ), recipients as (
    select distinct on (email) recipient_id, email, name, recipient_type
    from candidates
    order by email, recipient_type
  ), inserted as (
    insert into public.athlete_notifications (
      broadcast_id, recipient_type, athlete_id, athlete_email, athlete_name,
      title, message, category, priority, status, email_status, sent_by, created_at
    )
    select
      v_broadcast_id, recipient_type, recipient_id, email, name,
      trim(p_title), trim(p_message), coalesce(nullif(trim(p_category), ''), 'sistema'),
      coalesce(nullif(trim(p_priority), ''), 'normal'), 'unread', 'queued',
      coalesce(auth.jwt() ->> 'email', 'admin'), now()
    from recipients
    returning id
  )
  select count(*) into v_recipient_count from inserted;

  return jsonb_build_object('broadcastId', v_broadcast_id, 'recipientCount', v_recipient_count);
end;
$$;

revoke all on function public.admin_broadcast_notification(text, text, text, text, text) from public, anon;
grant execute on function public.admin_broadcast_notification(text, text, text, text, text) to authenticated;

commit;

select
  to_regclass('public.notification_email_queue') as email_queue,
  has_function_privilege('authenticated', 'public.admin_broadcast_notification(text,text,text,text,text)', 'EXECUTE') as authenticated_can_execute;
