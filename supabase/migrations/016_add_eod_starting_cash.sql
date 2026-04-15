alter table public.eod_reports
add column if not exists starting_cash numeric(10,2) not null default 0;
