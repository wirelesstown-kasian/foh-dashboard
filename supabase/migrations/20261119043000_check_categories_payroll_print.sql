-- Managed by the manager-only Check Writer API using service_role.
create table public.check_writer_categories (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(btrim(name)) between 1 and 120),
 archived_at timestamptz
);
create unique index check_writer_category_name_idx on public.check_writer_categories(lower(name));
alter table public.check_writer_categories enable row level security;
revoke all on public.check_writer_categories from public, anon, authenticated;
grant select, insert, update on public.check_writer_categories to service_role;
insert into public.check_writer_categories(name) values
('Advertising & marketing'),
('ASK'),
('Cash Expense'),
('Credit card processing fee'),
('Insurance'),
('Kitchen cleaning maintenance'),
('Legal & accounting services'),
('Meals'),
('Office expenses'),
('Merchant account fees'),
('Office supplies'),
('Software & apps'),
('Payroll expenses'),
('Officers'' salaries'),
('Rent'),
('Equipment rental'),
('Repairs & maintenance'),
('Supplies'),
('Taxes and Licenses'),
('Travel'),
('Parking & tolls'),
('Utilities'),
('Internet & TV services'),
('COGs')
on conflict do nothing;
insert into public.check_writer_categories(name)
select min(category) from (
 select category from public.check_writer_entries union all select category from public.check_writer_vendors
) c where nullif(btrim(category), '') is not null group by lower(category)
on conflict do nothing;

alter table public.check_writer_entries add column payroll_snapshot jsonb;
-- Snapshot only on draft creation/edit and issuance; never refresh an issued check from live payroll.
create function public.check_writer_snapshot() returns trigger language plpgsql set search_path = '' as $$
begin
 if TG_OP = 'UPDATE' and old.status <> 'draft' then
   new.payroll_snapshot := old.payroll_snapshot;
 elsif new.payroll_item_id is not null then
   select jsonb_build_object('hours', p.hours, 'base_wages', p.base_wages,
     'tips', p.tips, 'guarantee_top_up', p.guarantee_top_up, 'commission', p.commission,
     'gross_pay', p.gross_pay, 'deductions', p.deductions, 'net_pay', p.net_pay)
   into new.payroll_snapshot from public.payroll_run_items p where p.id = new.payroll_item_id;
   select r.start_date, r.end_date into new.payroll_period_start, new.payroll_period_end
   from public.payroll_runs r join public.payroll_run_items p on p.run_id = r.id where p.id = new.payroll_item_id;
 end if;
 if new.category is not null and (TG_OP = 'INSERT' or new.category is distinct from old.category) then
   if not exists(select from public.check_writer_categories c where c.name = new.category and c.archived_at is null) then
     raise exception 'Choose an active category.';
   end if;
 end if;
 return new;
end; $$;
revoke all on function public.check_writer_snapshot() from public, anon, authenticated;
create trigger check_writer_snapshot before insert or update on public.check_writer_entries
for each row execute function public.check_writer_snapshot();

create or replace function public.check_writer_change(p_action text, p_actor uuid, p_data jsonb) returns jsonb
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
  payroll_start date;
  payroll_end date;
  payroll_hours_to_store numeric;
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
  omit_name boolean;
  category_record public.check_writer_categories;
