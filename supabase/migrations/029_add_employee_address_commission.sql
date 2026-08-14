alter table public.employees
add column if not exists address text,
add column if not exists commission_enabled boolean not null default false,
add column if not exists commission_note text;
