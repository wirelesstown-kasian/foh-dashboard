alter table public.onboarding_cases
  add column if not exists selected_documents text[] not null default array['w4','i9']::text[],
  add column if not exists filing_status text,
  add column if not exists w4_step3_amount numeric,
  add column if not exists ssn_ciphertext text,
  add column if not exists last_invite_sent_at timestamptz,
  add column if not exists last_invite_email text;

create table if not exists public.app_pin_attempts (
  email text primary key,
  failures integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.app_pin_attempts enable row level security;
revoke all privileges on public.app_pin_attempts from anon, authenticated, public;

update public.onboarding_cases
set selected_documents = array['w4','i9']::text[] ||
  array(select id::text from public.onboarding_materials where is_current = true)
where selected_documents = array['w4','i9']::text[] and status in ('invited','submitted','approved');

create or replace function public.activate_onboarding_case(p_case_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c public.onboarding_cases%rowtype;
  new_employee_id uuid;
begin
  select * into c from public.onboarding_cases where id = p_case_id for update;
  if not found or c.status <> 'approved' then raise exception 'Case is not approved'; end if;
  if c.pending_pin_code is null or c.pin_hash is null then raise exception 'Employee must set a PIN'; end if;
  if c.activation_date > (now() at time zone 'America/Chicago')::date then
    raise exception 'Activation date has not arrived';
  end if;
  if exists (select 1 from public.onboarding_materials m
    where m.kind = 'handbook' and m.required and m.is_current
      and m.id::text = any(c.selected_documents)
      and m.effective_date <= (now() at time zone 'America/Chicago')::date)
    and not exists (select 1 from public.onboarding_acknowledgments a
      join public.onboarding_materials m on m.id = a.material_id
      where a.case_id = c.id and m.kind = 'handbook' and m.required and m.is_current
        and m.id::text = any(c.selected_documents)
        and m.effective_date <= (now() at time zone 'America/Chicago')::date)
  then raise exception 'Handbook acknowledgment is required'; end if;
  insert into public.employees (
    name, phone, email, address, role, primary_department, schedule_departments,
    hourly_wage, guaranteed_hourly, tip_pool_hourly_rate, tip_eligible,
    commission_enabled, commission_note, payment_method, login_enabled,
    login_password_hash, pin_hash, pin_code, is_active
  ) values (
    trim(c.first_name || ' ' || c.last_name), c.phone, c.email,
    concat_ws(', ', c.address, c.address_city, concat_ws(' ', c.address_state, c.address_postal_code)),
    c.role, c.primary_department, c.schedule_departments, c.hourly_wage,
    c.guaranteed_hourly, c.tip_pool_hourly_rate, coalesce(c.tip_eligible, false),
    c.commission_enabled, c.commission_note, 'check',
    true, null, c.pin_hash, c.pending_pin_code, true
  ) returning id into new_employee_id;
  update public.onboarding_cases set status = 'active', activated_at = now(),
    employee_id = new_employee_id, pending_pin_code = null where id = c.id;
  return new_employee_id;
end $$;
revoke all on function public.activate_onboarding_case(uuid) from public, anon, authenticated;
grant execute on function public.activate_onboarding_case(uuid) to service_role;
