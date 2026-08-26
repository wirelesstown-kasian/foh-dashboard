alter table public.shift_clocks
add column if not exists break_started_at timestamptz null,
add column if not exists break_ended_at timestamptz null,
add column if not exists break_minutes integer null default 0,
add column if not exists unpaid_break_started_at timestamptz null,
add column if not exists unpaid_break_ended_at timestamptz null,
add column if not exists unpaid_break_minutes integer null default 0;
