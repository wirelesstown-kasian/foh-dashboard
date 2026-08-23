alter table public.employees
add column if not exists tip_eligible boolean;

update public.employees
set tip_eligible = (
  coalesce(schedule_departments, array[]::text[]) @> array['server']::text[]
  or primary_department = 'server'
  or role = 'server'
)
where tip_eligible is null;

alter table public.employees
alter column tip_eligible set default false;
