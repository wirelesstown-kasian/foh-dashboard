alter table public.tasks
  add column if not exists points integer not null default 0;

alter table public.task_completions
  add column if not exists points_awarded integer null;

create table if not exists public.reward_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  points_cost integer not null default 0 check (points_cost >= 0),
  description text null,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  reward_id uuid null references public.reward_catalog(id),
  points_delta integer not null,
  memo text not null,
  redeemed_at date not null default current_date,
  created_by_employee_id uuid null references public.employees(id),
  created_at timestamptz not null default now()
);

create index if not exists reward_catalog_active_idx
  on public.reward_catalog(is_active, display_order);

create index if not exists reward_redemptions_employee_date_idx
  on public.reward_redemptions(employee_id, redeemed_at desc);
