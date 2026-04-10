const PRINT_ID = '__foh_print_root'

function buildScopedStyles(id: string) {
  const s = `#${id}`
  return `
    @page { size: letter landscape; margin: 0.45in; }
    ${s} { font-family: Arial, sans-serif; color: #111827; background: #fff; font-size: 11px; line-height: 1.35; padding: 0.45in; margin: 0; }
    ${s} *, ${s} *::before, ${s} *::after { box-sizing: border-box; }
    ${s} .report-shell { width: 100%; max-width: 10.1in; margin: 0 auto; }
    ${s} h1, ${s} h2, ${s} h3 { margin: 0 0 10px; line-height: 1.15; }
    ${s} h1 { font-size: 22px; }
    ${s} h2 { font-size: 16px; }
    ${s} h3 { font-size: 13px; margin-top: 14px; }
    ${s} p { margin: 0 0 8px; }
    ${s} table { width: 100%; border-collapse: collapse; margin-top: 14px; page-break-inside: avoid; }
    ${s} th, ${s} td { border: 1px solid #d1d5db; padding: 6px 8px; font-size: 10.5px; text-align: left; vertical-align: top; }
    ${s} th { background: #f3f4f6; }
    ${s} .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 14px 0; }
    ${s} .card { border: 1px solid #d1d5db; border-radius: 12px; padding: 10px; min-height: 74px; page-break-inside: avoid; }
    ${s} .card strong { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin-bottom: 6px; }
    ${s} .metric { font-size: 18px; font-weight: 700; line-height: 1.1; }
    ${s} .muted { color: #6b7280; }
    ${s} .right { text-align: right; }
    ${s} .report-grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(260px, 0.9fr); gap: 14px; align-items: start; }
    ${s} .compact-table th, ${s} .compact-table td { padding-top: 5px; padding-bottom: 5px; }
    @media print {
      body > *:not(#${id}) { display: none !important; }
      #${id} {
        display: block !important;
        position: fixed;
        inset: 0;
        overflow: visible;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  `
}

export function exportReportToPdf(title: string, bodyHtml: string) {
  if (typeof window === 'undefined') return

  // Remove any leftover print elements from a previous call
  document.getElementById(PRINT_ID)?.remove()
  document.getElementById(PRINT_ID + '_style')?.remove()

  const styleEl = document.createElement('style')
  styleEl.id = PRINT_ID + '_style'
  styleEl.textContent = buildScopedStyles(PRINT_ID)

  const container = document.createElement('div')
  container.id = PRINT_ID
  container.style.display = 'none'
  container.innerHTML = `<div class="report-shell">${bodyHtml}</div>`

  const cleanup = () => {
    window.setTimeout(() => {
      styleEl.remove()
      container.remove()
    }, 300)
    window.removeEventListener('afterprint', cleanup)
  }

  window.addEventListener('afterprint', cleanup)
  document.head.appendChild(styleEl)
  document.body.appendChild(container)

  // Small delay so the DOM has time to paint before print dialog opens
  window.setTimeout(() => window.print(), 150)
}
