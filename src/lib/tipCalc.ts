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
  const fixedEntries = entries.filter(e => (e.tip_pool_hourly_rate ?? 0) > 0 && e.hours_worked > 0)
  const regularEntries = entries.filter(e => !((e.tip_pool_hourly_rate ?? 0) > 0) && e.hours_worked > 0)
  const requestedFixedTotal = fixedEntries.reduce((sum, e) => sum + e.hours_worked * Number(e.tip_pool_hourly_rate ?? 0), 0)
  const fixedScale = requestedFixedTotal > distributable && requestedFixedTotal > 0
    ? distributable / requestedFixedTotal
    : 1
  const fixedPayoutByEmployee = new Map(
    fixedEntries.map(e => [e.employee_id, roundMoney(e.hours_worked * Number(e.tip_pool_hourly_rate ?? 0) * fixedScale)])
  )
  const fixedPayoutTotal = [...fixedPayoutByEmployee.values()].reduce((sum, value) => sum + value, 0)
  const remainingDistributable = Math.max(0, distributable - fixedPayoutTotal)
  const regularHours = regularEntries.reduce((sum, e) => sum + e.hours_worked, 0)

  return entries.map(e => {
    const fixedRate = e.tip_pool_hourly_rate && e.tip_pool_hourly_rate > 0 ? e.tip_pool_hourly_rate : null
    if (fixedRate) {
      const netTip = fixedPayoutByEmployee.get(e.employee_id) ?? 0
      const houseShare = e.hours_worked / totalHours
      return {
        employee_id: e.employee_id,
        hours_worked: e.hours_worked,
        tip_share: distributable > 0 ? roundRatio(netTip / distributable) : 0,
        house_deduction: roundMoney(tipTotal * HOUSE_CUT * houseShare),
        net_tip: netTip,
        fixed_tip_rate: fixedRate,
        is_fixed_tip: true,
      }
    }

    const share = regularHours > 0 ? e.hours_worked / regularHours : 0
    const netTip = remainingDistributable * share
    const houseShare = e.hours_worked / totalHours
    const houseDeduction = tipTotal * HOUSE_CUT * houseShare
    return {
      employee_id: e.employee_id,
      hours_worked: e.hours_worked,
      tip_share: distributable > 0 ? roundRatio(netTip / distributable) : 0,
      house_deduction: roundMoney(houseDeduction),
      net_tip: roundMoney(netTip),
      fixed_tip_rate: null,
      is_fixed_tip: false,
    }
  })
}
