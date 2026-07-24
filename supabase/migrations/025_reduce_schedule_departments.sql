update public.app_settings
set
  value = '[
    {"key":"manager","label":"Manager","description":"Management and schedule oversight","is_active":true,"display_order":0},
    {"key":"server","label":"Server","description":"Dining room service","is_active":true,"display_order":1},
    {"key":"cook","label":"Cook","description":"Cooking shifts","is_active":true,"display_order":2},
    {"key":"kitchen","label":"Kitchen","description":"Kitchen support shifts","is_active":true,"display_order":3}
  ]'::jsonb,
  updated_at = now()
where key = 'primary_department_definitions';

insert into public.app_settings (key, value, updated_at)
values (
  'primary_department_definitions',
  '[
    {"key":"manager","label":"Manager","description":"Management and schedule oversight","is_active":true,"display_order":0},
    {"key":"server","label":"Server","description":"Dining room service","is_active":true,"display_order":1},
    {"key":"cook","label":"Cook","description":"Cooking shifts","is_active":true,"display_order":2},
    {"key":"kitchen","label":"Kitchen","description":"Kitchen support shifts","is_active":true,"display_order":3}
  ]'::jsonb,
  now()
)
on conflict (key) do nothing;

update public.employees
set schedule_departments = (
  select array_agg(distinct mapped_department order by mapped_department)
  from unnest(schedule_departments) as department_key
  cross join lateral (
    select case
      when department_key in ('manager', 'hybrid') then 'manager'
      when department_key in ('cook') then 'cook'
      when department_key in ('kitchen', 'boh', 'prep', 'dishwasher') then 'kitchen'
      else 'server'
    end as mapped_department
  ) mapped
)
where schedule_departments is not null
  and array_length(schedule_departments, 1) is not null;

update public.employees
set schedule_departments = case
  when role = 'manager' then array['manager']::text[]
  when role = 'kitchen_staff' then array['cook']::text[]
  when role = 'prep' or role = 'dishwasher' then array['kitchen']::text[]
  else array['server']::text[]
end
where schedule_departments is null
   or array_length(schedule_departments, 1) is null;

update public.schedules
set department = case
  when department in ('manager', 'hybrid') then 'manager'
  when department = 'cook' then 'cook'
  when department in ('kitchen', 'boh', 'prep', 'dishwasher') then 'kitchen'
  else 'server'
end
where department not in ('manager', 'server', 'cook', 'kitchen');

update public.schedule_drafts
set department = case
  when department in ('manager', 'hybrid') then 'manager'
  when department = 'cook' then 'cook'
  when department in ('kitchen', 'boh', 'prep', 'dishwasher') then 'kitchen'
  else 'server'
end
where department not in ('manager', 'server', 'cook', 'kitchen');
