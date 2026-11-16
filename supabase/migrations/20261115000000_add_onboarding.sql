-- Applicants remain separate from employees until their activation date.
create table if not exists public.onboarding_company (
  id boolean primary key default true check (id),
  legal_name text not null default 'Kasian Restaurant, Inc.',
  dba text not null default 'New Village Gastro Pub',
  street text not null default '3566 Milwaukee Ave',
  city text not null default 'Northbrook',
  state text not null default 'Illinois',
  postal_code text not null default '',
  ein text not null default '',
  records_email text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.employees(id)
);
insert into public.onboarding_company (id) values (true) on conflict (id) do nothing;

create table if not exists public.onboarding_company_history (
  id uuid primary key default gen_random_uuid(),
  snapshot jsonb not null,
  changed_at timestamptz not null default now(),
  changed_by uuid references public.employees(id)
);

create table if not exists public.onboarding_cases (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  company_snapshot jsonb not null,
  invite_hash text not null unique,
  invite_expires_at timestamptz not null,
  status text not null default 'invited' check (status in ('invited','submitted','approved','active','cancelled')),
  first_name text,
  last_name text,
  phone text,
  address text,
  address_city text,
  address_state text,
  address_postal_code text,
  availability jsonb not null default '{}'::jsonb,
  employment_type text check (employment_type is null or employment_type in ('full_time','part_time')),
  employment_history text,
  emergency_contact jsonb not null default '{}'::jsonb,
  pin_hash text,
  pending_pin_code text unique check (pending_pin_code is null or pending_pin_code ~ '^[0-9]{4}$'),
  login_password_hash text,
  role text,
  primary_department text,
  schedule_departments text[],
  hourly_wage numeric,
  guaranteed_hourly numeric,
  tip_pool_hourly_rate numeric,
  tip_eligible boolean,
  commission_enabled boolean not null default false,
  commission_note text,
  activation_date date,
  application_path text,
  employee_id uuid unique references public.employees(id),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  activated_at timestamptz,
  record_email_claimed_at timestamptz,
  record_email_sent_at timestamptz
);
create index if not exists onboarding_cases_status_idx on public.onboarding_cases(status, activation_date);

create table if not exists public.onboarding_materials (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('handbook','training')),
  title text not null,
  version int not null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  required boolean not null default true,
  acknowledgment_type text not null default 'signature' check (acknowledgment_type in ('signature','quiz','manager_demo')),
  quiz jsonb,
  departments text[],
  effective_date date not null default current_date,
  is_current boolean not null default true,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.employees(id),
  unique (kind, title, version)
);

create table if not exists public.onboarding_acknowledgments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.onboarding_cases(id) on delete cascade,
  material_id uuid not null references public.onboarding_materials(id),
  signed_name text,
  quiz_answers jsonb,
  quiz_score int,
  acknowledged_at timestamptz not null default now(),
  verified_by uuid references public.employees(id),
  unique(case_id, material_id)
);

create table if not exists public.onboarding_documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.onboarding_cases(id) on delete cascade,
  kind text not null check (kind in ('w4','i9','i9_id','other')),
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  uploaded_at timestamptz not null default now(),
  uploaded_by text not null check (uploaded_by in ('employee','manager')),
  manager_verified_at timestamptz,
  manager_verified_by uuid references public.employees(id)
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('onboarding-private', 'onboarding-private', false, 10485760,
  array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain','image/jpeg','image/png'])
on conflict (id) do nothing;

alter table public.onboarding_company enable row level security;
alter table public.onboarding_company_history enable row level security;
alter table public.onboarding_cases enable row level security;
alter table public.onboarding_materials enable row level security;
alter table public.onboarding_acknowledgments enable row level security;
alter table public.onboarding_documents enable row level security;
-- Access is through server routes using the service role after manager or invite checks.
revoke all privileges on public.onboarding_company, public.onboarding_company_history,
  public.onboarding_cases, public.onboarding_materials, public.onboarding_acknowledgments,
  public.onboarding_documents from anon, authenticated, public;

create or replace function public.activate_onboarding_case(p_case_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c public.onboarding_cases%rowtype;
  new_employee_id uuid;
begin
  select * into c from public.onboarding_cases where id = p_case_id for update;
  if not found or c.status <> 'approved' then raise exception 'Case is not approved'; end if;
  if c.login_password_hash is null then raise exception 'Employee must set an app password'; end if;
  if c.activation_date > (now() at time zone 'America/Chicago')::date then
    raise exception 'Activation date has not arrived';
  end if;
  if not exists (
    select 1 from public.onboarding_acknowledgments a
    join public.onboarding_materials m on m.id = a.material_id
    where a.case_id = c.id and m.kind = 'handbook' and m.required and m.is_current
      and m.effective_date <= (now() at time zone 'America/Chicago')::date
  ) then raise exception 'Handbook acknowledgment is required'; end if;
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
    c.login_password_hash is not null, c.login_password_hash, c.pin_hash,
    c.pending_pin_code, true
  ) returning id into new_employee_id;
  update public.onboarding_cases set status = 'active', activated_at = now(),
    employee_id = new_employee_id, pending_pin_code = null where id = c.id;
  return new_employee_id;
end $$;
revoke all on function public.activate_onboarding_case(uuid) from public, anon, authenticated;
grant execute on function public.activate_onboarding_case(uuid) to service_role;

create or replace function public.publish_onboarding_material(p_material_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m public.onboarding_materials%rowtype;
begin
  select * into m from public.onboarding_materials where id = p_material_id for update;
  if not found then raise exception 'Material not found'; end if;
  update public.onboarding_materials set is_current = false
    where kind = m.kind and title = m.title and is_current = true;
  update public.onboarding_materials set is_current = true,
    published_at = coalesce(published_at, now()) where id = m.id;
end $$;
revoke all on function public.publish_onboarding_material(uuid) from public, anon, authenticated;
grant execute on function public.publish_onboarding_material(uuid) to service_role;
