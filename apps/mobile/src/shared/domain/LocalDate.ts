/**
 * `YYYY-MM-DD` — существующий календарный день по григорианскому правилу, год от 1.
 * Проверка в UTC: переход на летнее время и часовой пояс устройства на результат не влияют.
 * `setUTCFullYear` вместо `Date.UTC`, потому что `Date.UTC` отображает годы 0–99 на 1900–1999.
 */
export function isLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  if (year < 1) return false;
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}
