update public.schedules schedule
set department = case
  when schedule.department = 'kitchen' and employee.schedule_departments @> array['cook']::text[] then 'cook'
  when schedule.department = 'cook' and employee.schedule_departments @> array['kitchen']::text[] then 'kitchen'
  else employee.schedule_departments[1]
end
from public.employees employee
where schedule.employee_id = employee.id
  and array_length(employee.schedule_departments, 1) > 0
  and not employee.schedule_departments @> array[schedule.department]::text[];

update public.schedule_drafts draft
set department = case
  when draft.department = 'kitchen' and employee.schedule_departments @> array['cook']::text[] then 'cook'
  when draft.department = 'cook' and employee.schedule_departments @> array['kitchen']::text[] then 'kitchen'
  else employee.schedule_departments[1]
end
from public.employees employee
where draft.employee_id = employee.id
  and array_length(employee.schedule_departments, 1) > 0
  and not employee.schedule_departments @> array[draft.department]::text[];
