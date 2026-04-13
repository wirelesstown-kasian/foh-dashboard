alter table public.eod_reports
add column if not exists actual_cash_on_hand numeric(10,2) not null default 0;

alter table public.eod_reports
add column if not exists cash_variance numeric(10,2) not null default 0;

alter table public.eod_reports
add column if not exists variance_note text;