begin
  select e.name into actor_name from public.employees e
    where e.id = p_actor and e.role = 'manager' and e.is_active;
  if not found then raise exception 'An active manager is required.'; end if;

  -- Serialize register changes so reservations, issuance and audit commit together.
  perform pg_advisory_xact_lock(137181, 1);

  if p_action in ('save_category', 'archive_category', 'restore_category') then
    target_id := nullif(p_data->>'id', '')::uuid;
    if target_id is null then
      if p_action <> 'save_category' then raise exception 'Select a category.'; end if;
      insert into public.check_writer_categories(name) values(btrim(p_data->>'name')) returning * into category_record;
    else
      if p_action = 'save_category' then
        update public.check_writer_categories set name = btrim(p_data->>'name') where id = target_id returning * into category_record;
      else
        update public.check_writer_categories set archived_at = case when p_action = 'archive_category' then now() end
        where id = target_id returning * into category_record;
      end if;
      if not found then raise exception 'Category was not found.'; end if;
    end if;
    return jsonb_build_array(to_jsonb(category_record));
  end if;

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
      insert into public.check_writer_vendors (name, category, address, phone)
        values (btrim(p_data->>'name'), nullif(btrim(p_data->>'category'), ''), nullif(btrim(p_data->>'address'), ''), nullif(btrim(p_data->>'phone'), '')) returning * into vendor;
    else
      update public.check_writer_vendors
        set name = btrim(p_data->>'name'), category = nullif(btrim(p_data->>'category'), ''),
          address = nullif(btrim(p_data->>'address'), ''), phone = nullif(btrim(p_data->>'phone'), '')
        where id = target_id returning * into vendor;
    end if;

    insert into public.check_writer_audit (vendor_id, action, actor_id, actor_name, before_record, after_record)
      values (vendor.id, p_action, p_actor, actor_name, case when target_id is not null then to_jsonb(prior_vendor) end, to_jsonb(vendor));
    return jsonb_build_array(to_jsonb(vendor));
  end if;

  changes := case when p_action in ('prepare', 'print', 'reprint', 'resolve_print') then p_data->'items'
    else jsonb_build_array(p_data) end;
  if jsonb_typeof(changes) is distinct from 'array' then raise exception 'Select at least one item.'; end if;
  if jsonb_array_length(changes) not between 1 and 200 then raise exception 'Select between 1 and 200 items.'; end if;

  for input in select value from jsonb_array_elements(changes) loop
    prior := null;
    payroll_item := null;
    payroll_target := null;
    payroll_start := null;
    payroll_end := null;
    payroll_hours_to_store := null;
    target_id := nullif(input->>'id', '')::uuid;
    reason := nullif(btrim(input->>'reason'), '');
    if length(reason) > 240 then raise exception 'Enter a reason of 240 characters or fewer.'; end if;

    if p_action in ('save', 'print', 'reprint', 'resolve_print', 'remove', 'void', 'categorize') and target_id is not null then
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
        select pay_date, start_date, end_date into payroll_date, payroll_start, payroll_end from public.payroll_runs where id = payroll_item.run_id;
        payroll_hours_to_store := payroll_item.hours;
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
      omit_name := next_status = 'draft' and coalesce(
        (input->>'omit_payee_on_print')::boolean, prior.omit_payee_on_print, false
      );
      if next_status = 'issued' and entry_category is null then raise exception 'Enter a QuickBooks category.'; end if;

      if prior.id is null then
        insert into public.check_writer_entries (
          status, source, method, employee_id, vendor_id, payee_name, omit_payee_on_print, payroll_item_id, payroll_check_amount, payroll_period_start, payroll_period_end, payroll_hours,
          payment_date, amount, bank_account, check_number, category, memo, reference,
          created_by, created_by_name, issued_at, issued_by_name
        ) values (
          next_status, entry_source, entry_method, employee, vendor_id_to_use, payee, omit_name, payroll_id, payroll_target,
          payroll_start, payroll_end, payroll_hours_to_store, entry_date, entry_amount, bank, number, entry_category, entry_memo, nullif(btrim(input->>'reference'), ''),
          p_actor, actor_name, case when next_status = 'issued' then now() end,
          case when next_status = 'issued' then actor_name end
        ) returning * into entry;
      else
        update public.check_writer_entries set employee_id = employee, vendor_id = vendor_id_to_use, payee_name = payee,
          payroll_check_amount = payroll_target, payroll_period_start = payroll_start, payroll_period_end = payroll_end, payroll_hours = payroll_hours_to_store, payment_date = entry_date, amount = entry_amount, bank_account = bank,
          category = entry_category, memo = entry_memo, omit_payee_on_print = omit_name, revision = revision + 1
          where id = prior.id returning * into entry;
      end if;

    elsif p_action = 'print' then
      if prior.status <> 'draft' then raise exception 'This check is no longer available for printing.'; end if;
      entry_category := coalesce(prior.category, nullif(btrim(input->>'category'), ''));
      if entry_category is null then raise exception 'Enter a QuickBooks category for % before printing.', prior.payee_name; end if;
      number := nullif(btrim(input->>'check_number'), '');
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
      update public.check_writer_entries set status = 'issued', check_number = number, category = entry_category, payroll_check_amount = payroll_target,
        issued_at = now(), issued_by_name = actor_name, revision = revision + 1 where id = prior.id returning * into entry;

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

    elsif p_action = 'reprint' then
      if prior.status <> 'issued' or prior.method <> 'check' then raise exception 'Only issued checks can be reprinted.'; end if;
      entry := prior;

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
