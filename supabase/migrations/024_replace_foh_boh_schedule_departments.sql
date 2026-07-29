update public.app_settings
set
  value = '[
    {"key":"manager","label":"Manager","description":"Management and schedule oversight","is_active":true,"display_order":0},
    {"key":"server","label":"Server","description":"Dining room service","is_active":true,"display_order":1},
    {"key":"bar","label":"Bar","description":"Bar service","is_active":true,"display_order":2},
    {"key":"cook","label":"Cook","description":"Kitchen cooking shifts","is_active":true,"display_order":3},
    {"key":"kitchen","label":"Kitchen","description":"General kitchen coverage","is_active":true,"display_order":4},
    {"key":"prep","label":"Prep","description":"Prep shifts","is_active":true,"display_order":5},
    {"key":"dishwasher","label":"Dishwasher","description":"Dish station shifts","is_active":true,"display_order":6},
    {"key":"food_runner","label":"Food Runner","description":"Food running shifts","is_active":true,"display_order":7}
  ]'::jsonb,
  updated_at = now()
where key = 'primary_department_definitions'
  and exists (
    select 1
    from jsonb_array_elements(value) as department
    where department->>'key' in ('foh', 'boh', 'hybrid')
  );

insert into public.app_settings (key, value, updated_at)
values (
  'primary_department_definitions',
  '[
    {"key":"manager","label":"Manager","description":"Management and schedule oversight","is_active":true,"display_order":0},
    {"key":"server","label":"Server","description":"Dining room service","is_active":true,"display_order":1},
    {"key":"bar","label":"Bar","description":"Bar service","is_active":true,"display_order":2},
    {"key":"cook","label":"Cook","description":"Kitchen cooking shifts","is_active":true,"display_order":3},
    {"key":"kitchen","label":"Kitchen","description":"General kitchen coverage","is_active":true,"display_order":4},
    {"key":"prep","label":"Prep","description":"Prep shifts","is_active":true,"display_order":5},
    {"key":"dishwasher","label":"Dishwasher","description":"Dish station shifts","is_active":true,"display_order":6},
    {"key":"food_runner","label":"Food Runner","description":"Food running shifts","is_active":true,"display_order":7}
  ]'::jsonb,
  now()
)
on conflict (key) do nothing;

update public.employees
set schedule_departments = case
  when role = 'manager' then array['manager']::text[]
  when role = 'kitchen_staff' then array['cook']::text[]
  when role = 'prep' then array['prep']::text[]
  when role = 'dishwasher' then array['dishwasher']::text[]
  when role = 'food_runner' then array['food_runner']::text[]
  when role = 'runner' then array['food_runner']::text[]
  when role = 'busser' then array['server']::text[]
  when role is not null and role <> '' then array[role]::text[]
  else array['server']::text[]
end
where schedule_departments && array['foh', 'boh', 'hybrid']::text[]
   or schedule_departments is null
   or array_length(schedule_departments, 1) is null;
