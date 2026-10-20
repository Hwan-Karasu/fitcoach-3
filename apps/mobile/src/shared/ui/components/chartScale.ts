/** Округлённый шаг шкалы (1, 2, 5 × 10ⁿ) не меньше `raw`; для нулевого или некорректного значения — 1. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const ratio = raw / power;
  return (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10) * power;
}

/** Ширина и промежуток столбцов/точек, чтобы `count` штук ровно уместились в `available` без прокрутки. */
export function chartLayout(available: number, count: number, maxBar: number): Readonly<{ barWidth: number; spacing: number }> {
  const slot = Math.max(available, 1) / Math.max(count, 1);
  const barWidth = Math.max(Math.min(slot - 3, maxBar), 2);
  return { barWidth, spacing: Math.max(slot - barWidth, 0) };
}
