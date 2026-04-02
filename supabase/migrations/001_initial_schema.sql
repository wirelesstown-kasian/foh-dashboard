-- FOH Dashboard Initial Schema

-- Employees
create table employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  pin_hash text not null,
  role text not null check (role in ('manager', 'server', 'busser', 'runner')),
  birth_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Schedules (published from schedule planning)
create table schedules (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  date date not null,
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now()
);
create index schedules_date_idx on schedules(date);
create index schedules_employee_idx on schedules(employee_id);

-- Task categories
create table task_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('pre_shift', 'operation', 'closing', 'custom')),
  deadline_time time,
  display_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Tasks
create table tasks (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references task_categories(id) on delete cascade,
  title text not null,
  deadline_time time,
  display_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Task completions (per employee per day)
create table task_completions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  completed_at timestamptz not null default now(),
  session_date date not null
);
create index task_completions_date_idx on task_completions(session_date);

-- Daily session state
create table daily_sessions (
  id uuid primary key default gen_random_uuid(),
  session_date date not null unique,
  current_phase text not null default 'pre_shift'
    check (current_phase in ('pre_shift', 'operation', 'closing', 'complete')),
  notes text,
  completed_at timestamptz
);

-- EOD Reports
create table eod_reports (
  id uuid primary key default gen_random_uuid(),
  session_date date not null unique,
  closed_by_employee_id uuid references employees(id),
  cash_total numeric(10,2) not null default 0,
  batch_total numeric(10,2) not null default 0,
  revenue_total numeric(10,2) not null default 0,
  cc_tip numeric(10,2) not null default 0,
  cash_tip numeric(10,2) not null default 0,
  tip_total numeric(10,2) not null default 0,
  cash_deposit numeric(10,2) not null default 0,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tip distributions per EOD
create table tip_distributions (
  id uuid primary key default gen_random_uuid(),
  eod_report_id uuid not null references eod_reports(id) on delete cascade,
  employee_id uuid not null references employees(id),
  hours_worked numeric(4,2) not null default 0,
  tip_share numeric(5,4) not null default 0, -- proportion (0-1)
  house_deduction numeric(10,2) not null default 0,
  net_tip numeric(10,2) not null default 0
);

-- Seed default task categories
insert into task_categories (name, type, display_order) values
  ('Pre-Shift', 'pre_shift', 1),
  ('Operations', 'operation', 2),
  ('Closing', 'closing', 3);
