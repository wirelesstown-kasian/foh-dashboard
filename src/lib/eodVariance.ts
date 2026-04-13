export function getExpectedCashDeposit(cashRevenue: number, cashTip: number) {
  return cashRevenue + cashTip
}

export function getCashVariance(actualCashOnHand: number, cashRevenue: number, cashTip: number) {
  return actualCashOnHand - getExpectedCashDeposit(cashRevenue, cashTip)
}
