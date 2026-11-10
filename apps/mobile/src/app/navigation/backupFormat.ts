const NBSP = String.fromCharCode(0xa0);
const two = (value: number) => String(value).padStart(2, "0");
const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

/** Время копии для карточки «Последняя копия»: «Сегодня, 09:12», «Вчера, 21:40», иначе «09.11.2026, 09:12» (местное время телефона). */
export function backupMoment(iso: string, now: Date = new Date()): string {
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return "—";
  const time = `${two(moment.getHours())}:${two(moment.getMinutes())}`;
  const days = Math.round((dayStart(now) - dayStart(moment)) / DAY_MS);
  if (days === 0) return `Сегодня, ${time}`;
  if (days === 1) return `Вчера, ${time}`;
  return `${two(moment.getDate())}.${two(moment.getMonth() + 1)}.${moment.getFullYear()}, ${time}`;
}

/** Размер файла копии: «2480 КБ» (как в макете), от 10 МБ — «71,3 МБ». */
export function backupSize(bytes: number): string {
  const kb = Math.ceil(bytes / 1024);
  return kb < 10 * 1024 ? `${kb}${NBSP}КБ` : `${(kb / 1024).toFixed(1).replace(".", ",")}${NBSP}МБ`;
}
