import { amountInWords, checkMemo, checkMoney, type CheckEntry } from './checkWriter'

export type PrintAlignment = { x: number; y: number }

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

type Voucher = Pick<CheckEntry, 'amount' | 'payee_name' | 'payment_date'> & { memo: string }

export function voucherDocument(rows: Voucher[], alignment: PrintAlignment, sample = false) {
  const offset = (value: number) => Number.isFinite(value) ? Math.max(-0.5, Math.min(0.5, value)) : 0
  const pages = rows.map(row => {
    const [year, month, day] = row.payment_date.split('-')
    const date = `${month}/${day}/${year}`
    const amount = checkMoney.format(row.amount).slice(1)
    const words = amountInWords(row.amount)
    const stub = (position: string) => `<div class="stub ${position}">
      <span>${escapeHtml(row.payee_name)}</span><span>${escapeHtml(date)}</span><span>${escapeHtml(checkMoney.format(row.amount))}</span>
      <small>${escapeHtml(row.memo)}</small>
    </div>`
    return `<section class="sheet">
      <div class="voucher">
        <div class="date">${escapeHtml(date)}</div>
        <div class="payee" style="font-size:${row.payee_name.length > 55 ? '8' : '11'}pt">${escapeHtml(row.payee_name)}</div>
        <div class="amount">${escapeHtml(amount)}</div>
        <div class="words" style="font-size:${words.length > 88 ? '8' : '11'}pt">${escapeHtml(words)}</div>
        <div class="memo">${escapeHtml(row.memo)}</div>
        ${stub('first')}${stub('second')}
      </div>
      ${sample ? '<div class="sample">ALIGNMENT SAMPLE</div>' : ''}
    </section>`
  })

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Check Writer vouchers</title><style>
    @page { size: letter portrait; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; color: #000; font: 11pt Arial, sans-serif; }
    .sheet { position: relative; width: 8.5in; height: 10.99in; overflow: hidden; break-after: page; }
    .sheet:last-child { break-after: auto; }
    .voucher { position: absolute; inset: 0; transform: translate(${offset(alignment.x)}in, ${offset(alignment.y)}in); }
    .date, .payee, .amount, .words, .memo, .stub { position: absolute; }
    .date { top: 0.78in; left: 6.77in; }
    .payee { top: 1.38in; left: 1.04in; width: 5.54in; line-height: 1; overflow-wrap: anywhere; }
    .amount { top: 1.38in; left: 6.75in; width: 1.18in; text-align: right; }
    .words { top: 1.84in; left: 0.52in; width: 7.4in; line-height: 1; overflow-wrap: anywhere; }
    .memo { top: 2.74in; left: 0.83in; width: 4.1in; font-size: 9pt; line-height: 1; overflow-wrap: anywhere; }
    .stub { left: 0.55in; width: 7.4in; display: grid; grid-template-columns: minmax(0, 1fr) 1.15in 1.35in; gap: 0.18in; overflow-wrap: anywhere; }
    .stub span:nth-child(3) { text-align: right; }
    .stub small { grid-column: 1 / -1; }
    .first { top: 4.25in; }
    .second { top: 7.91in; }
    .sample { position: absolute; top: 3.18in; left: 0.55in; font: bold 11pt Arial, sans-serif; }
  </style></head><body>${pages.join('')}</body></html>`
}

function printDocument(html: string) {
  const frame = document.createElement('iframe')
  frame.title = 'Check Writer print sheet'
  frame.style.cssText = 'position:fixed; width:1px; height:1px; border:0; opacity:0; pointer-events:none'
  frame.addEventListener('load', () => {
    const printWindow = frame.contentWindow
    if (!printWindow) return
    printWindow.addEventListener('afterprint', () => frame.remove(), { once: true })
    printWindow.focus()
    printWindow.print()
  }, { once: true })
  frame.srcdoc = html
  document.body.appendChild(frame)
  window.setTimeout(() => frame.remove(), 300_000)
}

export function printChecks(entries: CheckEntry[], alignment: PrintAlignment) {
  printDocument(voucherDocument(entries.map(entry => ({ ...entry, memo: checkMemo(entry) })), alignment))
}

export function printAlignmentSample(alignment: PrintAlignment) {
  printDocument(voucherDocument([
    { payee_name: 'Sample Payee', payment_date: '2026-01-01', amount: 123.45, memo: 'Partial payroll payout - Sample memo' },
  ], alignment, true))
}
