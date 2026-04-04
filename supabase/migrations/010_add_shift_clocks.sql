create table if not exists public.shift_clocks (
  id uuid primary key default gen_random_uuid(),
  session_date date not null,
  employee_id uuid not null references public.employees(id) on delete cascade,
  clock_in_at timestamptz not null,
  clock_out_at timestamptz null,
  clock_in_photo_path text not null,
  clock_out_photo_path text null,
  auto_clock_out boolean not null default false,
  approval_status text not null default 'open',
  approved_hours numeric(10,2) null,
  manager_approved_by uuid null references public.employees(id) on delete set null,
  manager_approved_at timestamptz null,
  manager_note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_date, employee_id)
);

alter table public.shift_clocks
drop constraint if exists shift_clocks_approval_status_check;

alter table public.shift_clocks
add constraint shift_clocks_approval_status_check
check (approval_status in ('open', 'pending_review', 'approved', 'adjusted'));

create index if not exists shift_clocks_session_idx on public.shift_clocks(session_date);
create index if not exists shift_clocks_employee_idx on public.shift_clocks(employee_id, session_date);
