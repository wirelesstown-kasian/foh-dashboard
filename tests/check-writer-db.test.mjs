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
for (const file of readdirSync(migrations).filter(f => f.startsWith('20261118') || f.startsWith('20261119043000') || f.startsWith('20261119044226') || f.startsWith('20261120000000') || f.startsWith('20261121000000') || f.startsWith('20261121120000'))) {
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
const secondManager='00000000-0000-0000-0000-000000000004'
await db.exec(`insert into employees values('${secondManager}', 'Authorizing manager', 'manager', true)`)
const staffDraft=(await action('save',{source:'app',employee_id:manager,amount:5,payment_date:'2026-11-19'}))[0]
assert.equal(staffDraft.category,'Payroll expenses')
const authorized=(await db.query('select public.check_writer_change($1,$2,$3) result',['print',secondManager,JSON.stringify({items:[{id:staffDraft.id,revision:staffDraft.revision,check_number:'124'}]})])).rows[0].result[0]
assert.equal(authorized.created_by_name,'Authorizing manager')
assert.equal(authorized.issued_by_name,'Authorizing manager')
assert.equal(authorized.created_by,secondManager)
const blankInput={source:'app',amount:12.34,payment_date:'2026-11-21',category:'Payroll expenses',omit_payee_on_print:true}
await assert.rejects(action('save',blankInput),/memo is required/)
await assert.rejects(action('save',{...blankInput,memo:'   '}),/memo is required/)
await assert.rejects(action('save',{...blankInput,omit_payee_on_print:false,memo:'Walk-in refund'}),/Select a staff member/)
const blankDraft=(await action('save',{...blankInput,memo:'Walk-in refund'}))[0]
assert.equal(blankDraft.employee_id,null); assert.equal(blankDraft.vendor_id,null)
assert.equal(blankDraft.payee_name,'Blank payee'); assert.equal(blankDraft.omit_payee_on_print,true)
const blankPrinted=(await action('print',{items:[{id:blankDraft.id,revision:blankDraft.revision,check_number:'125'}]}))[0]
assert.equal(blankPrinted.memo,'Walk-in refund'); assert.equal(blankPrinted.status,'issued')
await assert.rejects(action('save',{...blankInput,employee_id:manager}),/memo is required/)
const vendor=(await action('save_vendor',{name:'Quick add vendor',quick_add:true}))[0]
assert.equal(vendor.name,'Quick add vendor'); assert.equal(vendor.address,null); assert.equal(vendor.phone,null); assert.equal(vendor.category,null)
const vendorDraft=(await action('save',{source:'app',vendor_id:vendor.id,amount:10,payment_date:'2026-11-21'}))[0]
assert.equal(vendorDraft.payee_name,'Quick add vendor'); assert.equal(vendorDraft.vendor_id,vendor.id)
// Legacy blank-payee drafts without a memo cannot bypass the issuance rule.
await db.exec(`update check_writer_entries set omit_payee_on_print=true, memo=null where id='${vendorDraft.id}'`)
await assert.rejects(action('print',{items:[{id:vendorDraft.id,revision:vendorDraft.revision,check_number:'126',category:'Payroll expenses'}]}),/enter a memo before printing/)
console.log('PASS: blank payee memo rules, printing, retained identities, name-only vendors, categories and payroll snapshots')
const direct = async data => (await db.query('select public.check_writer_save_and_print($1,$2) result', [manager, JSON.stringify(data)])).rows[0].result
const directInputs = { source: 'app', employee_id: manager, amount: 30, payment_date: '2026-11-21', category: 'Payroll expenses' }
const countChecks = async () => (await db.query('select count(*) as n from check_writer_entries')).rows[0].n
const beforeDirect = await countChecks()
await assert.rejects(direct({ ...directInputs, check_number: '123' }), /duplicate key/)
assert.equal(await countChecks(), beforeDirect, 'a failed print rolls back the draft')
const [directIssued] = await direct({ ...directInputs, check_number: '0042' })
assert.equal(directIssued.status, 'issued')
assert.equal(directIssued.check_number, '0042')
await db.close()
