import type * as XLSX from 'xlsx'

export type ExcelValue = string | number | null
export type ExcelColumn = {
  label: string
  format?: 'money' | 'decimal' | 'integer'
  total?: boolean
}
export type ExcelReportSheet = {
  name: string
  title: string
  metadata: [string, ExcelValue][]
  columns: ExcelColumn[]
  rows: ExcelValue[][]
}

const formats = { money: '"$"#,##0.00;[Red]("$"#,##0.00)', decimal: '#,##0.00', integer: '#,##0' }

export function buildReportWorkbook(xlsx: typeof XLSX, sheets: ExcelReportSheet[]) {
  const workbook = xlsx.utils.book_new()
  for (const sheet of sheets) {
    const headerRow = sheet.metadata.length + 2
    const total = sheet.columns.map((column, index) => index === 0 ? 'Period Total'
      : column.format && column.total !== false
        ? sheet.rows.reduce((sum, row) => sum + (typeof row[index] === 'number' ? row[index] as number : 0), 0)
        : null)
    const values: ExcelValue[][] = [
      [sheet.title], ...sheet.metadata, [], sheet.columns.map(column => column.label),
      ...sheet.rows, ...(sheet.rows.length ? [total] : []),
    ]
    if (values.some(row => row.some(value => typeof value === 'number' && !Number.isFinite(value)))) {
      throw new Error('The report contains an invalid number. Refresh the report and try again.')
    }
    const worksheet = xlsx.utils.aoa_to_sheet(values)
    worksheet['!cols'] = sheet.columns.map((column, index) => ({
      wch: Math.min(60, sheet.rows.reduce((width, row) => Math.max(width,
        typeof row[index] === 'string' ? (row[index] as string).length + 2 : 14), Math.max(14, column.label.length + 2))),
    }))
    worksheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: sheet.columns.length - 1 } }]
    worksheet['!autofilter'] = { ref: xlsx.utils.encode_range({
      s: { r: headerRow, c: 0 }, e: { r: headerRow + sheet.rows.length, c: sheet.columns.length - 1 },
    }) }
    for (let row = headerRow + 1; row < values.length; row++) {
      sheet.columns.forEach((column, col) => {
        const cell = worksheet[xlsx.utils.encode_cell({ r: row, c: col })]
        if (cell?.t === 'n' && column.format) cell.z = formats[column.format]
      })
    }
    xlsx.utils.book_append_sheet(workbook, worksheet, sheet.name)
  }
  return workbook
}

export async function exportReportToExcel(filename: string, sheets: ExcelReportSheet[]) {
  const xlsx = await import('xlsx')
  const workbook = buildReportWorkbook(xlsx, sheets)
  xlsx.writeFileXLSX(workbook, `${filename.replace(/[^a-zA-Z0-9_-]+/g, '_')}.xlsx`, { compression: true })
}
