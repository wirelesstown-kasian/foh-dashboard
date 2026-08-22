alter table public.employees
add column if not exists meal_break_threshold_hours numeric(5,2) default 7.5;

update public.employees
set meal_break_threshold_hours = 7.5
where meal_break_threshold_hours is null;

alter table public.employees
drop constraint if exists employees_meal_break_threshold_hours_check;

alter table public.employees
add constraint employees_meal_break_threshold_hours_check
check (meal_break_threshold_hours is null or meal_break_threshold_hours > 0);
