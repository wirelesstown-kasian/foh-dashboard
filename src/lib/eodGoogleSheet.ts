import { createSign } from 'crypto'
import { getClockWorkDepartment, getEffectiveClockHours, getVisibleManagerNote } from '@/lib/clockUtils'
import type { CashBalanceEntry, EodReport, PayrollRun, PayrollRunItem, ShiftClock } from '@/lib/types'

type GoogleSheetsConfig = {
  clientEmail: string
  privateKey: string
  spreadsheetId: string
  sheetName: string
  cashLogSheetName: string
  payrollSheetName: string
  clockRecordsSheetName: string
  wageReportSheetName: string
}

function getConfig(): GoogleSheetsConfig | null {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n')
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID
  const sheetName = process.env.GOOGLE_SHEETS_EOD_SHEET_NAME ?? 'EOD'
  const cashLogSheetName = process.env.GOOGLE_SHEETS_CASH_LOG_SHEET_NAME ?? 'Cash Log'
  const payrollSheetName = process.env.GOOGLE_SHEETS_PAYROLL_SHEET_NAME ?? 'Payroll'
  const clockRecordsSheetName = process.env.GOOGLE_SHEETS_CLOCK_RECORDS_SHEET_NAME ?? 'Clock Records'
  const wageReportSheetName = process.env.GOOGLE_SHEETS_WAGE_REPORT_SHEET_NAME ?? 'Wage Report'

  if (!clientEmail || !privateKey || !spreadsheetId) return null
  return { clientEmail, privateKey, spreadsheetId, sheetName, cashLogSheetName, payrollSheetName, clockRecordsSheetName, wageReportSheetName }
}

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString('base64url')
}

function getEncodedSheetRangePrefix(sheetName: string) {
  const escapedSheetName = sheetName.replace(/'/g, "''")
  return encodeURIComponent(`'${escapedSheetName}'`)
}

async function getAccessToken(config: GoogleSheetsConfig) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claimSet = base64UrlEncode(JSON.stringify({
    iss: config.clientEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }))

  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claimSet}`)
  signer.end()
  const signature = signer.sign(config.privateKey).toString('base64url')

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claimSet}.${signature}`,
    }),
  })

  if (!response.ok) {
    throw new Error(`Google auth failed (${response.status})`)
  }

  const json = await response.json() as { access_token?: string }
  if (!json.access_token) throw new Error('Google auth token missing')
  return json.access_token
}

async function googleSheetsRequest<T>(url: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Google Sheets request failed (${response.status}): ${body}`)
  }

  return response.json() as Promise<T>
}

async function getSpreadsheetSheetTitles(config: GoogleSheetsConfig, accessToken: string) {
  const metadata = await googleSheetsRequest<{
    sheets?: Array<{ properties?: { title?: string } }>
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}?fields=sheets.properties.title`,
    accessToken,
  )

  return (metadata.sheets ?? []).map(sheet => sheet.properties?.title).filter((title): title is string => Boolean(title))
}

