function buildPrintWindow(title: string, bodyHtml: string) {
  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
          h1, h2, h3 { margin: 0 0 12px; }
          p { margin: 0 0 8px; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; }
          th, td { border: 1px solid #d1d5db; padding: 8px; font-size: 12px; text-align: left; }
          th { background: #f3f4f6; }
          .summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 16px 0; }
          .card { border: 1px solid #d1d5db; border-radius: 12px; padding: 12px; }
          .muted { color: #6b7280; }
          .right { text-align: right; }
        </style>
      </head>
      <body>
        ${bodyHtml}
      </body>
    </html>
  `
}

export function exportReportToPdf(title: string, bodyHtml: string) {
  if (typeof window === 'undefined') return
  const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=960,height=720')
  if (!printWindow) return
  printWindow.document.open()
  printWindow.document.write(buildPrintWindow(title, bodyHtml))
  printWindow.document.close()
  printWindow.focus()
  window.setTimeout(() => {
    printWindow.print()
  }, 200)
}
