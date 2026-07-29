alter table public.employees
add column if not exists pin_code text;

alter table public.employees
drop constraint if exists employees_pin_code_format_check;

alter table public.employees
add constraint employees_pin_code_format_check
check (pin_code is null or pin_code ~ '^[0-9]{4}$');

create unique index if not exists employees_active_pin_code_unique_idx
on public.employees(pin_code)
where is_active = true and pin_code is not null;