async function getSpreadsheetSheets(config: GoogleSheetsConfig, accessToken: string) {
  const metadata = await googleSheetsRequest<{
    sheets?: Array<{ properties?: { sheetId?: number; title?: string; gridProperties?: { columnCount?: number } } }>
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}?fields=sheets.properties(sheetId,title,gridProperties.columnCount)`,
    accessToken,
  )

  return (metadata.sheets ?? [])
    .map(sheet => ({
      sheetId: sheet.properties?.sheetId,
      title: sheet.properties?.title,
      columnCount: sheet.properties?.gridProperties?.columnCount,
    }))
    .filter((sheet): sheet is { sheetId: number; title: string; columnCount: number | undefined } => typeof sheet.sheetId === 'number' && typeof sheet.title === 'string')
}

async function ensureSheetExists(config: GoogleSheetsConfig, accessToken: string, sheetName: string) {
  const titles = await getSpreadsheetSheetTitles(config, accessToken)
  if (titles.includes(sheetName)) return sheetName

  await googleSheetsRequest(
    `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}:batchUpdate`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            addSheet: {
              properties: { title: sheetName },
            },
          },
        ],
      }),
    }
  )

  return sheetName
}

async function resolveSheetName(config: GoogleSheetsConfig, accessToken: string, preferredSheetName: string, fallbackSheetNames: string[] = []) {
  const titles = await getSpreadsheetSheetTitles(config, accessToken)

  if (titles.includes(preferredSheetName)) return preferredSheetName

  for (const fallback of fallbackSheetNames) {
    if (titles.includes(fallback)) return fallback
  }

  return ensureSheetExists(config, accessToken, preferredSheetName)
}

async function ensureSheetColumnCount(config: GoogleSheetsConfig, accessToken: string, sheetName: string, minColumnCount: number) {
  const sheets = await getSpreadsheetSheets(config, accessToken)
  const sheet = sheets.find(candidate => candidate.title === sheetName)
  if (!sheet || Number(sheet.columnCount ?? 0) >= minColumnCount) return

  await googleSheetsRequest(
    `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}:batchUpdate`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId: sheet.sheetId,
                gridProperties: {
                  columnCount: minColumnCount,
                },
              },
              fields: 'gridProperties.columnCount',
            },
          },
        ],
      }),
    }
  )
}

type EodSheetReport = EodReport & { closed_by?: { name?: string | null } | null }
type PayrollSheetRun = PayrollRun & { payroll_run_items?: PayrollRunItem[] }

const EOD_SHEET_HEADERS = [
  'Session Date',
  'Cash',
  'Batch Total',
  'Gross Revenue',
  'Sales Tax',
  'Tips',
  'Net Revenue',
  'Cash Deposit',
  'Actual Cash On Hand',
  'Delivery Payment',
  'Variance',
  'Variance Note',
  'Memo',
  'Closed By',
  'Updated At',
  'Report ID',
]

const PAYROLL_SHEET_HEADERS = [
  'Pay Date',
  'Period Start',
  'Period End',
  'Run Department',
  'Run Memo',
  'Paid By',
  'Employee',
  'Role',
  'Item Department',
  'Hours',
  'Tips',
  'Base Wages',
  'Guarantee Top-Up',
  'Commission',
  'Deductions',
  'Gross Pay',
  'Net Pay',
  'Payout',
  'Cash Rounding',
  'Auto Clock-Out',
  'Open/Pending Clock',
  'Item Memo',
  'Total Cash',
  'Total Check',
  'Total ACH',
  'Total Unknown',
  'Total Gross',
  'Total Deductions',
  'Total Net',
  'Updated At',
  'Run ID',
  'Item ID',
]

function buildEodSheetRow(report: EodSheetReport) {
  const deliveryPayment = Number(report.delivery_order_amount ?? 0)
  const grossRevenue = Number(report.revenue_total ?? 0)
  const salesTax = Number(report.sales_tax ?? 0)
  const tipTotal = Number(report.tip_total ?? 0)
  const netRevenue = grossRevenue - salesTax - tipTotal
  const displayBatchRevenue = Number(report.batch_total ?? 0) - deliveryPayment

  return [
    report.session_date,
    Number(report.cash_total ?? 0).toFixed(2),
    displayBatchRevenue.toFixed(2),
    grossRevenue.toFixed(2),
    salesTax.toFixed(2),
    tipTotal.toFixed(2),
    netRevenue.toFixed(2),
    Number(report.cash_deposit ?? 0).toFixed(2),
    Number(report.actual_cash_on_hand ?? 0).toFixed(2),
    deliveryPayment.toFixed(2),
    Number(report.cash_variance ?? 0).toFixed(2),
    report.variance_note ?? '',
    report.memo ?? '',
    report.closed_by?.name ?? '',
    report.updated_at,
    report.id,
  ]
}

function buildPayrollSheetRow(run: PayrollSheetRun, item: PayrollRunItem) {
  const unknownTotal = (run.payroll_run_items ?? [])
    .filter(row => !row.payment_method)
    .reduce((sum, row) => sum + Number(row.payout_amount ?? 0), 0)

  return [
    run.pay_date,
    run.start_date,
    run.end_date,
    run.department,
    run.memo ?? '',
    item.payment_method?.toUpperCase() ?? 'UNKNOWN',
    item.employee_name,
    item.role ?? '',
    item.department,
    Number(item.hours ?? 0).toFixed(2),
    Number(item.tips ?? 0).toFixed(2),
    Number(item.base_wages ?? 0).toFixed(2),
    Number(item.guarantee_top_up ?? 0).toFixed(2),
    Number(item.commission ?? 0).toFixed(2),
    Number(item.deductions ?? 0).toFixed(2),
    Number(item.gross_pay ?? 0).toFixed(2),
    Number(item.net_pay ?? 0).toFixed(2),
    Number(item.payout_amount ?? 0).toFixed(2),
    Number(item.cash_rounding ?? 0).toFixed(2),
    item.has_auto_clock_out ? 'Yes' : 'No',
    item.has_open_clock ? 'Yes' : 'No',
    item.memo ?? '',
    Number(run.total_cash ?? 0).toFixed(2),
    Number(run.total_check ?? 0).toFixed(2),
    Number(run.total_ach ?? 0).toFixed(2),
    unknownTotal.toFixed(2),
    Number(run.total_gross ?? 0).toFixed(2),
    Number(run.total_deductions ?? 0).toFixed(2),
    Number(run.total_net ?? 0).toFixed(2),
    run.updated_at,
    run.id,
    item.id,
  ]
}

async function ensurePayrollSheetHeaders(config: GoogleSheetsConfig, accessToken: string) {
  const resolvedSheetName = await resolveSheetName(config, accessToken, config.payrollSheetName, ['Payroll'])
  await ensureSheetColumnCount(config, accessToken, resolvedSheetName, PAYROLL_SHEET_HEADERS.length)
  const encodedSheetName = getEncodedSheetRangePrefix(resolvedSheetName)
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values`
  const headerRange = `${encodedSheetName}!A1:AF1`

  const headerCheck = await googleSheetsRequest<{ values?: string[][] }>(
    `${baseUrl}/${headerRange}`,
    accessToken,
  )
  const currentHeaders = headerCheck.values?.[0] ?? []
  const headersMatch = PAYROLL_SHEET_HEADERS.length === currentHeaders.length && PAYROLL_SHEET_HEADERS.every((header, index) => currentHeaders[index] === header)

  if (!headersMatch) {
    await googleSheetsRequest(
      `${baseUrl}/${headerRange}?valueInputOption=USER_ENTERED`,
      accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({ values: [PAYROLL_SHEET_HEADERS] }),
      }
    )
  }

  return resolvedSheetName
}

