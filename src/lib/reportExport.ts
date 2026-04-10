function buildPrintWindow(title: string, bodyHtml: string) {
  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title}</title>
        <style>
          @page { size: letter landscape; margin: 0.45in; }
          * { box-sizing: border-box; }
          html, body { width: 100%; }
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            color: #111827;
            background: #ffffff;
            font-size: 11px;
            line-height: 1.35;
          }
          .report-shell {
            width: 100%;
            max-width: 10.1in;
            margin: 0 auto;
          }
          h1, h2, h3 { margin: 0 0 10px; line-height: 1.15; }
          h1 { font-size: 22px; }
          h2 { font-size: 16px; }
          h3 { font-size: 13px; margin-top: 14px; }
          p { margin: 0 0 8px; }
          table { width: 100%; border-collapse: collapse; margin-top: 14px; page-break-inside: avoid; }
          th, td {
            border: 1px solid #d1d5db;
            padding: 6px 8px;
            font-size: 10.5px;
            text-align: left;
            vertical-align: top;
          }
          th { background: #f3f4f6; }
          .summary {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 10px;
            margin: 14px 0;
          }
          .card {
            border: 1px solid #d1d5db;
            border-radius: 12px;
            padding: 10px;
            min-height: 74px;
            page-break-inside: avoid;
          }
          .card strong {
            display: block;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: #6b7280;
            margin-bottom: 6px;
          }
          .metric {
            font-size: 18px;
            font-weight: 700;
            line-height: 1.1;
          }
          .muted { color: #6b7280; }
          .right { text-align: right; }
          .report-grid {
            display: grid;
            grid-template-columns: minmax(0, 1.4fr) minmax(260px, 0.9fr);
            gap: 14px;
            align-items: start;
          }
          .compact-table th, .compact-table td { padding-top: 5px; padding-bottom: 5px; }
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        <div class="report-shell">
          ${bodyHtml}
        </div>
      </body>
    </html>
  `
}

export function exportReportToPdf(title: string, bodyHtml: string) {
  if (typeof window === 'undefined') return
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.style.visibility = 'hidden'

  const cleanup = () => {
    window.setTimeout(() => {
      iframe.remove()
    }, 150)
  }

  iframe.onload = () => {
    const frameWindow = iframe.contentWindow
    if (!frameWindow) {
      cleanup()
      return
    }

    const runPrint = () => {
      frameWindow.focus()
      frameWindow.print()
      cleanup()
    }

    frameWindow.onafterprint = cleanup
    window.setTimeout(runPrint, 250)
  }

  document.body.appendChild(iframe)
  const frameDocument = iframe.contentDocument
  if (!frameDocument) {
    cleanup()
    return
  }

  frameDocument.open()
  frameDocument.write(buildPrintWindow(title, bodyHtml))
  frameDocument.close()
}
