import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { amountInWords, checkMemo, checkMoney, type CheckData, type CheckEntry } from './checkWriter'
import type { PrintAlignment } from './checkVoucher'

// Coordinates in PDF points, measured from the supplied Letter reference, top-left origin.
export const CHECK_LAYOUT = { width: 612, height: 792, date: [503.64, 67.32], payee: [82.44, 101.40], amount: [540, 104.52], words: [35.64, 126.12], memo: [82.44, 203], stubs: [287.16, 544.92] } as const

export async function checkPdf(entries: CheckEntry[], alignment: PrintAlignment, data: CheckData, preview = false) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.TimesRoman)
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold)
  const stubFont = await pdf.embedFont(StandardFonts.Helvetica)
  const stubBold = await pdf.embedFont(StandardFonts.HelveticaBold)
  let stubMode = false
  const offset = (n: number) => Number.isFinite(n) ? Math.max(-0.5, Math.min(0.5, n)) * 72 : 0
  for (const entry of entries) {
    stubMode = false
    const page = pdf.addPage([612, 792])
    if (preview) {
      for (const top of [132, 390, 648]) {
        page.drawText('PREVIEW ONLY', { x: 175, y: 792 - top, size: 34, font: stubBold, color: rgb(0.7, 0.7, 0.7), opacity: 0.45 })
      }
    }
    const text = (value: unknown, x: number, top: number, width: number, size = 8, strong = false, right = false) => {
      // Standard PDF fonts support WinAnsi. Replace unsupported characters consistently.
      let content = String(value ?? '').replace(/[\r\n\t]/g, ' ').replace(/[^\x20-\x7e\xa0-\xff]/g, '?')
      const face = stubMode ? (strong ? stubBold : stubFont) : (strong ? bold : font)
      while (size > 5 && face.widthOfTextAtSize(content, size) > width) size -= 0.25
      while (face.widthOfTextAtSize(content, size) > width && content.length) content = content.slice(0, -1)
      page.drawText(content, { x: x + offset(alignment.x) + (right ? width - face.widthOfTextAtSize(content, size) : 0), y: 792 - top - offset(alignment.y), size, font: face })
    }
    const line = (top: number, x: number, width: number) => page.drawLine({ start: { x: x + offset(alignment.x), y: 792 - top - offset(alignment.y) }, end: { x: x + width + offset(alignment.x), y: 792 - top - offset(alignment.y) }, thickness: 0.4, color: rgb(0, 0, 0) })
    const name = entry.omit_payee_on_print ? '' : entry.payee_name
    const date = entry.payment_date.split('-').reverse()
    const formattedDate = `${date[1]}/${date[0]}/${date[2]}`
    text(formattedDate, ...CHECK_LAYOUT.date, 65, 8.7434)
    text(name, ...CHECK_LAYOUT.payee, 370, 11, true)
    text(checkMoney.format(entry.amount).slice(1), 470, 104.52, 70, 11, true, true)
    text(amountInWords(entry.amount), ...CHECK_LAYOUT.words, 515, 10.5)
    const vendor = data.vendors.find(v => v.id === entry.vendor_id)
    text(name, 82.44, 192, 390, 9)
    if (vendor?.address) text(vendor.address, 82.44, 180, 390, 8)
    text(checkMemo(entry), ...CHECK_LAYOUT.memo, 490, 8.7434)
    stubMode = true
    for (const top of CHECK_LAYOUT.stubs) {
      text(name, 39, top, 240)
      text(`Check date: ${formattedDate}`, 425, top, 145)
      if (entry.payroll_item_id) {
        text(`Period beginning: ${entry.payroll_period_start ?? ''}`, 425, top + 10, 145)
        text(`Period ending: ${entry.payroll_period_end ?? ''}`, 425, top + 20, 145)
        text('Earnings', 39, top + 52, 100, 8, true)
        text('Hours', 148, top + 52, 40, 8, true)
        text('Amount', 230, top + 52, 62, 8, true, true)
        text('Deductions', 305, top + 52, 150, 8, true)
        text('Amount', 490, top + 52, 72, 8, true, true)
        line(top + 55, 39, 253); line(top + 55, 305, 257)
        const snapshot = entry.payroll_snapshot
        const money = (n: number | null | undefined) => typeof n === 'number' && Number.isFinite(n) ? checkMoney.format(n) : ''
        if (snapshot) {
          const earnings: [string, string][] = [['Base wages', 'base_wages'], ['Tips', 'tips'], ['Guarantee top-up', 'guarantee_top_up'], ['Commission', 'commission'], ['Gross pay', 'gross_pay']]
          earnings.forEach(([label, key], i) => {
            text(label, 39, top + 66 + i * 12, 105)
            if (i === 0) text(snapshot.hours ?? '', 148, top + 66, 40)
            text(money(snapshot[key]), 220, top + 66 + i * 12, 72, 8, false, true)
          })
          if (snapshot.deductions !== null && snapshot.deductions !== undefined) {
            text('Recorded deductions', 305, top + 66, 170)
            text(money(snapshot.deductions), 490, top + 66, 72, 8, false, true)
          }
          text(`Payroll net pay: ${money(snapshot.net_pay)}`, 305, top + 126, 257)
        } else {
          // Legacy checks have no historical earnings snapshot. Never substitute current payroll.
          text('Payroll detail not saved with original check', 39, top + 66, 253)
          if (entry.payroll_hours != null) text(`Recorded hours: ${entry.payroll_hours}`, 39, top + 80, 253)
        }
        text(`Check payment: ${checkMoney.format(entry.amount)}`, 305, top + 140, 257, 8, true)
      } else {
        text(checkMemo(entry), 39, top + 40, 390)
        text(checkMoney.format(entry.amount), 470, top + 40, 92, 9, true, true)
      }
      text(checkMemo(entry), 39, top + 157, 523)
      text([data.company?.name, data.company?.address, data.company?.phone, 'admin@newvillagepub.com'].filter(Boolean).join(', '), 39, top + 210, 523, 7)
    }
  }
  pdf.catalog.set(pdf.context.obj('ViewerPreferences'), pdf.context.obj({ PrintScaling: 'None' }))
  return pdf.save()
}
