alter table public.eod_reports
add column if not exists delivery_order_amount numeric(10,2) not null default 0;
