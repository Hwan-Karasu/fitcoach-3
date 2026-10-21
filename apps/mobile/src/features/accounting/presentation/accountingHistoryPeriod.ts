/** Оплата относится к фактической дате оплаты, кредитная операция — к локальному дню её записи. */
export function accountingHistoryDate(createdAt: string, paidOn?: string): string {
  if (paidOn !== undefined) return paidOn;
  const date = new Date(createdAt);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Переход месяца с переносом года; не зависит от часов и летнего времени. */
export function shiftAccountingMonth(month: string, delta: number): string {
  const [year, index] = month.split("-").map(Number) as [number, number];
  const absolute = year * 12 + index - 1 + delta;
  return `${Math.floor(absolute / 12)}-${String(((absolute % 12) + 12) % 12 + 1).padStart(2, "0")}`;
}
