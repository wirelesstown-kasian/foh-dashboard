-- Add department to published schedules so FOH and BOH shifts are tracked separately.
-- Managers can now appear in either or both departments without cross-contamination.
alter table public.schedules
  add column if not exists department text not null default 'foh'
  check (department in ('foh', 'boh'));

create index if not exists schedules_department_idx on public.schedules(date, department);
