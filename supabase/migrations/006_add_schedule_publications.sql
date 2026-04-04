create table if not exists public.schedule_publications (
  week_start date primary key,
  week_end date not null,
  scheduled_send_date date not null,
  published_at timestamptz not null default now(),
  email_sent_at timestamptz null
);

create index if not exists schedule_publications_scheduled_send_idx
on public.schedule_publications(scheduled_send_date, email_sent_at);
