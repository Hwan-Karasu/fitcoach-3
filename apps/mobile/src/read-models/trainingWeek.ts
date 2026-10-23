type WeekEntry = Readonly<{ actualDate: string | null; workingSets: number }>;

/** Понедельник недели, в которую входит дата `ГГГГ-ММ-ДД` (неделя Пн–Вс), в том же формате. */
export function weekStart(localDate: string): string {
  const [year, month, day] = localDate.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

/**
 * Число тренировок с рабочими подходами за текущую неделю Пн–Вс по фактической дате дневника.
 * Нет тренировок с известной датой — `null` («нет данных»), а не ноль;
 * если датированные тренировки были раньше, но не на этой неделе, — 0.
 */
export function workoutsInWeek(entries: readonly WeekEntry[], today: string): number | null {
  const started = entries.filter((entry) => entry.workingSets > 0);
  if (started.every((entry) => entry.actualDate === null)) return null;
  const monday = weekStart(today);
  const sunday = new Date(`${monday}T00:00:00Z`);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  const last = sunday.toISOString().slice(0, 10);
  return started.filter((entry) => entry.actualDate !== null && entry.actualDate >= monday && entry.actualDate <= last).length;
}
