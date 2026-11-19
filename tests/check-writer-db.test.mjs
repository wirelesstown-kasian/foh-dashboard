import { PGlite } from '@electric-sql/pglite'
import { fileURLToPath } from 'node:url'
const migrations = fileURLToPath(new URL('../supabase/migrations/', import.meta.url))
import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
const db = new PGlite()
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create table public.employees(id uuid primary key, name text, role text, is_active boolean);
create table public.payroll_runs(id uuid primary key, start_date date, end_date date, pay_date date);
create table public.payroll_run_items(id uuid primary key, run_id uuid references payroll_runs, employee_id uuid, employee_name text, payment_method text, commission_payment_method text, payment_allocations jsonb, hours numeric, base_wages numeric, tips numeric, guarantee_top_up numeric, commission numeric, deductions numeric, gross_pay numeric, net_pay numeric);
`)
for (const file of readdirSync(migrations).filter(f => f.startsWith('20261118') || f.startsWith('20261119043000'))) {
 await db.exec(readFileSync(migrations+file,'utf8'))
}
const manager='00000000-0000-0000-0000-000000000001', run='00000000-0000-0000-0000-000000000002', item='00000000-0000-0000-0000-000000000003'
await db.exec(`insert into employees values('${manager}', 'Test manager', 'manager', true);
insert into payroll_runs values('${run}','2026-10-01','2026-10-31','2026-11-07');
insert into payroll_run_items values('${item}','${run}','${manager}','Test manager','check',null,null,40,800,100,0,0,20,900,880);`)
async function action(a,d) { return (await db.query('select public.check_writer_change($1,$2,$3) result',[a,manager,JSON.stringify(d)])).rows[0].result }
const category=(await action('save_category',{name:'Test category'}))[0]
await action('save_category',{id:category.id,name:'Renamed category'})
const draft=(await action('prepare',{run_id:run,category:'Renamed category',items:[{payroll_item_id:item,omit_payee_on_print:true}]}))[0]
assert.equal(draft.payee_name,'Test manager'); assert.equal(draft.omit_payee_on_print,true); assert.equal(draft.payroll_snapshot.gross_pay,900)
const issued=(await action('print',{items:[{id:draft.id,revision:draft.revision,check_number:'123'}]}))[0]
await db.exec(`update payroll_run_items set gross_pay=9999, net_pay=9999 where id='${item}'`)
const reprint=(await action('reprint',{items:[{id:issued.id,revision:issued.revision}]}))[0]
assert.equal(reprint.payroll_snapshot.gross_pay,900); assert.equal(reprint.omit_payee_on_print,true)
await action('archive_category',{id:category.id})
assert.equal((await db.query('select category from check_writer_entries where id=$1',[issued.id])).rows[0].category,'Renamed category')
await assert.rejects(action('save',{source:'app',employee_id:manager,amount:5,payment_date:'2026-11-19',category:'Renamed category'}),/active category/)
await action('restore_category',{id:category.id})
await action('save',{source:'app',employee_id:manager,amount:5,payment_date:'2026-11-19',category:'Renamed category'})
console.log('PASS: migration, category create/edit/archive/restore, archived category rejection, original names retained, payroll snapshot frozen on reprint')
await db.close()
