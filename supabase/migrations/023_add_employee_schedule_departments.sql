alter table public.employees
add column if not exists schedule_departments text[] not null default array['foh']::text[];

update public.employees
set schedule_departments = case
  when primary_department = 'hybrid' then array['foh', 'boh']::text[]
  when primary_department is not null and primary_department <> '' then array[primary_department]::text[]
  else array['foh']::text[]
end
where schedule_departments is null
   or array_length(schedule_departments, 1) is null;

alter table public.schedules
drop constraint if exists schedules_department_check;

create index if not exists employees_schedule_departments_idx
on public.employees using gin(schedule_departments);
