export type CheckStatus = 'draft' | 'printing' | 'issued' | 'void' | 'removed'
export type CheckSource = 'app' | 'handwritten' | 'payroll' | 'payroll_balance'

export type CheckEntry = {
  id: string
  revision: number
  status: CheckStatus
  source: CheckSource
  method: 'check' | 'cash' | 'ach'
  employee_id: string | null
  vendor_id: string | null
  payee_name: string
  payroll_item_id: string | null
  payroll_check_amount: number | null
  payment_date: string
  amount: number
  bank_account: string | null
  check_number: string | null
  category: string | null
  memo: string | null
  accounting_note: string | null
  reference: string | null
  created_by_name: string
  issued_by_name: string | null
}

export type CheckVendor = { id: string; name: string; category: string | null; archived_at: string | null }
export type CheckEmployee = { id: string; name: string; is_active: boolean }
export type CheckRun = { id: string; department: string; start_date: string; end_date: string; pay_date: string }
export type PayrollCheckRow = {
  id: string
  employee_name: string
  allocated: number
  paid: number
  remaining: number
  open: CheckEntry | null
}
export type CheckAudit = {
  id: number
  occurred_at: string
  actor_name: string
  action: string
  reason: string | null
  before_record: Record<string, unknown> | null
  after_record: Record<string, unknown>
}
export type CheckData = { entries: CheckEntry[]; vendors: CheckVendor[]; employees: CheckEmployee[]; runs: CheckRun[] }
export type CheckAction = 'save' | 'prepare' | 'print' | 'resolve_print' | 'remove' | 'void'
  | 'categorize' | 'save_vendor' | 'archive_vendor'

export const checkActions = new Set<CheckAction>([
  'save', 'prepare', 'print', 'resolve_print', 'remove', 'void', 'categorize', 'save_vendor', 'archive_vendor',
])

export const checkMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function isPartialCheck(entry: CheckEntry) {
  return entry.payroll_check_amount !== null && entry.amount < entry.payroll_check_amount
}

export function checkMemo(entry: CheckEntry) {
  return isPartialCheck(entry) ? ['Partial payroll payout', entry.memo].filter(Boolean).join(' - ') : entry.memo ?? ''
}

const smallNumbers = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
]
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function integerWords(value: number): string {
  if (value < 20) return smallNumbers[value]
  if (value < 100) return [tens[Math.floor(value / 10)], value % 10 ? smallNumbers[value % 10] : ''].filter(Boolean).join('-')
  const [scale, label] = value >= 1_000_000 ? [1_000_000, 'Million'] : value >= 1_000 ? [1_000, 'Thousand'] : [100, 'Hundred']
  const leading = integerWords(Math.floor(value / scale))
  return [leading, label, value % scale ? integerWords(value % scale) : ''].filter(Boolean).join(' ')
}

export function amountInWords(amount: number) {
  const cents = Math.round(amount * 100)
  return `${integerWords(Math.floor(cents / 100))} and ${String(cents % 100).padStart(2, '0')}/100`
}

export function checkCsv(rows: CheckEntry[]) {
  const headers = [
    'Date', 'Bank account', 'Check number', 'Payee', 'Payee type', 'Amount', 'QuickBooks category',
    'Check memo', 'Accounting note', 'Source', 'Payroll item', 'Written by', 'Recorded by',
  ]
  const values = rows.filter(row => row.status === 'issued' && row.method === 'check').map(row => [
    row.payment_date, row.bank_account, row.check_number, row.payee_name, row.vendor_id ? 'Vendor' : 'Staff',
    row.amount.toFixed(2), row.category, checkMemo(row), row.accounting_note,
    row.source === 'handwritten' ? 'Handwritten' : row.source === 'payroll' ? 'Payroll' : 'Check Writer',
    row.payroll_item_id, row.created_by_name, row.issued_by_name,
  ])
  return [headers, ...values].map(row => row.map(value => {
    const text = String(value ?? '')
    const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text
    return `"${safe.replaceAll('"', '""')}"`
  }).join(',')).join('\r\n')
}
