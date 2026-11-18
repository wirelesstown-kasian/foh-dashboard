create table public.check_writer_vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  category text check (length(category) <= 120),
  archived_at timestamptz
);

create unique index check_writer_active_vendor_name_idx
  on public.check_writer_vendors (lower(name)) where archived_at is null;

create table public.check_writer_entries (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'draft' check (status in ('draft', 'printing', 'issued', 'void', 'removed')),
  source text not null check (source in ('app', 'handwritten', 'payroll', 'payroll_balance')),
  method text not null default 'check' check (method in ('check', 'cash', 'ach')),
  employee_id uuid references public.employees(id) on delete set null,
  vendor_id uuid references public.check_writer_vendors(id),
  payee_name text not null check (length(btrim(payee_name)) between 1 and 160),
  payroll_item_id uuid references public.payroll_run_items(id) on delete restrict,
  payroll_check_amount numeric(12,2),
  payment_date date not null,
  amount numeric(12,2) not null check (amount between 0.01 and 999999999.99),
  bank_account text check (length(btrim(bank_account)) between 1 and 80),
  check_number text check (check_number ~ '^[0-9]{1,12}$' and check_number::bigint > 0),
  category text check (length(category) <= 120),
  memo text check (length(memo) <= 160),
  accounting_note text check (length(accounting_note) <= 240),
  reference text check (length(reference) <= 120),
  created_by uuid,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  issued_at timestamptz,
  issued_by_name text,
  revision integer not null default 1,
  check (method <> 'check' or bank_account is not null),
  check (method <> 'check' or status not in ('printing', 'issued', 'void') or check_number is not null),
  check (payroll_item_id is null or payroll_check_amount > 0)
);

-- Normalize leading zeroes while keeping the stock's number for display.
create unique index check_writer_account_number_idx
  on public.check_writer_entries (lower(bank_account), (check_number::bigint)) where check_number is not null;
create unique index check_writer_open_payroll_draft_idx
  on public.check_writer_entries (payroll_item_id) where status in ('draft', 'printing');
create index check_writer_payroll_item_idx on public.check_writer_entries (payroll_item_id);
create index check_writer_date_idx on public.check_writer_entries (payment_date desc, id);

create table public.check_writer_audit (
  id bigint generated always as identity primary key,
  entry_id uuid references public.check_writer_entries(id),
  vendor_id uuid references public.check_writer_vendors(id),
  action text not null,
  actor_id uuid,
  actor_name text not null,
  occurred_at timestamptz not null default now(),
  before_record jsonb,
  after_record jsonb,
  reason text,
  check (num_nonnulls(entry_id, vendor_id) = 1)
);

create index check_writer_audit_entry_idx on public.check_writer_audit (entry_id, id desc);
create index check_writer_audit_vendor_idx on public.check_writer_audit (vendor_id, id desc);

create table public.check_writer_pin_attempts (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  window_start timestamptz not null,
  attempts integer not null
);

alter table public.check_writer_vendors enable row level security;
alter table public.check_writer_entries enable row level security;
alter table public.check_writer_audit enable row level security;
alter table public.check_writer_pin_attempts enable row level security;
revoke all on public.check_writer_vendors, public.check_writer_entries, public.check_writer_audit,
  public.check_writer_pin_attempts from public, anon, authenticated, service_role;
grant select, insert, update on public.check_writer_vendors, public.check_writer_entries,
  public.check_writer_pin_attempts to service_role;
grant select, insert on public.check_writer_audit to service_role;
grant usage on sequence public.check_writer_audit_id_seq to service_role;

create function public.check_writer_allow_pin(p_employee_id uuid) returns boolean
language sql set search_path = '' as $$
  insert into public.check_writer_pin_attempts as t (employee_id, window_start, attempts)
    values (p_employee_id, now(), 1)
  on conflict (employee_id) do update set
    window_start = case when t.window_start <= now() - interval '1 minute' then now() else t.window_start end,
    attempts = case when t.window_start <= now() - interval '1 minute' then 1 else least(t.attempts + 1, 13) end
  returning attempts <= 12;
$$;

