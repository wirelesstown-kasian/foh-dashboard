alter table public.employees
add column if not exists tip_pool_hourly_rate numeric(10,2);
