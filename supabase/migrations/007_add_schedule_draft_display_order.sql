alter table public.schedule_drafts
add column if not exists display_order integer not null default 0;

create index if not exists schedule_drafts_week_department_order_idx
on public.schedule_drafts(week_start, department, display_order);
