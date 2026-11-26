alter table public.payroll_run_items add column paid_amount numeric(12,2);
-- Baseline the amounts recorded today; earlier overwritten payment history cannot be reconstructed.
update public.payroll_run_items set paid_amount=payout_amount;
alter table public.payroll_run_items alter column paid_amount set not null;
alter table public.payroll_run_items add constraint payroll_paid_nonnegative check(paid_amount>=0);
create function public.initialize_payroll_paid() returns trigger language plpgsql set search_path='' as $$
begin new.paid_amount := new.payout_amount; return new; end $$;
revoke all on function public.initialize_payroll_paid() from public,anon,authenticated;
create trigger initialize_payroll_paid before insert on public.payroll_run_items for each row execute function public.initialize_payroll_paid();
create table public.payroll_balance_events (
 id uuid primary key default gen_random_uuid(), item_id uuid not null references public.payroll_run_items(id) on delete restrict,
 target_item_id uuid references public.payroll_run_items(id) on delete restrict,
 amount numeric(12,2) not null, method text not null check(method in ('cash','check','ach','carry_forward')),
 actor_id uuid references public.employees(id), memo text, created_at timestamptz not null default now()
);
create index payroll_balance_events_item_idx on public.payroll_balance_events(item_id);
create index payroll_balance_events_target_idx on public.payroll_balance_events(target_item_id,method);
create index payroll_balance_events_actor_idx on public.payroll_balance_events(actor_id);
alter table public.payroll_balance_events enable row level security;
revoke all on public.payroll_balance_events from public,anon,authenticated;
grant select,insert on public.payroll_balance_events to service_role;

create function public.patch_payroll_payout(p_run_id uuid,p_rows jsonb,p_memo text,p_totals jsonb,p_adjustment jsonb,p_actor uuid) returns jsonb
language plpgsql set search_path='' as $$
declare run public.payroll_runs; prior public.payroll_run_items; next_row public.payroll_run_items; input jsonb;
 payment numeric := coalesce((p_adjustment->>'amount')::numeric,0); signed_payment numeric; balance numeric; cash_id uuid;
 item_id uuid := nullif(p_adjustment->>'item_id','')::uuid; result jsonb;
begin
 if not exists(select from public.employees where id=p_actor and role='manager' and is_active) then raise exception 'Manager access required.'; end if;
 perform pg_advisory_xact_lock(137182,1);
 select * into run from public.payroll_runs where id=p_run_id for update;
 if not found then raise exception 'Payroll run was not found.'; end if;
 if jsonb_array_length(p_rows) <> (select count(*) from public.payroll_run_items where run_id=p_run_id)
   or (select count(distinct value->>'id') from jsonb_array_elements(p_rows)) <> jsonb_array_length(p_rows) then raise exception 'Refresh the complete payroll before saving.'; end if;
 if payment<0 or payment<>round(payment,2) then raise exception 'Enter a valid adjustment amount.'; end if;
 if payment>0 and (item_id is null or coalesce(p_adjustment->>'method','') not in ('cash','check','ach') or coalesce(p_adjustment->>'direction','') not in ('pay_out','receive_credit')) then raise exception 'Select an employee, payment direction and method.'; end if;
 for input in select value from jsonb_array_elements(p_rows) loop
   select * into prior from public.payroll_run_items where id=(input->>'id')::uuid and run_id=p_run_id for update;
   if not found then raise exception 'Payroll employee row was not found.'; end if;
   if input ? 'paid_amount' and (input->>'paid_amount')::numeric is distinct from prior.paid_amount then raise exception 'Payment history changed. Refresh before saving.'; end if;
   select * into next_row from jsonb_populate_record(prior,input - 'paid_amount');
   if next_row.employee_id is distinct from prior.employee_id then raise exception 'Employee identity cannot be changed by a payout correction.'; end if;
   balance := round(next_row.payout_amount-prior.paid_amount,2);
   signed_payment := 0;
   if prior.id=item_id and payment>0 then
     signed_payment := case p_adjustment->>'direction' when 'pay_out' then payment else -payment end;
     if balance=0 or sign(signed_payment)<>sign(balance) or abs(signed_payment)>abs(balance) then raise exception 'Adjustment payment exceeds the outstanding employee balance or has the wrong direction.'; end if;
     insert into public.payroll_balance_events(item_id,amount,method,actor_id,memo) values(prior.id,signed_payment,p_adjustment->>'method',p_actor,p_adjustment->>'memo');
     if p_adjustment->>'method'='cash' then
       insert into public.cash_balance_entries(entry_date,entry_type,amount,description,updated_at)
       values(current_date,case when signed_payment>0 then 'cash_out' else 'cash_in' end,payment,
       'Payroll payout adjustment | Employee '||prior.employee_name||' | Run '||p_run_id::text||' | '||coalesce(p_adjustment->>'memo',''),now()) returning id into cash_id;
     end if;
   end if;
   update public.payroll_run_items set hours=next_row.hours,tips=next_row.tips,base_wages=next_row.base_wages,
    guarantee_top_up=next_row.guarantee_top_up,commission=next_row.commission,deductions=next_row.deductions,
    gross_pay=next_row.gross_pay,net_pay=next_row.net_pay,payout_amount=next_row.payout_amount,cash_rounding=next_row.cash_rounding,
    payment_method=next_row.payment_method,commission_payment_method=next_row.commission_payment_method,payment_allocations=next_row.payment_allocations,
    memo=next_row.memo,paid_amount=prior.paid_amount+signed_payment where id=prior.id;
 end loop;
 if payment>0 and not exists(select from public.payroll_run_items where id=item_id and run_id=p_run_id) then raise exception 'Select a payroll employee in this run.'; end if;
 update public.payroll_runs set memo=p_memo,total_cash=(p_totals->>'cash')::numeric,total_check=(p_totals->>'check')::numeric,
 total_ach=(p_totals->>'ach')::numeric,total_gross=(p_totals->>'gross')::numeric,total_deductions=(p_totals->>'deductions')::numeric,total_net=(p_totals->>'net')::numeric,updated_at=now() where id=p_run_id;
 select to_jsonb(r)||jsonb_build_object('payroll_run_items',(select jsonb_agg(i order by i.display_order) from public.payroll_run_items i where run_id=p_run_id)) into result from public.payroll_runs r where id=p_run_id;
 return jsonb_build_object('run_id',p_run_id,'cash_entry_id',cash_id,'payroll_run',result);
