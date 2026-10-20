/** Неделя и месяц дневника (P-10, P-11): чистые функции над локальными датами `ГГГГ-ММ-ДД`, понедельник — первый день недели. */
const pad = (value: number) => String(value).padStart(2, "0");

function utc(localDate: string): Date {
  const [year, month, day] = localDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day));
}

const iso = (date: Date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

/** Семь дат недели с понедельника по воскресенье, в которую входит `localDate`. */
export function weekOf(localDate: string): readonly string[] {
  const base = utc(localDate);
  const offset = (base.getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, index) => iso(new Date(base.getTime() + (index - offset) * 86_400_000)));
}

/** `ГГГГ-ММ` месяца даты. */
export const monthStart = (localDate: string): string => localDate.slice(0, 7);

/** Месяц со сдвигом на `delta` месяцев. */
export function shiftMonth(month: string, delta: number): string {
  const [year, number] = month.split("-").map(Number) as [number, number];
  const index = year * 12 + (number - 1) + delta;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** Сетка месяца по неделям (пн–вс); ячейки вне месяца — `null`. */
export function monthGrid(month: string): readonly (readonly (string | null)[])[] {
  const [year, number] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(year, number - 1, 1));
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, index) => `${month}-${pad(index + 1)}`)];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, row) => cells.slice(row * 7, row * 7 + 7));
}

/** Первый день месяца и последний — границы диапазона для отметок календаря. */
export function monthRange(month: string): Readonly<{ from: string; to: string }> {
  const [year, number] = month.split("-").map(Number) as [number, number];
  return { from: `${month}-01`, to: `${month}-${pad(new Date(Date.UTC(year, number, 0)).getUTCDate())}` };
}
