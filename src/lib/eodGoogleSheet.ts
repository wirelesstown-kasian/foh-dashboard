import { createSign } from 'crypto'
import type { CashBalanceEntry, EodReport } from '@/lib/types'

type GoogleSheetsConfig = {
  clientEmail: string
  privateKey: string
  spreadsheetId: string
  sheetName: string
  cashLogSheetName: string
}

function getConfig(): GoogleSheetsConfig | null {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n')
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID
  const sheetName = process.env.GOOGLE_SHEETS_EOD_SHEET_NAME ?? 'EOD'
  const cashLogSheetName = process.env.GOOGLE_SHEETS_CASH_LOG_SHEET_NAME ?? 'Cash Log'

  if (!clientEmail || !privateKey || !spreadsheetId) return null
  return { clientEmail, privateKey, spreadsheetId, sheetName, cashLogSheetName }
}

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString('base64url')
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

export async function syncEodReportToGoogleSheet(report: EodReport & { closed_by?: { name?: string | null } | null }) {
  const config = getConfig()
  if (!config) {
    return { success: true, skipped: true, reason: 'Google Sheets is not configured.' }
  }

  const accessToken = await getAccessToken(config)
  const encodedSheetName = encodeURIComponent(config.sheetName)
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values`

  const headersRow = [[
    'Session Date',
    'Closed By',
    'Cash Revenue',
    'Batch Revenue',
    'Gross Revenue',
    'Sales Tax',
    'CC Tip',
    'Cash Tip',
    'Tip Total',
    'Expected Cash',
    'Actual Cash On Hand',
    'Variance',
    'Variance Note',
    'Memo',
    'Updated At',
  ]]

  const headerCheck = await googleSheetsRequest<{ values?: string[][] }>(
    `${baseUrl}/${encodedSheetName}!A1:O1`,
    accessToken,
  )
  if (!headerCheck.values || headerCheck.values.length === 0 || headerCheck.values[0].length === 0) {
    await googleSheetsRequest(
      `${baseUrl}/${encodedSheetName}!A1:O1?valueInputOption=USER_ENTERED`,
      accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({ values: headersRow }),
      }
    )
  }

  const sessionDateColumn = await googleSheetsRequest<{ values?: string[][] }>(
    `${baseUrl}/${encodedSheetName}!A2:A`,
    accessToken,
  )

  const values = [[
    report.session_date,
    report.closed_by?.name ?? '',
    Number(report.cash_total).toFixed(2),
    Number(report.batch_total).toFixed(2),
    Number(report.revenue_total).toFixed(2),
    Number(report.sales_tax ?? 0).toFixed(2),
    Number(report.cc_tip).toFixed(2),
    Number(report.cash_tip).toFixed(2),
    Number(report.tip_total).toFixed(2),
    Number(report.cash_deposit).toFixed(2),
    Number(report.actual_cash_on_hand).toFixed(2),
    Number(report.cash_variance).toFixed(2),
    report.variance_note ?? '',
    report.memo ?? '',
    report.updated_at,
  ]]

  const existingRowIndex = (sessionDateColumn.values ?? []).findIndex(row => row[0] === report.session_date)

  if (existingRowIndex >= 0) {
    const rowNumber = existingRowIndex + 2
    await googleSheetsRequest(
      `${baseUrl}/${encodedSheetName}!A${rowNumber}:O${rowNumber}?valueInputOption=USER_ENTERED`,
      accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({ values }),
      }
    )
    return { success: true, skipped: false, action: 'updated', rowNumber }
  }

  await googleSheetsRequest(
    `${baseUrl}/${encodedSheetName}!A:O:append?valueInputOption=USER_ENTERED`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ values }),
    }
  )

  return { success: true, skipped: false, action: 'appended' }
}

export async function syncCashBalanceEntryToGoogleSheet(entry: CashBalanceEntry) {
  const config = getConfig()
  if (!config) {
    return { success: true, skipped: true, reason: 'Google Sheets is not configured.' }
  }

  const accessToken = await getAccessToken(config)
  const encodedSheetName = encodeURIComponent(config.cashLogSheetName)
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values`

  const headersRow = [[
    'Entry ID',
    'Date',
    'Type',
    'Amount',
    'Signed Amount',
    'Description',
    'Created At',
    'Updated At',
  ]]

  const headerCheck = await googleSheetsRequest<{ values?: string[][] }>(
    `${baseUrl}/${encodedSheetName}!A1:H1`,
    accessToken,
  )
  if (!headerCheck.values || headerCheck.values.length === 0 || headerCheck.values[0].length === 0) {
    await googleSheetsRequest(
      `${baseUrl}/${encodedSheetName}!A1:H1?valueInputOption=USER_ENTERED`,
      accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({ values: headersRow }),
      }
    )
  }

  const idColumn = await googleSheetsRequest<{ values?: string[][] }>(
    `${baseUrl}/${encodedSheetName}!A2:A`,
    accessToken,
  )

  const signedAmount = entry.entry_type === 'cash_in' ? Number(entry.amount) : Number(entry.amount) * -1
  const values = [[
    entry.id,
    entry.entry_date,
    entry.entry_type === 'cash_in' ? 'Cash In' : 'Cash Out',
    Number(entry.amount).toFixed(2),
    signedAmount.toFixed(2),
    entry.description,
    entry.created_at,
    entry.updated_at,
  ]]

  const existingRowIndex = (idColumn.values ?? []).findIndex(row => row[0] === entry.id)

  if (existingRowIndex >= 0) {
    const rowNumber = existingRowIndex + 2
    await googleSheetsRequest(
      `${baseUrl}/${encodedSheetName}!A${rowNumber}:H${rowNumber}?valueInputOption=USER_ENTERED`,
      accessToken,
      {
        method: 'PUT',
        body: JSON.stringify({ values }),
      }
    )
    return { success: true, skipped: false, action: 'updated', rowNumber }
  }

  await googleSheetsRequest(
    `${baseUrl}/${encodedSheetName}!A:H:append?valueInputOption=USER_ENTERED`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ values }),
    }
  )

  return { success: true, skipped: false, action: 'appended' }
}
