alter table public.employees
add column if not exists login_enabled boolean not null default false;

alter table public.employees
add column if not exists login_password_hash text;

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
