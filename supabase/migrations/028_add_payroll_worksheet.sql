alter table public.employees
add column if not exists payment_method text null;

alter table public.employees
drop constraint if exists employees_payment_method_check;

alter table public.employees
add constraint employees_payment_method_check
check (payment_method is null or payment_method in ('cash', 'check', 'ach'));

create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  department text not null default 'all',
  start_date date not null,
  end_date date not null,
  pay_date date not null,
  memo text null,
  total_cash numeric(10,2) not null default 0,
  total_check numeric(10,2) not null default 0,
  total_ach numeric(10,2) not null default 0,
  total_gross numeric(10,2) not null default 0,
  total_deductions numeric(10,2) not null default 0,
  total_net numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payroll_runs_range_idx
on public.payroll_runs(start_date, end_date, department);

create table if not exists public.payroll_run_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid null references public.employees(id) on delete set null,
  employee_name text not null,
  role text null,
  department text not null,
  payment_method text not null check (payment_method in ('cash', 'check', 'ach')),
  hours numeric(10,2) not null default 0,
  tips numeric(10,2) not null default 0,
  base_wages numeric(10,2) not null default 0,
  guarantee_top_up numeric(10,2) not null default 0,
  commission numeric(10,2) not null default 0,
  deductions numeric(10,2) not null default 0,
  gross_pay numeric(10,2) not null default 0,
  net_pay numeric(10,2) not null default 0,
  payout_amount numeric(10,2) not null default 0,
  cash_rounding numeric(10,2) not null default 0,
  has_auto_clock_out boolean not null default false,
  has_open_clock boolean not null default false,
  memo text null,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists payroll_run_items_run_idx
on public.payroll_run_items(run_id, display_order);

create index if not exists payroll_run_items_employee_idx
on public.payroll_run_items(employee_id);
