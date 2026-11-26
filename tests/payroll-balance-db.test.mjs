import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const db=new PGlite()
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create table employees(id uuid primary key,role text,is_active boolean);
create table payroll_runs(id uuid primary key,start_date date,end_date date,pay_date date,memo text,total_cash numeric,total_check numeric,total_ach numeric,total_gross numeric,total_deductions numeric,total_net numeric,updated_at timestamptz);
create table payroll_run_items(id uuid primary key,run_id uuid references payroll_runs(id) on delete cascade,employee_id uuid,employee_name text,hours numeric,tips numeric,base_wages numeric,guarantee_top_up numeric,commission numeric,deductions numeric,gross_pay numeric,net_pay numeric,payout_amount numeric,cash_rounding numeric,payment_method text,commission_payment_method text,payment_allocations jsonb,memo text,display_order integer);
create table cash_balance_entries(id uuid primary key default gen_random_uuid(),entry_date date,entry_type text,amount numeric,description text,updated_at timestamptz);
insert into employees values('00000000-0000-0000-0000-000000000001','manager',true);
insert into payroll_runs(id,start_date,end_date,pay_date) values('00000000-0000-0000-0000-000000000002','2026-11-01','2026-11-07','2026-11-10');
insert into payroll_run_items(id,run_id,employee_id,employee_name,payout_amount,payment_method) values('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','Test employee',100,'cash');`)
await db.exec(readFileSync('supabase/migrations/20261126000000_payroll_balances.sql','utf8'))
const actor='00000000-0000-0000-0000-000000000001',run='00000000-0000-0000-0000-000000000002',id='00000000-0000-0000-0000-000000000003'
async function patch(amount,adjustment=null){return (await db.query('select patch_payroll_payout($1,$2,$3,$4,$5,$6) result',[run,JSON.stringify([{id,payout_amount:amount,net_pay:amount,gross_pay:amount,base_wages:amount,deductions:0}]),null,JSON.stringify({cash:amount,check:0,ach:0,gross:amount,deductions:0,net:amount}),JSON.stringify(adjustment),actor])).rows[0].result}
await patch(80)
let item=(await db.query('select * from payroll_run_items where id=$1',[id])).rows[0]
assert.equal(Number(item.paid_amount),100);assert.equal(Number(item.payout_amount)-Number(item.paid_amount),-20)
assert.equal((await db.query('select count(*) count from cash_balance_entries')).rows[0].count,0)
await patch(80,{item_id:id,amount:5,method:'cash',direction:'receive_credit'})
item=(await db.query('select * from payroll_run_items where id=$1',[id])).rows[0]
assert.equal(Number(item.paid_amount),95)
assert.equal((await db.query('select entry_type from cash_balance_entries')).rows[0].entry_type,'cash_in')
await assert.rejects(patch(80,{item_id:id,amount:50,method:'cash',direction:'receive_credit'}),/exceeds/)
await assert.rejects(patch(80,{item_id:id,amount:1,method:'cash',direction:'pay_out'}),/wrong direction/)
assert.equal(Number((await db.query('select paid_amount from payroll_run_items where id=$1',[id])).rows[0].paid_amount),95)
const nextRun='00000000-0000-0000-0000-000000000004',nextItem='00000000-0000-0000-0000-000000000005'
await db.exec(`insert into payroll_runs(id,start_date,end_date,pay_date) values('${nextRun}','2026-11-08','2026-11-14','2026-11-17');insert into payroll_run_items(id,run_id,employee_id,payout_amount,deductions) values('${nextItem}','${nextRun}','${actor}',35,15);`)
await db.query('select apply_payroll_credits($1,$2,$3)',[nextRun,JSON.stringify([{source_item_id:id,employee_id:actor,amount:15}]),actor])
assert.equal(Number((await db.query('select paid_amount from payroll_run_items where id=$1',[id])).rows[0].paid_amount),80)
await assert.rejects(db.query('select apply_payroll_credits($1,$2,$3)',[nextRun,JSON.stringify([{source_item_id:id,employee_id:actor,amount:15}]),actor]),/available credit/)
await patch(120)
await patch(120,{item_id:id,amount:10,method:'check',direction:'pay_out'})
item=(await db.query('select * from payroll_run_items where id=$1',[id])).rows[0]
assert.equal(Number(item.payout_amount)-Number(item.paid_amount),30)
assert.equal((await db.query('select count(*) count from cash_balance_entries')).rows[0].count,1)
console.log('PASS: persistent signed balances, partial refunds, additional payments, carry-forward deductions, cash and atomic rejection')
await db.close()
