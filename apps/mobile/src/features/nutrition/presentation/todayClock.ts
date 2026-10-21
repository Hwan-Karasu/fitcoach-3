/** Миллисекунды до первой секунды следующих суток по часам устройства (запас в секунду, чтобы таймер не сработал до полуночи). */
export function msUntilNextLocalDay(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return Math.max(1000, next.getTime() - now.getTime());
}