async function ensureEodSheetHeaders(config: GoogleSheetsConfig, accessToken: string) {
  const resolvedSheetName = await resolveSheetName(config, accessToken, config.sheetName, ['EOD'])

  const encodedSheetName = getEncodedSheetRangePrefix(resolvedSheetName)
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values`
  const expectedHeaders = EOD_SHEET_HEADERS
  const headerRange = `${encodedSheetName}!A1:P1`

  const headerCheck = await googleSheetsRequest<{ values?: string[][] }>(
    `${baseUrl}/${headerRange}`,
    accessToken,
  )
  const currentHeaders = headerCheck.values?.[0] ?? []
  const headersMatch = expectedHeaders.length === currentHeaders.length && expectedHeaders.every((header, index) => currentHeaders[index] === header)

  if (!headersMatch) {
    await googleSheetsRequest(
      `${baseUrl}/${headerRange}?valueInputOption=USER_ENTERED`,
      accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({ values: [expectedHeaders] }),
      }
    )
  }
}

async function clearEodSheet(config: GoogleSheetsConfig, accessToken: string) {
  const resolvedSheetName = await resolveSheetName(config, accessToken, config.sheetName, ['EOD'])

  const encodedSheetName = getEncodedSheetRangePrefix(resolvedSheetName)
  await googleSheetsRequest(
    `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encodedSheetName}!A:P:clear`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({}),
    }
  )
}

async function clearSheetColumns(config: GoogleSheetsConfig, accessToken: string, sheetName: string, columns: string) {
  const resolvedSheetName = await resolveSheetName(config, accessToken, sheetName, [sheetName])
  const encodedSheetName = getEncodedSheetRangePrefix(resolvedSheetName)
  await googleSheetsRequest(
    `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encodedSheetName}!${columns}:clear`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({}),
    }
  )
}

async function deleteSheetRowByKey(config: GoogleSheetsConfig, accessToken: string, sheetName: string, keyColumn: string, entryKey: string) {
  const resolvedSheetName = await resolveSheetName(config, accessToken, sheetName, [sheetName])
  const encodedSheetName = getEncodedSheetRangePrefix(resolvedSheetName)
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values`
  const sheets = await getSpreadsheetSheets(config, accessToken)
  const sheet = sheets.find(candidate => candidate.title === resolvedSheetName)
  if (!sheet) return { success: true, skipped: true, reason: 'Sheet not found' }

  const keyColumnValues = await googleSheetsRequest<{ values?: string[][] }>(
    `${baseUrl}/${encodedSheetName}!${keyColumn}2:${keyColumn}`,
    accessToken,
  )
  const rowIndex = (keyColumnValues.values ?? []).findIndex(row => row[0] === entryKey)
  if (rowIndex < 0) {
    return { success: true, skipped: true, reason: 'Row not found' }
  }

  const sheetRowIndex = rowIndex + 1
  await googleSheetsRequest(
    `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}:batchUpdate`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: sheet.sheetId,
                dimension: 'ROWS',
                startIndex: sheetRowIndex,
                endIndex: sheetRowIndex + 1,
              },
            },
          },
        ],
      }),
    }
  )

  return { success: true, skipped: false, action: 'deleted', rowNumber: sheetRowIndex + 1 }
}

