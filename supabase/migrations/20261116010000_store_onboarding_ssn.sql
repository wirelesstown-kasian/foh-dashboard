-- Kept in the service-role-only onboarding table for prefilled legal forms.
-- Do not expose this column through manager list or employee portal responses.
alter table public.onboarding_cases
  add column if not exists ssn text check (ssn is null or ssn ~ '^[0-9]{9}$');

alter table public.onboarding_cases
  drop column if exists ssn_ciphertext;
