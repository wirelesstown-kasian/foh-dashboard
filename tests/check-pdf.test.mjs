import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { PDFDocument, decodePDFRawStream } from 'pdf-lib'
const require = createRequire(import.meta.url)
function load(name) {
 const source = readFileSync(new URL(`../src/lib/${name}.ts`,import.meta.url),'utf8')
 const exports = {}
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 new Function('exports','require',compiled)(exports,n=>n.startsWith('./')?load(n.slice(2)):require(n))
 return exports
}
const { checkPdf } = load('checkPdf')
const entry={payee_name:'Synthetic Employee', omit_payee_on_print:false,payment_date:'2026-11-07',amount:880,check_number:'238',payroll_check_amount:880,payroll_item_id:'test',payroll_period_start:'2026-10-01',payroll_period_end:'2026-10-31',payroll_snapshot:{hours:40,base_wages:800,tips:100,guarantee_top_up:0,commission:0,gross_pay:900,deductions:20,net_pay:880}}
const data={vendors:[],company:{name:'Sample Company'}}
function streams(pdf,page){const contents=page.node.Contents();return contents.asArray().map(ref=>Buffer.from(decodePDFRawStream(pdf.context.lookup(ref)).decode()).toString()).join('\n')}
const hex=s=>Buffer.from(s).toString('hex').toUpperCase()
test('Letter PDF keeps reference field coordinates, payroll amounts, blank names and bulk page boundaries',async()=>{
 const bytes=await checkPdf([entry,{...entry,omit_payee_on_print:true}],{x:0,y:0},data)
 const pdf=await PDFDocument.load(bytes)
 assert.equal(pdf.getPageCount(),2)
 assert.deepEqual(pdf.getPage(0).getSize(),{width:612,height:792})
 const first=streams(pdf,pdf.getPage(0)),blank=streams(pdf,pdf.getPage(1))
 assert.match(first,new RegExp(hex('Synthetic Employee')))
 assert.doesNotMatch(blank,new RegExp(hex('Synthetic Employee')))
 assert.match(first, /11 Tf/); assert.match(first, /10.5 Tf/)
 assert.match(first, new RegExp(hex('admin@newvillagepub.com')))
 assert.doesNotMatch(first, new RegExp(hex('Check number:')))
 for (const page of [first, blank]) assert.doesNotMatch(page, new RegExp(`<${hex(entry.check_number)}>`))
 assert.match(first, /82.44 589 Tm/)
 for(const value of ['Earnings','Deductions','$900.00','Payroll net pay: $880.00','Check payment: $880.00']) assert.match(first,new RegExp(hex(value)))
 const coordinate = first.match(/1 0 0 1 ([0-9.]+) ([0-9.]+) Tm/)
 assert.ok(Math.abs(Number(coordinate[1])-503.64)<0.001)
 assert.ok(Math.abs(Number(coordinate[2])-724.68)<0.001)
 assert.doesNotMatch(first,new RegExp(hex('Social Security')))
 assert.doesNotMatch(first,new RegExp(hex('**')))
 assert.match(first,new RegExp(hex('Payroll - (2026-10-01 to 2026-10-31)')))
 assert.doesNotMatch(first,new RegExp(hex('YTD')))
 if(process.env.FOH_PDF_OUTPUT) writeFileSync(process.env.FOH_PDF_OUTPUT,bytes)
})
test('legacy payroll reprint never invents missing earnings or deductions',async()=>{
 const bytes=await checkPdf([{...entry,payroll_snapshot:null}],{x:0,y:0},data)
 const pdf=await PDFDocument.load(bytes),content=streams(pdf,pdf.getPage(0))
 assert.match(content,new RegExp(hex('Payroll detail not saved with original check')))
 assert.doesNotMatch(content,new RegExp(hex('$900.00')))
})

const { nextCheckNumber, sequentialCheckNumbers } = load('checkWriter')
test('check numbering remembers used stock by bank and assigns a padded bulk sequence', () => {
 const register = [{bank_account:'Checking',check_number:'002411',status:'void'}, {bank_account:'Other',check_number:'9999'}, {bank_account:'Checking',check_number:null}]
 assert.equal(nextCheckNumber(register,'checking'),'2412')
 assert.deepEqual(sequentialCheckNumbers([{id:'a'},{id:'b'},{id:'c'}],'002412'),{a:'002412',b:'002413',c:'002414'})
 assert.deepEqual(sequentialCheckNumbers([{id:'a'},{id:'b'}],''),{a:'',b:''})
 assert.deepEqual(sequentialCheckNumbers([{id:'a'},{id:'b'}],'999999999999'),{a:'999999999999',b:''})
 assert.equal(nextCheckNumber([{bank_account:'Checking',check_number:'999999999999'}],'Checking'),'')
})

test('alignment previews are marked on the check and both stubs', async () => {
 const preview = await PDFDocument.load(await checkPdf([entry], { x: 0, y: 0 }, data, true))
 assert.equal((streams(preview, preview.getPage(0)).match(new RegExp(hex('PREVIEW ONLY'), 'g')) ?? []).length, 3)
})