export async function syncEodReportToGoogleSheet(report: EodSheetReport) {
  const config = getConfig()
  if (!config) {
    return { success: true, skipped: true, reason: 'Google Sheets is not configured.' }
  }

  const accessToken = await getAccessToken(config)
  const resolvedSheetName = await resolveSheetName(config, accessToken, config.sheetName, ['EOD'])
  const encodedSheetName = getEncodedSheetRangePrefix(resolvedSheetName)
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values`

  await ensureEodSheetHeaders(config, accessToken)

  const [reportIdColumn, sessionDateColumn] = await Promise.all([
    googleSheetsRequest<{ values?: string[][] }>(
      `${baseUrl}/${encodedSheetName}!P2:P`,
      accessToken,
    ),
    googleSheetsRequest<{ values?: string[][] }>(
      `${baseUrl}/${encodedSheetName}!A2:A`,
      accessToken,
    ),
  ])

  const values = [buildEodSheetRow(report)]

  const reportIdMatchIndex = (reportIdColumn.values ?? []).findIndex(row => row[0] === report.id)
  const sessionDateMatchIndex = (sessionDateColumn.values ?? []).findIndex(row => row[0] === report.session_date)
  const existingRowIndex = reportIdMatchIndex >= 0 ? reportIdMatchIndex : sessionDateMatchIndex

  if (existingRowIndex >= 0) {
    const rowNumber = existingRowIndex + 2
    await googleSheetsRequest(
      `${baseUrl}/${encodedSheetName}!A${rowNumber}:P${rowNumber}?valueInputOption=USER_ENTERED`,
      accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({ values }),
      }
    )
    return { success: true, skipped: false, action: 'updated', rowNumber }
  }

  await googleSheetsRequest(
    `${baseUrl}/${encodedSheetName}!A:P:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ values }),
    }
  )

  return { success: true, skipped: false, action: 'appended' }
}

