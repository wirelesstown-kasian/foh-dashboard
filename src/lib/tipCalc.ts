const HOUSE_CUT = 0.15

export interface TipEntry {
  employee_id: string
  hours_worked: number
}

export interface TipResult {
  employee_id: string
  hours_worked: number
  tip_share: number      // proportion (0-1)
  house_deduction: number
  net_tip: number
}

export function calculateTips(tipTotal: number, entries: TipEntry[]): TipResult[] {
  const totalHours = entries.reduce((sum, e) => sum + e.hours_worked, 0)
  if (totalHours === 0) return entries.map(e => ({ ...e, tip_share: 0, house_deduction: 0, net_tip: 0 }))

  const distributable = tipTotal * (1 - HOUSE_CUT)

  return entries.map(e => {
    const share = e.hours_worked / totalHours
    const gross = distributable * share
    const houseDeduction = tipTotal * HOUSE_CUT * share
    return {
      employee_id: e.employee_id,
      hours_worked: e.hours_worked,
      tip_share: share,
      house_deduction: Math.round(houseDeduction * 100) / 100,
      net_tip: Math.round(gross * 100) / 100,
    }
  })
}
