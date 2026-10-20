/** Общие чистые подписи времени и чисел на русском (длительность, местное время, склонение) — проверяются тестами. */

/** Склонение по числу: 1 выполнение, 2 выполнения, 5 выполнений. */
export function plural(count: number, one: string, few: string, many: string): string {
  const tail = Math.abs(count) % 100;
  const last = tail % 10;
  if (tail >= 11 && tail <= 14) return many;
  return last === 1 ? one : last >= 2 && last <= 4 ? few : many;
}

/** Длительность занятия: «1 ч 05 мин», «45 мин», «2 ч»; меньше минуты — «меньше минуты». */
export function durationText(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "меньше минуты";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours === 0 ? `${rest} мин` : rest === 0 ? `${hours} ч` : `${hours} ч ${String(rest).padStart(2, "0")} мин`;
}

/** Местное время устройства из момента UTC: «09:05». */
export function timeText(instant: string): string {
  const date = new Date(instant);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