export async function resetEodSheetInGoogleSheet(reports: EodSheetReport[]) {
  const config = getConfig()
  if (!config) {
    return { success: true, skipped: true, reason: 'Google Sheets is not configured.' }
  }

  const accessToken = await getAccessToken(config)
  const resolvedSheetName = await resolveSheetName(config, accessToken, config.sheetName, ['EOD'])
  const encodedSheetName = getEncodedSheetRangePrefix(resolvedSheetName)
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values`

  await clearEodSheet(config, accessToken)

  const sortedReports = [...reports].sort((left, right) => {
    if (left.session_date !== right.session_date) return left.session_date < right.session_date ? 1 : -1
    return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
  })

  const values = [EOD_SHEET_HEADERS, ...sortedReports.map(buildEodSheetRow)]

  await googleSheetsRequest(
    `${baseUrl}/${encodedSheetName}!A1:P?valueInputOption=USER_ENTERED`,
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify({ values }),
    }
  )

  return {
    success: true,
    skipped: false,
    action: 'reset',
    rowCount: Math.max(values.length - 1, 0),
  }
}

async function upsertCashLogRow(config: GoogleSheetsConfig, accessToken: string, row: string[], entryId: string) {
  const resolvedSheetName = await resolveSheetName(config, accessToken, config.cashLogSheetName, ['Cash Log'])

  const encodedSheetName = getEncodedSheetRangePrefix(resolvedSheetName)
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values`
  const cashLogHeaders = ['Date', 'Type', 'Amount Entered', 'Current Balance', 'Description', 'Row Key']

  // Write headers if sheet is empty
  const headerCheck = await googleSheetsRequest<{ values?: string[][] }>(
    `${baseUrl}/${encodedSheetName}!A1:F1`,
    accessToken,
  )
  const currentHeaders = headerCheck.values?.[0] ?? []
  const headersMatch = cashLogHeaders.length === currentHeaders.length && cashLogHeaders.every((header, index) => currentHeaders[index] === header)
  if (!headersMatch) {
    await googleSheetsRequest(
      `${baseUrl}/${encodedSheetName}!A1:F1?valueInputOption=USER_ENTERED`,
      accessToken,
      { method: 'PUT', body: JSON.stringify({ values: [cashLogHeaders] }) },
    )
  }

  // Check if row with this ID already exists.
  // Prefer the new Row Key column, but fall back to the old A column layout so existing rows can still be updated.
  const [rowKeyColumn, legacyIdColumn] = await Promise.all([
    googleSheetsRequest<{ values?: string[][] }>(
      `${baseUrl}/${encodedSheetName}!F2:F`,
      accessToken,
    ),
    googleSheetsRequest<{ values?: string[][] }>(
      `${baseUrl}/${encodedSheetName}!A2:A`,
      accessToken,
    ),
  ])
  const rowKeyMatchIndex = (rowKeyColumn.values ?? []).findIndex(r => r[0] === entryId)
  const legacyIdMatchIndex = (legacyIdColumn.values ?? []).findIndex(r => r[0] === entryId)
  const existingIndex = rowKeyMatchIndex >= 0 ? rowKeyMatchIndex : legacyIdMatchIndex

  if (existingIndex >= 0) {
    const rowNumber = existingIndex + 2
    await googleSheetsRequest(
      `${baseUrl}/${encodedSheetName}!A${rowNumber}:F${rowNumber}?valueInputOption=USER_ENTERED`,
      accessToken,
      { method: 'PUT', body: JSON.stringify({ values: [row] }) },
    )
    return 'updated'
  }

  await googleSheetsRequest(
    `${baseUrl}/${encodedSheetName}!A:F:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    accessToken,
    { method: 'POST', body: JSON.stringify({ values: [row] }) },
  )
  return 'appended'
}

export async function syncCashBalanceEntryToGoogleSheet(entry: CashBalanceEntry, cashOnHand?: number) {
  const config = getConfig()
  if (!config) return { success: true, skipped: true, reason: 'Google Sheets is not configured.' }

  const accessToken = await getAccessToken(config)
  const balance = cashOnHand ?? 0

  const row = [
    entry.entry_date,
    entry.entry_type === 'cash_in' ? 'Cash In' : 'Cash Out',
    Number(entry.amount).toFixed(2),
    balance.toFixed(2),
    entry.description,
    entry.id,
  ]

  const action = await upsertCashLogRow(config, accessToken, row, entry.id)
  return { success: true, skipped: false, action }
}

export async function syncPayrollRunToGoogleSheet(run: PayrollSheetRun) {
  const config = getConfig()
  if (!config) return { success: true, skipped: true, reason: 'Google Sheets is not configured.' }

  const items = [...(run.payroll_run_items ?? [])].sort((left, right) => left.display_order - right.display_order || left.employee_name.localeCompare(right.employee_name))
  if (items.length === 0) {
    return { success: true, skipped: true, reason: 'Payroll run has no items.' }
  }

  const accessToken = await getAccessToken(config)
  const resolvedSheetName = await ensurePayrollSheetHeaders(config, accessToken)
  const encodedSheetName = getEncodedSheetRangePrefix(resolvedSheetName)
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values`
  const itemIdColumn = await googleSheetsRequest<{ values?: string[][] }>(
    `${baseUrl}/${encodedSheetName}!AF2:AF`,
    accessToken,
  )

  let updated = 0
  let appended = 0
  const existingItemRows = new Map(
    (itemIdColumn.values ?? [])
      .map((row, index) => [row[0], index + 2] as const)
      .filter(([itemId]) => Boolean(itemId))
  )

  const appendRows: string[][] = []

  for (const item of items) {
    const row = buildPayrollSheetRow(run, item)
    const existingRowNumber = existingItemRows.get(item.id)
    if (existingRowNumber) {
      await googleSheetsRequest(
        `${baseUrl}/${encodedSheetName}!A${existingRowNumber}:AF${existingRowNumber}?valueInputOption=USER_ENTERED`,
        accessToken,
        {
          method: 'PUT',
          body: JSON.stringify({ values: [row] }),
        }
      )
      updated += 1
    } else {
      appendRows.push(row)
    }
  }

  if (appendRows.length > 0) {
    await googleSheetsRequest(
      `${baseUrl}/${encodedSheetName}!A:AF:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ values: appendRows }),
      }
    )
    appended = appendRows.length
  }

  return { success: true, skipped: false, action: updated > 0 && appended === 0 ? 'updated' : appended > 0 && updated === 0 ? 'appended' : 'upserted', updated, appended, sheetName: resolvedSheetName }
}

export async function syncEodCashCountToGoogleSheet(report: {
  id: string
  session_date: string
  actual_cash_on_hand: number
  updated_at: string
  cash_total?: number
  cash_tip?: number
  cash_on_hand?: number
}) {
  const config = getConfig()
  if (!config) return { success: true, skipped: true, reason: 'Google Sheets is not configured.' }

  const accessToken = await getAccessToken(config)
  const actualCash = Number(report.actual_cash_on_hand)
  const amountEntered = Number(report.cash_total ?? 0) + Number(report.cash_tip ?? 0)
  const runningBalance = report.cash_on_hand ?? actualCash

  const row = [
    report.session_date,
    'EOD Cash Count',
    amountEntered.toFixed(2),
    runningBalance.toFixed(2),
    'EOD drawer reconciliation',
    `eod_${report.id}`,
  ]

  const action = await upsertCashLogRow(config, accessToken, row, `eod_${report.id}`)
  return { success: true, skipped: false, action }
}

type ClockSheetRecord = ShiftClock & {
  employee?: {
    name?: string | null
    role?: string | null
    primary_department?: string | null
    schedule_departments?: string[] | null
  } | Array<{
    name?: string | null
    role?: string | null
    primary_department?: string | null
    schedule_departments?: string[] | null
  }> | null
}

const CLOCK_RECORDS_SHEET_HEADERS = [
  'Session Date',
  'Employee',
  'Role',
  'Worked Department',
  'Clock In',
  'Clock Out',
  'Worked Hours',
  'Auto Clock Out',
  'Approval Status',
  'Manager Note',
  'Updated At',
  'Record ID',
]

function getClockRecordEmployee(record: ClockSheetRecord) {
  const relatedEmployee = record.employee
  if (Array.isArray(relatedEmployee)) return relatedEmployee[0] ?? null
  return relatedEmployee ?? null
}

function buildClockRecordSheetRow(record: ClockSheetRecord) {
  const employee = getClockRecordEmployee(record)
  const workDepartmentEmployee = employee
    ? {
        role: employee.role ?? '',
        primary_department: employee.primary_department ?? undefined,
        schedule_departments: employee.schedule_departments ?? [],
      }
    : null
  return [
    record.session_date,
    employee?.name ?? '',
    employee?.role ?? '',
    getClockWorkDepartment(record, workDepartmentEmployee),
    record.clock_in_at,
    record.clock_out_at ?? '',
    getEffectiveClockHours(record).toFixed(2),
    record.auto_clock_out ? 'Yes' : 'No',
    record.approval_status,
    getVisibleManagerNote(record.manager_note),
    record.updated_at,
    record.id,
  ]
}

async function ensureClockRecordsSheetHeaders(config: GoogleSheetsConfig, accessToken: string) {
  const resolvedSheetName = await resolveSheetName(config, accessToken, config.clockRecordsSheetName, ['Clock Records'])
  const encodedSheetName = getEncodedSheetRangePrefix(resolvedSheetName)
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values`
  const headerRange = `${encodedSheetName}!A1:L1`
  const headerCheck = await googleSheetsRequest<{ values?: string[][] }>(`${baseUrl}/${headerRange}`, accessToken)
  const currentHeaders = headerCheck.values?.[0] ?? []
  const headersMatch = CLOCK_RECORDS_SHEET_HEADERS.length === currentHeaders.length && CLOCK_RECORDS_SHEET_HEADERS.every((header, index) => currentHeaders[index] === header)

  if (!headersMatch) {
    await googleSheetsRequest(
      `${baseUrl}/${headerRange}?valueInputOption=USER_ENTERED`,
      accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({ values: [CLOCK_RECORDS_SHEET_HEADERS] }),
      }
    )
  }
}

export async function syncClockRecordToGoogleSheet(record: ClockSheetRecord) {
  const config = getConfig()
  if (!config) return { success: true, skipped: true, reason: 'Google Sheets is not configured.' }

  const accessToken = await getAccessToken(config)
  const resolvedSheetName = await resolveSheetName(config, accessToken, config.clockRecordsSheetName, ['Clock Records'])
  const encodedSheetName = getEncodedSheetRangePrefix(resolvedSheetName)
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values`

  await ensureClockRecordsSheetHeaders(config, accessToken)

  const recordIdColumn = await googleSheetsRequest<{ values?: string[][] }>(
    `${baseUrl}/${encodedSheetName}!L2:L`,
    accessToken,
  )
  const existingRowIndex = (recordIdColumn.values ?? []).findIndex(row => row[0] === record.id)
  const values = [buildClockRecordSheetRow(record)]

  if (existingRowIndex >= 0) {
    const rowNumber = existingRowIndex + 2
    await googleSheetsRequest(
      `${baseUrl}/${encodedSheetName}!A${rowNumber}:L${rowNumber}?valueInputOption=USER_ENTERED`,
      accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({ values }),
      }
    )
    return { success: true, skipped: false, action: 'updated', rowNumber }
  }

  await googleSheetsRequest(
    `${baseUrl}/${encodedSheetName}!A:L:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ values }),
    }
  )

  return { success: true, skipped: false, action: 'appended' }
}