end $$;
revoke all on function public.patch_payroll_payout(uuid,jsonb,text,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.patch_payroll_payout(uuid,jsonb,text,jsonb,jsonb,uuid) to service_role;

create function public.apply_payroll_credits(p_run_id uuid,p_credits jsonb,p_actor uuid) returns void language plpgsql set search_path='' as $$
declare credit jsonb; source public.payroll_run_items; target public.payroll_run_items; amount numeric; available numeric;
begin
 if not exists(select from public.employees where id=p_actor and role='manager' and is_active) then raise exception 'Manager access required.'; end if;
 perform pg_advisory_xact_lock(137182,1);
 for credit in select value from jsonb_array_elements(p_credits) loop
  amount := (credit->>'amount')::numeric;
  select * into source from public.payroll_run_items where id=(credit->>'source_item_id')::uuid for update;
  if not found or source.employee_id is null or source.employee_id::text<>credit->>'employee_id' then raise exception 'Credit employee was not found.'; end if;
  select * into target from public.payroll_run_items where run_id=p_run_id and employee_id=source.employee_id for update;
  if not found then raise exception 'Target employee was not found.'; end if;
  if (select end_date from public.payroll_runs where id=source.run_id)>=(select start_date from public.payroll_runs where id=p_run_id) then raise exception 'Credit must be applied to a later payroll period.'; end if;
  available := source.paid_amount-source.payout_amount;
  if amount is null or amount<=0 or amount<>round(amount,2) or amount>available then raise exception 'The available credit changed. Refresh the worksheet.'; end if;
  if target.deductions < (select coalesce(sum(e.amount),0) from public.payroll_balance_events e where e.target_item_id=target.id and method='carry_forward')+amount then raise exception 'Credit must be included in the new payroll deductions.'; end if;
  insert into public.payroll_balance_events(item_id,target_item_id,amount,method,actor_id,memo) values(source.id,target.id,amount,'carry_forward',p_actor,'Applied to next payroll deduction');
  update public.payroll_run_items set paid_amount=paid_amount-amount where id=source.id;
 end loop;
end $$;
revoke all on function public.apply_payroll_credits(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.apply_payroll_credits(uuid,jsonb,uuid) to service_role;
