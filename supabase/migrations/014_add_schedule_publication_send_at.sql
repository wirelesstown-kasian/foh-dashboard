alter table public.schedule_publications
add column if not exists scheduled_send_at timestamptz;

update public.schedule_publications
set scheduled_send_at = ((scheduled_send_date::text || ' 09:00:00')::timestamp at time zone 'America/Chicago')
where scheduled_send_at is null;

alter table public.schedule_publications
alter column scheduled_send_at set not null;

create index if not exists schedule_publications_scheduled_send_at_idx
on public.schedule_publications(scheduled_send_at, email_sent_at);