-- Match the check component of getPayrollPaymentBreakdown without changing payroll.
create function public.check_writer_payroll_amount(p_item public.payroll_run_items) returns numeric
language sql immutable set search_path = '' as $$
  select case
    when p_item.payment_allocations ?| array['cash', 'check', 'ach']
      then round(coalesce((p_item.payment_allocations->>'check')::numeric, 0), 2)
    when p_item.commission_payment_method is distinct from p_item.payment_method
      and p_item.commission_payment_method is not null and p_item.commission > 0
      then case when p_item.payment_method = 'check' then p_item.net_pay - least(p_item.net_pay, p_item.commission)
        when p_item.commission_payment_method = 'check' then least(p_item.net_pay, p_item.commission) else 0 end
    when p_item.payment_method = 'check' then p_item.net_pay
    else 0 end;
$$;

create function public.check_writer_change(p_action text, p_actor uuid, p_data jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  actor_name text;
  prior public.check_writer_entries;
  entry public.check_writer_entries;
  prior_vendor public.check_writer_vendors;
  vendor public.check_writer_vendors;
  payroll_item public.payroll_run_items;
  payroll_date date;
  payroll_target numeric;
  used_amount numeric;
  input jsonb;
  changes jsonb;
  result jsonb := '[]'::jsonb;
  reason text;
  target_id uuid;
  employee uuid;
  vendor_id_to_use uuid;
  payroll_id uuid;
  payee text;
  entry_source text;
  entry_method text;
  next_status text;
  entry_amount numeric;
  entry_date date;
  bank text;
  number text;
  entry_category text;
  entry_memo text;
begin
  select e.name into actor_name from public.employees e
    where e.id = p_actor and e.role = 'manager' and e.is_active;
  if not found then raise exception 'An active manager is required.'; end if;

  -- Serialize register changes so reservations, issuance and audit commit together.
  perform pg_advisory_xact_lock(137181, 1);

  if p_action in ('save_vendor', 'archive_vendor') then
    target_id := nullif(p_data->>'id', '')::uuid;
    if target_id is not null then
      select * into prior_vendor from public.check_writer_vendors where id = target_id;
      if not found or prior_vendor.archived_at is not null then raise exception 'Vendor is no longer active.'; end if;
    end if;
    if p_action = 'archive_vendor' then
      if target_id is null then raise exception 'Select a vendor.'; end if;
      update public.check_writer_vendors set archived_at = now() where id = target_id returning * into vendor;
    elsif target_id is null then
      insert into public.check_writer_vendors (name, category)
        values (btrim(p_data->>'name'), nullif(btrim(p_data->>'category'), '')) returning * into vendor;
    else
      update public.check_writer_vendors
        set name = btrim(p_data->>'name'), category = nullif(btrim(p_data->>'category'), '')
        where id = target_id returning * into vendor;
    end if;

    insert into public.check_writer_audit (vendor_id, action, actor_id, actor_name, before_record, after_record)
      values (vendor.id, p_action, p_actor, actor_name, case when target_id is not null then to_jsonb(prior_vendor) end, to_jsonb(vendor));
    return jsonb_build_array(to_jsonb(vendor));
  end if;

  changes := case when p_action in ('prepare', 'print', 'resolve_print') then p_data->'items'
    else jsonb_build_array(p_data) end;
  if jsonb_typeof(changes) is distinct from 'array' then raise exception 'Select at least one item.'; end if;
  if jsonb_array_length(changes) not between 1 and 200 then raise exception 'Select between 1 and 200 items.'; end if;

  for input in select value from jsonb_array_elements(changes) loop
    prior := null;
    payroll_item := null;
    payroll_target := null;
    target_id := nullif(input->>'id', '')::uuid;
    reason := nullif(btrim(input->>'reason'), '');
    if length(reason) > 240 then raise exception 'Enter a reason of 240 characters or fewer.'; end if;

    if p_action in ('save', 'print', 'resolve_print', 'remove', 'void', 'categorize') and target_id is not null then
      select * into prior from public.check_writer_entries where id = target_id;
      if not found then raise exception 'Check or payment was not found.'; end if;
      if prior.revision is distinct from (input->>'revision')::integer then
        raise exception 'This record changed. Refresh and review it again.';
      end if;
    elsif p_action not in ('save', 'prepare') then
      raise exception 'Select an existing record.';
    end if;

    if p_action in ('save', 'prepare') then
      if prior.id is not null and prior.status <> 'draft' then raise exception 'Only drafts can be edited here.'; end if;
      entry_source := coalesce(prior.source, case when p_action = 'prepare' then 'payroll' else input->>'source' end);
      if entry_source is null or entry_source not in ('app', 'handwritten', 'payroll', 'payroll_balance') then
        raise exception 'Choose a valid payment source.';
      end if;
      if p_action = 'save' and entry_source = 'payroll' and prior.id is null then raise exception 'Prepare payroll checks from a saved run.'; end if;
      entry_method := case when entry_source = 'payroll_balance' then input->>'method' else 'check' end;
      if entry_method is null or (entry_source = 'payroll_balance' and entry_method not in ('cash', 'ach')) then
        raise exception 'Choose Cash or ACH for the remaining payment.';
      end if;
      payroll_id := coalesce(prior.payroll_item_id, nullif(input->>'payroll_item_id', '')::uuid);
      if prior.id is not null then payroll_id := prior.payroll_item_id; end if;
      entry_amount := (input->>'amount')::numeric;
      entry_date := (input->>'payment_date')::date;
      bank := case when entry_method = 'check' then coalesce(nullif(btrim(input->>'bank_account'), ''), 'Checking') end;
      number := case when entry_source = 'handwritten' then nullif(btrim(input->>'check_number'), '') end;
      entry_category := nullif(btrim(coalesce(input->>'category', p_data->>'category')), '');
      entry_memo := nullif(btrim(input->>'memo'), '');
      employee := null;
      vendor_id_to_use := null;

      if payroll_id is not null then
        if entry_source = 'app' then raise exception 'Use payroll preparation for linked checks.'; end if;
        select pi.* into payroll_item from public.payroll_run_items pi where pi.id = payroll_id for share;
        if not found then raise exception 'The payroll employee row no longer exists.'; end if;
        if p_action = 'prepare' and payroll_item.run_id is distinct from (p_data->>'run_id')::uuid then
          raise exception 'An employee is outside the selected payroll run.';
        end if;
        select pay_date into payroll_date from public.payroll_runs where id = payroll_item.run_id;
        payroll_target := public.check_writer_payroll_amount(payroll_item);
        select coalesce(sum(e.amount), 0) into used_amount from public.check_writer_entries e
          where e.payroll_item_id = payroll_id and e.status in ('issued', 'printing', 'draft')
          and e.id is distinct from prior.id;
        if p_action = 'prepare' then
          if payroll_target <= used_amount or exists (
            select from public.check_writer_entries where payroll_item_id = payroll_id and status in ('draft', 'printing')
          ) then continue; end if;
          entry_amount := payroll_target - used_amount;
          entry_date := payroll_date;
          entry_memo := 'Payroll ' || to_char(payroll_date, 'MM/DD/YYYY');
        end if;
        if entry_amount > payroll_target - used_amount then
          raise exception 'The amount for % exceeds the available payroll check balance (%).',
            payroll_item.employee_name, greatest(payroll_target - used_amount, 0);
        end if;
        employee := payroll_item.employee_id;
        payee := payroll_item.employee_name;
      elsif entry_source in ('payroll', 'payroll_balance') or p_action = 'prepare' then
        raise exception 'Select a saved payroll employee.';
      else
        employee := nullif(input->>'employee_id', '')::uuid;
        vendor_id_to_use := nullif(input->>'vendor_id', '')::uuid;
        if num_nonnulls(employee, vendor_id_to_use) <> 1 then raise exception 'Select a staff member or vendor.'; end if;
        if employee is not null then
          select name into payee from public.employees where id = employee;
        else
          select v.name into payee from public.check_writer_vendors v
            where v.id = vendor_id_to_use and (v.archived_at is null or v.id = prior.vendor_id);
        end if;
        if not found then raise exception 'The selected payee is unavailable.'; end if;
      end if;

      if entry_amount is null or entry_amount < 0.01 or entry_amount > 999999999.99
        or entry_amount <> round(entry_amount, 2) then raise exception 'Enter a positive amount with up to two decimal places.'; end if;
      if entry_date is null or entry_date < date '1900-01-01' or entry_date > date '9999-12-31' then
        raise exception 'Enter a valid payment date.';
      end if;
      next_status := case when entry_source in ('handwritten', 'payroll_balance') then 'issued' else 'draft' end;
      if next_status = 'issued' and entry_category is null then raise exception 'Enter a QuickBooks category.'; end if;
      if entry_source = 'handwritten' and number is null then raise exception 'Enter the handwritten check number.'; end if;

      if prior.id is null then
        insert into public.check_writer_entries (
          status, source, method, employee_id, vendor_id, payee_name, payroll_item_id, payroll_check_amount,
          payment_date, amount, bank_account, check_number, category, memo, reference,
          created_by, created_by_name, issued_at, issued_by_name
        ) values (
          next_status, entry_source, entry_method, employee, vendor_id_to_use, payee, payroll_id, payroll_target,
          entry_date, entry_amount, bank, number, entry_category, entry_memo, nullif(btrim(input->>'reference'), ''),
          p_actor, actor_name, case when next_status = 'issued' then now() end,
          case when next_status = 'issued' then actor_name end
        ) returning * into entry;
      else
        update public.check_writer_entries set employee_id = employee, vendor_id = vendor_id_to_use, payee_name = payee,
          payroll_check_amount = payroll_target, payment_date = entry_date, amount = entry_amount, bank_account = bank,
          category = entry_category, memo = entry_memo, revision = revision + 1
          where id = prior.id returning * into entry;
      end if;

    elsif p_action = 'print' then
      if prior.status <> 'draft' then raise exception 'This check is no longer available for printing.'; end if;
      entry_category := coalesce(prior.category, nullif(btrim(input->>'category'), ''));
      if entry_category is null then raise exception 'Enter a QuickBooks category for % before printing.', prior.payee_name; end if;
      number := nullif(btrim(input->>'check_number'), '');
      if number is null then raise exception 'Enter the stock number for %.', prior.payee_name; end if;
      payroll_target := prior.payroll_check_amount;
      if prior.payroll_item_id is not null then
        select * into payroll_item from public.payroll_run_items where id = prior.payroll_item_id for share;
        payroll_target := public.check_writer_payroll_amount(payroll_item);
        select coalesce(sum(e.amount), 0) into used_amount from public.check_writer_entries e
          where e.payroll_item_id = prior.payroll_item_id and e.status in ('issued', 'printing', 'draft') and e.id <> prior.id;
        if prior.amount > payroll_target - used_amount then
          raise exception 'Payroll changed for %. Review the draft amount before printing.', prior.payee_name;
        end if;
      end if;
      update public.check_writer_entries set status = 'printing', check_number = number, category = entry_category, payroll_check_amount = payroll_target,
        revision = revision + 1 where id = prior.id returning * into entry;

    elsif p_action = 'resolve_print' then
      if prior.status <> 'printing' then raise exception 'This check is no longer awaiting print confirmation.'; end if;
      next_status := case input->>'outcome' when 'printed' then 'issued' when 'unused' then 'draft' when 'spoiled' then 'void' end;
      if next_status is null then raise exception 'Choose a print result.'; end if;
      reason := coalesce(reason, case next_status when 'draft' then 'Stock unused' when 'void' then 'Stock spoiled' end);
      update public.check_writer_entries set status = next_status,
        check_number = case when next_status = 'draft' then null else prior.check_number end,
        issued_at = case when next_status = 'issued' then now() end,
        issued_by_name = case when next_status = 'issued' then actor_name end,
        revision = revision + 1 where id = prior.id returning * into entry;

    elsif p_action in ('remove', 'void') then
      if reason is null then raise exception 'Enter a reason.'; end if;
      if (p_action = 'remove' and prior.status <> 'draft') or (p_action = 'void' and prior.status <> 'issued') then
        raise exception 'This record cannot be removed or voided from its current status.';
      end if;
      update public.check_writer_entries set status = case p_action when 'remove' then 'removed' else 'void' end,
        revision = revision + 1 where id = prior.id returning * into entry;

    elsif p_action = 'categorize' then
      if prior.status <> 'issued' then raise exception 'Accounting details can only be updated on issued payments.'; end if;
      entry_category := nullif(btrim(input->>'category'), '');
      if entry_category is null then raise exception 'Enter a QuickBooks category.'; end if;
      update public.check_writer_entries set category = entry_category,
        accounting_note = nullif(btrim(input->>'accounting_note'), ''),
        revision = revision + 1 where id = prior.id returning * into entry;
    else
      raise exception 'Unknown check action.';
    end if;

    insert into public.check_writer_audit (entry_id, action, actor_id, actor_name, before_record, after_record, reason)
      values (entry.id, p_action, p_actor, actor_name,
        case when prior.id is not null then to_jsonb(prior) end, to_jsonb(entry), reason);
    result := result || to_jsonb(entry);
  end loop;
  return result;
end;
$$;

revoke execute on function public.check_writer_allow_pin(uuid), public.check_writer_payroll_amount(public.payroll_run_items),
  public.check_writer_change(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.check_writer_allow_pin(uuid), public.check_writer_payroll_amount(public.payroll_run_items),
  public.check_writer_change(text, uuid, jsonb) to service_role;
