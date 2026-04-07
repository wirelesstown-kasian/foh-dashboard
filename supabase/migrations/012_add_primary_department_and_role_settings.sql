alter table public.employees
drop constraint if exists employees_role_check;

alter table public.employees
add column if not exists primary_department text not null default 'foh';

update public.employees
set primary_department = case
  when role = 'kitchen_staff' then 'boh'
  when role = 'manager' then 'hybrid'
  else 'foh'
end
where primary_department is null
   or primary_department = 'foh';

insert into public.app_settings (key, value, updated_at)
values
  (
    'role_definitions',
    '[
      {"key":"manager","label":"Manager","is_active":true,"display_order":0},
      {"key":"server","label":"Server","is_active":true,"display_order":1},
      {"key":"busser","label":"Busser","is_active":true,"display_order":2},
      {"key":"runner","label":"Runner","is_active":true,"display_order":3},
      {"key":"kitchen_staff","label":"Kitchen Staff","is_active":true,"display_order":4}
    ]'::jsonb,
    now()
  ),
  (
    'primary_department_definitions',
    '[
      {"key":"foh","label":"FOH","is_active":true,"display_order":0},
      {"key":"boh","label":"BOH","is_active":true,"display_order":1},
      {"key":"hybrid","label":"Hybrid","is_active":true,"display_order":2}
    ]'::jsonb,
    now()
  )
on conflict (key) do nothing;