export async function removeClockRecordFromGoogleSheet(recordId: string) {
  const config = getConfig()
  if (!config) return { success: true, skipped: true, reason: 'Google Sheets is not configured.' }
  const accessToken = await getAccessToken(config)
  return deleteSheetRowByKey(config, accessToken, config.clockRecordsSheetName, 'L', recordId)
}

export async function resetClockRecordsSheetInGoogleSheet(records: ClockSheetRecord[]) {
  const config = getConfig()
  if (!config) return { success: true, skipped: true, reason: 'Google Sheets is not configured.' }

  const accessToken = await getAccessToken(config)
  const resolvedSheetName = await resolveSheetName(config, accessToken, config.clockRecordsSheetName, ['Clock Records'])
  const encodedSheetName = getEncodedSheetRangePrefix(resolvedSheetName)
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values`

  await clearSheetColumns(config, accessToken, resolvedSheetName, 'A:L')

  const sortedRecords = [...records].sort((left, right) => {
    if (left.session_date !== right.session_date) return left.session_date < right.session_date ? 1 : -1
    return right.clock_in_at.localeCompare(left.clock_in_at)
  })
  const values = [CLOCK_RECORDS_SHEET_HEADERS, ...sortedRecords.map(buildClockRecordSheetRow)]

  await googleSheetsRequest(
    `${baseUrl}/${encodedSheetName}!A1:L?valueInputOption=USER_ENTERED`,
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify({ values }),
    }
  )

  return { success: true, skipped: false, action: 'reset', rowCount: Math.max(values.length - 1, 0) }
}

export type WageSheetRow = {
  periodStart: string
  periodEnd: string
  view: string
  employeeName: string
  role: string
  hours: number
  tips: number
  tipRate: number | null
  tipCap: number | null
  baseWages: number
  guaranteeTopUp: number
  totalEarnings: number
  status: string
  rowKey: string
}

const WAGE_REPORT_SHEET_HEADERS = [
  'Period Start',
  'Period End',
  'View',
  'Employee',
  'Role',
  'Hours',
  'Tips',
  'Tips Per Hour',
  'Tip Cap',
  'Base Wages',
  'Guaranteed Top-Up',
  'Total Earnings',
  'Status',
  'Row Key',
]

function buildWageReportSheetRow(row: WageSheetRow) {
  return [
    row.periodStart,
    row.periodEnd,
    row.view,
    row.employeeName,
    row.role,
    row.hours.toFixed(2),
    row.tips.toFixed(2),
    row.tipRate !== null ? row.tipRate.toFixed(2) : '',
    row.tipCap !== null ? row.tipCap.toFixed(2) : '',
    row.baseWages.toFixed(2),
    row.guaranteeTopUp.toFixed(2),
    row.totalEarnings.toFixed(2),
    row.status,
    row.rowKey,
  ]
}

export async function resetWageReportSheetInGoogleSheet(rows: WageSheetRow[]) {
  const config = getConfig()
  if (!config) return { success: true, skipped: true, reason: 'Google Sheets is not configured.' }

  const accessToken = await getAccessToken(config)
  const resolvedSheetName = await resolveSheetName(config, accessToken, config.wageReportSheetName, ['Wage Report'])
  const encodedSheetName = getEncodedSheetRangePrefix(resolvedSheetName)
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values`

  await clearSheetColumns(config, accessToken, resolvedSheetName, 'A:N')

  const values = [WAGE_REPORT_SHEET_HEADERS, ...rows.map(buildWageReportSheetRow)]
  await googleSheetsRequest(
    `${baseUrl}/${encodedSheetName}!A1:N?valueInputOption=USER_ENTERED`,
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify({ values }),
    }
  )

  return { success: true, skipped: false, action: 'reset', rowCount: Math.max(values.length - 1, 0) }
}
