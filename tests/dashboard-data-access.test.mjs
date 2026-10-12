import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = fs.readFileSync('src/lib/dashboardDataAccess.ts', 'utf8')
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const policy = {}
vm.runInNewContext(output, { exports: policy, Intl, Date, Set, Number, Object, Array, URLSearchParams })

const staff = { employeeId: 'staff-a', role: 'server', isManager: false }
const manager = { employeeId: 'manager-a', role: 'manager', isManager: true }
const cook = { employeeId: 'cook-a', role: 'cook', isManager: false }
const query = new URLSearchParams()

test('unauthorized tables and writes are refused by role', () => {
  assert.equal(policy.canAccessDashboardTable(staff, 'employees', 'GET', query), true)
  assert.equal(policy.canAccessDashboardTable(staff, 'cash_balance_entries', 'GET', query), false)
  assert.equal(policy.canAccessDashboardTable(staff, 'payroll_runs', 'GET', query), false)
  assert.equal(policy.canAccessDashboardTable(staff, 'tasks', 'DELETE', query), false)
  assert.equal(policy.canAccessDashboardTable(cook, 'eod_reports', 'GET', query), false)
  assert.equal(policy.canAccessDashboardTable(manager, 'tasks', 'PATCH', query), true)
  assert.equal(policy.canAccessDashboardTable(manager, 'employees', 'PATCH', query), false)
})

test('staff cannot read unpublished draft details', () => {
  assert.equal(policy.canAccessDashboardTable(staff, 'schedule_drafts', 'GET', query), false)
  assert.equal(policy.canAccessDashboardTable(staff, 'schedule_drafts', 'GET', new URLSearchParams('select=employee_id%2Cdisplay_order')), true)
})

test('staff queries cannot use credential filters or unrelated relationships as an oracle', () => {
  assert.equal(policy.validStaffQuery('employees', new URLSearchParams('select=id,name&pin_code=eq.1234'), 'GET', null), false)
  assert.equal(policy.validStaffQuery('employees', new URLSearchParams('select=id,name&order=pin_code.asc'), 'GET', null), false)
  assert.equal(policy.validStaffQuery('employees', new URLSearchParams('select=*,payroll_run_items(*)'), 'GET', null), false)
  assert.equal(policy.validStaffQuery('schedules', new URLSearchParams('select=*,employee:employees(id,name)'), 'GET', null), true)
  assert.equal(policy.validStaffQuery('eod_reports', new URLSearchParams('select=*,tip_distributions(*)'), 'GET', null), true)
  assert.equal(policy.validStaffQuery('eod_reports', new URLSearchParams('id=eq.report'), 'POST', 'resolution=merge-duplicates'), false)
  assert.equal(policy.validStaffQuery('eod_reports', new URLSearchParams('id=eq.mine&id=eq.other'), 'PATCH', null), false)
})

test('employee credentials and staff financial profile fields are stripped recursively', () => {
  const row = [{ id: 'a', pin_code: '1234', pin_hash: 'hash', login_password_hash: 'hash',
    hourly_wage: 20, name: 'A', is_active: true,
    employee: { id: 'b', name: 'B', pin_code: '9876', address: 'Private' } }]
  const staffRows = policy.safeDashboardResponse(row, staff, 'employees', '2026-10-02')
  const managerRows = policy.safeDashboardResponse(row, manager, 'employees', '2026-10-02')
  assert.equal(staffRows[0].name, 'A')
  assert.equal(staffRows[0].pin_code, undefined)
  assert.equal(staffRows[0].hourly_wage, undefined)
  assert.equal(staffRows[0].employee.address, undefined)
  assert.equal(managerRows[0].hourly_wage, 20)
  assert.equal(managerRows[0].pin_hash, undefined)
  assert.equal(managerRows[0].employee.pin_code, undefined)
})

test('staff writes bind closing identity and business day', () => {
  const today = '2026-10-02'
  const report = { session_date: today, closed_by_employee_id: staff.employeeId, tip_total: 100 }
  assert.equal(policy.validStaffWritePayload('eod_reports', 'POST', report, staff, today), true)
  assert.equal(policy.validStaffWritePayload('eod_reports', 'POST', { ...report, closed_by_employee_id: 'other' }, staff, today), false)
  assert.equal(policy.validStaffWritePayload('eod_reports', 'POST', { ...report, session_date: '2026-10-01' }, staff, today), false)
  assert.equal(policy.validStaffWritePayload('eod_reports', 'POST', { ...report, pin_code: '1234' }, staff, today), false)
  assert.equal(policy.validStaffWritePayload('eod_reports', 'POST', {
    ...report, cash_total: 50, batch_total: 50, revenue_total: 100,
    cc_tip: 60, cash_tip: 40, cash_deposit: 90,
  }, staff, today), true)
  assert.equal(policy.validStaffWritePayload('eod_reports', 'POST', {
    ...report, cash_total: 50, batch_total: 50, revenue_total: 100,
    cc_tip: 60, cash_tip: 40, cash_deposit: 1000,
  }, staff, today), false)
})

test('business date follows Chicago 3 AM cutoff', () => {
  assert.equal(policy.businessDateInChicago(new Date('2026-10-03T07:30:00Z')), '2026-10-02')
  assert.equal(policy.businessDateInChicago(new Date('2026-10-03T08:30:00Z')), '2026-10-03')
})
