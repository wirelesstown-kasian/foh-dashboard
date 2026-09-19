alter table public.payroll_run_items
add column if not exists commission_payment_method text null;

alter table public.payroll_run_items
drop constraint if exists payroll_run_items_commission_payment_method_check;

alter table public.payroll_run_items
add constraint payroll_run_items_commission_payment_method_check
check (
  commission_payment_method is null or
  commission_payment_method in ('cash', 'check', 'ach')
);
