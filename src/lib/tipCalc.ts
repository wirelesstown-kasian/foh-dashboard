const HOUSE_CUT = 0.15

export interface TipEntry {
  employee_id: string
  hours_worked: number
  tip_pool_hourly_rate?: number | null
}

export interface TipResult {
  employee_id: string
  hours_worked: number
  tip_share: number      // proportion (0-1)
  house_deduction: number
  net_tip: number
  fixed_tip_rate: number | null
  is_fixed_tip: boolean
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function roundRatio(value: number) {
  return Math.round(value * 10000) / 10000
}

export function calculateTips(tipTotal: number, entries: TipEntry[]): TipResult[] {
  const totalHours = entries.reduce((sum, e) => sum + e.hours_worked, 0)
  if (totalHours === 0) {
    return entries.map(e => ({
      ...e,
      tip_share: 0,
      house_deduction: 0,
      net_tip: 0,
      fixed_tip_rate: e.tip_pool_hourly_rate && e.tip_pool_hourly_rate > 0 ? e.tip_pool_hourly_rate : null,
      is_fixed_tip: !!e.tip_pool_hourly_rate && e.tip_pool_hourly_rate > 0,
    }))
  }

  const distributable = tipTotal * (1 - HOUSE_CUT)
  const payoutByEmployee = new Map<string, number>()
  let remainingPool = distributable
  let remainingEntries = entries.filter(e => e.hours_worked > 0)

  while (remainingEntries.length > 0 && remainingPool > 0) {
    const remainingHours = remainingEntries.reduce((sum, e) => sum + e.hours_worked, 0)
    if (remainingHours <= 0) break

    const cappedThisPass: TipEntry[] = []
    for (const entry of remainingEntries) {
      const capRate = Number(entry.tip_pool_hourly_rate ?? 0)
      if (capRate <= 0) continue

      const maxTip = roundMoney(entry.hours_worked * capRate)
      const uncappedShare = remainingPool * (entry.hours_worked / remainingHours)
      if (uncappedShare > maxTip) {
        cappedThisPass.push(entry)
      }
    }

    if (cappedThisPass.length === 0) {
      for (const entry of remainingEntries) {
        const share = remainingPool * (entry.hours_worked / remainingHours)
        payoutByEmployee.set(entry.employee_id, roundMoney(share))
      }
      remainingPool = 0
      break
    }

    for (const entry of cappedThisPass) {
      const maxTip = roundMoney(entry.hours_worked * Number(entry.tip_pool_hourly_rate ?? 0))
      payoutByEmployee.set(entry.employee_id, maxTip)
      remainingPool = Math.max(0, remainingPool - maxTip)
    }

    const cappedIds = new Set(cappedThisPass.map(entry => entry.employee_id))
    remainingEntries = remainingEntries.filter(entry => !cappedIds.has(entry.employee_id))
  }

  return entries.map(e => {
    const fixedRate = e.tip_pool_hourly_rate && e.tip_pool_hourly_rate > 0 ? e.tip_pool_hourly_rate : null
    const houseShare = e.hours_worked / totalHours
    const houseDeduction = tipTotal * HOUSE_CUT * houseShare
    const netTip = payoutByEmployee.get(e.employee_id) ?? 0
    return {
      employee_id: e.employee_id,
      hours_worked: e.hours_worked,
      tip_share: distributable > 0 ? roundRatio(netTip / distributable) : 0,
      house_deduction: roundMoney(houseDeduction),
      net_tip: roundMoney(netTip),
      fixed_tip_rate: fixedRate,
      is_fixed_tip: fixedRate !== null,
    }
  })
}
