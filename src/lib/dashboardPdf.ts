import { exportReportToPdf } from '@/lib/reportExport'

type DashboardPdfOptions = {
  label: string
  startDate: string
  endDate: string
  previousStartDate: string
  previousEndDate: string
  closedDays: string[]
  chartLabel: string
}

export function exportDashboardToPdf(source: HTMLElement, options: DashboardPdfOptions) {
  // Snapshot the visible values and SVGs rather than recalculating financial data.
  const snapshot = source.cloneNode(true) as HTMLElement
  snapshot.querySelectorAll('[data-pdf-exclude]').forEach(element => element.remove())
  snapshot.querySelectorAll('button').forEach(button => {
    const card = document.createElement('div')
    card.className = button.className
    card.style.cssText = button.style.cssText
    card.append(...button.childNodes)
    button.replaceWith(card)
  })
  snapshot.querySelectorAll('a').forEach(link => link.removeAttribute('href'))
  snapshot.className = 'dashboard-pdf-content'

  const report = document.createElement('section')
  report.className = 'dashboard-pdf'
  const heading = document.createElement('h1')
  heading.textContent = `Reporting Dashboard - ${options.label}`
  const range = document.createElement('p')
  range.textContent = `${options.startDate} to ${options.endDate} | Comparison: ${options.previousStartDate} to ${options.previousEndDate}`
  const settings = document.createElement('p')
  settings.textContent = `Closed days: ${options.closedDays.join(', ') || 'None'} | Trend: ${options.chartLabel}`
  const pages = [
    ['[data-pdf-section="overview"]', '[data-pdf-grid="summary"]', '[data-pdf-section="trend"]'],
    ['[data-pdf-section="mix"]'],
    ['[data-pdf-grid="metrics"]', '[data-pdf-section="departments"]'],
  ].map(selectors => {
    const page = document.createElement('div')
    page.className = 'dashboard-pdf-page'
    for (const selector of selectors) {
      const element = snapshot.querySelector(selector)
      if (element) page.append(element)
    }
    return page
  })
  snapshot.querySelector('[data-pdf-layout="main"]')?.remove()
  // Keep any missing-data notices above the exported sections.
  report.append(heading, range, settings, snapshot, ...pages)

  const styles = `<style>
    #__foh_print_root .dashboard-pdf { font-size: 11px; }
    #__foh_print_root .dashboard-pdf h1 { font-size: 21px; }
    #__foh_print_root .dashboard-pdf p { margin-bottom: 0; }
    #__foh_print_root .dashboard-pdf > p { margin-bottom: 6px; color: #475569; }
    #__foh_print_root .dashboard-pdf-content { margin-top: 18px; }
    #__foh_print_root .dashboard-pdf-page + .dashboard-pdf-page { break-before: page; }
    #__foh_print_root [data-pdf-section] { break-inside: avoid; }
    #__foh_print_root [data-pdf-grid="overview"] { grid-template-columns: repeat(6, minmax(0, 1fr)); }
    #__foh_print_root [data-pdf-grid="overview"] > div { padding: 6px 8px; }
    #__foh_print_root [data-pdf-grid="metrics"],
    #__foh_print_root [data-pdf-grid="mix"],
    #__foh_print_root [data-pdf-grid="summary"],
    #__foh_print_root [data-pdf-grid="departments"] { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    #__foh_print_root [data-pdf-grid="metrics"] > *,
    #__foh_print_root [data-pdf-grid="summary"] > *,
    #__foh_print_root [data-pdf-grid="mix"] > * { break-inside: avoid; }
    #__foh_print_root [data-pdf-grid="summary"] .text-3xl { font-size: 24px; }
    #__foh_print_root [data-pdf-grid="mix"] .text-2xl { font-size: 20px; }
    #__foh_print_root [data-pdf-grid="mix"] .text-xs { font-size: 10px; }
    #__foh_print_root [data-pdf-grid="metrics"] { gap: 8px; margin-top: 0; }
    #__foh_print_root [data-pdf-grid="metrics"] > div { padding: 8px; }
    #__foh_print_root [data-pdf-grid="metrics"] .text-xs { font-size: 10px; }
    #__foh_print_root [data-pdf-grid="metrics"] .text-2xl { font-size: 18px; }
    #__foh_print_root [data-pdf-grid="metrics"] .mt-3 { margin-top: 8px; }
    #__foh_print_root [data-pdf-grid="metrics"] .mt-2 { margin-top: 6px; }
    #__foh_print_root [data-pdf-grid="metrics"] svg[viewBox="0 0 220 76"] { height: 44px; }
    #__foh_print_root .dashboard-pdf svg[role="img"] { height: 180px; }
    #__foh_print_root .dashboard-pdf svg[role="img"] text { font-size: 14px; }
    #__foh_print_root [data-pdf-section="overview"] { padding: 12px; margin-bottom: 12px; }
    #__foh_print_root [data-pdf-section="departments"] { margin-top: 12px; padding: 12px; }
    #__foh_print_root .dashboard-pdf a { color: inherit; text-decoration: none; }
  </style>`
  exportReportToPdf(`Dashboard_${options.startDate}_to_${options.endDate}`, `${styles}${report.outerHTML}`, { flow: true })
}
