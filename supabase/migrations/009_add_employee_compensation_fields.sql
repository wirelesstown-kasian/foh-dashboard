alter table public.employees
add column if not exists hourly_wage numeric(10,2);

alter table public.employees
add column if not exists guaranteed_hourly numeric(10,2);
