update public.schedules schedule
set department = 'cook'
from public.employees employee
where schedule.employee_id = employee.id
  and schedule.department = 'kitchen'
  and employee.schedule_departments @> array['cook']::text[]
  and not employee.schedule_departments @> array['kitchen']::text[];

update public.schedule_drafts draft
set department = 'cook'
from public.employees employee
where draft.employee_id = employee.id
  and draft.department = 'kitchen'
  and employee.schedule_departments @> array['cook']::text[]
  and not employee.schedule_departments @> array['kitchen']::text[];
