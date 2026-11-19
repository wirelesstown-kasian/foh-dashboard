-- Repair databases where payroll/categories changes were applied before the blank-payee migration.
-- Applied to production as repair_check_writer_blank_payee_column.
alter table public.check_writer_entries
  add column if not exists omit_payee_on_print boolean not null default false;
