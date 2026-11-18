import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function loadModule(file, dependencies = {}) {
  const source = readFileSync(new URL(`../src/lib/${file}.ts`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  runInNewContext(compiled, { exports, require: name => dependencies[name] }, { filename: file })
  return exports
}

const checkWriter = loadModule('checkWriter')
const { amountInWords, checkCsv, checkMemo } = checkWriter
const { voucherDocument } = loadModule('checkVoucher', { './checkWriter': checkWriter })

const issued = {
  status: 'issued', method: 'check', amount: 250.01, payroll_check_amount: 600,
  payee_name: 'Mora & Sons', payment_date: '2026-11-18', category: 'Payroll expense',
  check_number: '001234', bank_account: 'Checking', memo: 'November payout',
  payroll_item_id: 'payroll-item-1', created_by_name: 'Manager', issued_by_name: 'Second manager',
  source: 'payroll',
}

test('vouchers print the amount to the cent and mark partial payouts on the face and both stubs', () => {
  assert.equal(amountInWords(250.01), 'Two Hundred Fifty and 01/100')
  assert.equal(amountInWords(1_000_001), 'One Million One and 00/100')
  assert.equal(amountInWords(0.05), 'Zero and 05/100')
  const html = voucherDocument([{ ...issued, memo: checkMemo(issued) }], { x: 0.04, y: -0.03 })
  assert.match(html, /size: 8\.5in 11in/)
  assert.match(html, /translate\(0\.04in, -0\.03in\)/)
  assert.match(html, /Mora &amp; Sons/)
  assert.equal((html.match(/Partial payroll payout/g) ?? []).length, 3)
  assert.doesNotMatch(html, /001234|Checking|Payroll expense/)
})

test('QuickBooks bank-feed CSV includes only issued checks and treats payee text as data', () => {
  const csv = checkCsv([
    { ...issued, payee_name: '=Mora, "Sons"' },
    { ...issued, payee_name: 'Draft payee', status: 'draft' },
    { ...issued, payee_name: 'Pending payee', status: 'printing' },
    { ...issued, payee_name: 'Voided payee', status: 'void' },
    { ...issued, payee_name: 'ACH recipient', method: 'ach' },
  ])
  assert.match(csv, /"001234","'=Mora, ""Sons"""/)
  assert.match(csv, /"250.01","Payroll expense","Partial payroll payout - November payout"/)
  assert.doesNotMatch(csv, /Draft payee|Pending payee|Voided payee|ACH recipient/)
})

test('blank-payee vouchers omit the payee on the face and both stubs while the register keeps the name', () => {
  const blank = { ...issued, omit_payee_on_print: true, memo: checkMemo(issued) }
  const html = voucherDocument([blank, { ...issued, payee_name: 'Named Payee' }], { x: 0, y: 0 })

  assert.doesNotMatch(html, /Mora/)
  assert.equal((html.match(/Named Payee/g) ?? []).length, 3)
  assert.match(html, /11\/18\/2026/)
  assert.match(html, /Two Hundred Fifty and 01\/100/)
  assert.match(html, /November payout/)
  assert.match(checkCsv([blank]), /Mora & Sons/)
})
