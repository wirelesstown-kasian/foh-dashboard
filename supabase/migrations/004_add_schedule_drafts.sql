create table if not exists schedule_draft_weeks (
  week_start date primary key,
  updated_at timestamptz not null default now()
);

create table if not exists schedule_drafts (
  id uuid primary key default gen_random_uuid(),
  week_start date not null references schedule_draft_weeks(week_start) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  date date not null,
  start_time time not null,
  end_time time not null,
  is_off boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists schedule_drafts_week_idx on schedule_drafts(week_start);
create index if not exists schedule_drafts_date_idx on schedule_drafts(date);
