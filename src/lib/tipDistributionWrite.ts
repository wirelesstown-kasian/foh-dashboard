type TipDistributionInsertRow = {
  eod_report_id: string
  employee_id: string
  start_time?: string | null
  end_time?: string | null
  hours_worked: number
  tip_share: number
  house_deduction: number
  net_tip: number
}

function isMissingShiftTimeColumnError(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes('tip-distributions')
    && (normalized.includes('start_time') || normalized.includes('end_time'))
    && normalized.includes('schema cache')
}

export async function insertTipDistributionsWithFallback(
  client: { from: (table: string) => { insert: (rows: unknown[]) => PromiseLike<{ error: { message: string } | null }> } },
  rows: TipDistributionInsertRow[]
) {
  const initial = await client.from('tip_distributions').insert(rows)
  if (!initial.error) return

  if (!isMissingShiftTimeColumnError(initial.error.message)) {
    throw new Error(initial.error.message)
  }

  const fallbackRows = rows.map(row => {
    const rest = { ...row }
    delete rest.start_time
    delete rest.end_time
    return rest
  })
  const fallback = await client.from('tip_distributions').insert(fallbackRows)
  if (fallback.error) {
    throw new Error(fallback.error.message)
  }
}
