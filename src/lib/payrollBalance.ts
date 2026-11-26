import type { PayrollRunItem } from './types'
const cents = (value: number) => Math.round(value * 100) / 100
/** Revised entitlement minus payments already recorded, signed from the employee's perspective. */
export function payrollBalance(item: Pick<PayrollRunItem, 'payout_amount' | 'paid_amount'>) {
  return cents(Number(item.payout_amount ?? 0) - Number(item.paid_amount ?? item.payout_amount ?? 0))
}
