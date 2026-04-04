alter table public.employees
drop constraint if exists employees_role_check;

alter table public.employees
add constraint employees_role_check
check (role in ('manager', 'server', 'busser', 'runner', 'kitchen_staff'));

alter table public.schedule_drafts
add column if not exists department text not null default 'foh';

create index if not exists schedule_drafts_week_department_idx
on public.schedule_drafts(week_start, department);
