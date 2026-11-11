/** Чистые правила разбора данных Health Connect по локальным дням; платформа и часовой пояс приходят снаружи (`localDateOf`). */

export interface SleepStageInput {
  readonly startTime: string;
  readonly endTime: string;
  /** Тип этапа Health Connect: 1 бодрствование, 3 вне кровати, 7 бодрствование в кровати — не сон. */
  readonly stage: number;
}

export interface SleepSessionInput {
  readonly startTime: string;
  readonly endTime: string;
  readonly stages?: readonly SleepStageInput[];
}

const NOT_ASLEEP_STAGES: ReadonlySet<number> = new Set([1, 3, 7]);

interface Interval { readonly start: number; readonly end: number }

const ms = (iso: string) => Date.parse(iso);

/** Вычесть из интервала «не сон»: остаются отрезки сна внутри сессии. */
function asleepIntervals(session: SleepSessionInput): readonly Interval[] {
  const whole = { start: ms(session.startTime), end: ms(session.endTime) };
  if (!(whole.end > whole.start)) return [];
  const awake = (session.stages ?? []).filter((stage) => NOT_ASLEEP_STAGES.has(stage.stage))
    .map((stage) => ({ start: Math.max(whole.start, ms(stage.startTime)), end: Math.min(whole.end, ms(stage.endTime)) }))
    .filter((interval) => interval.end > interval.start).sort((a, b) => a.start - b.start);
  const result: Interval[] = [];
  let cursor = whole.start;
  for (const gap of awake) {
    if (gap.start > cursor) result.push({ start: cursor, end: gap.start });
    cursor = Math.max(cursor, gap.end);
  }
  if (whole.end > cursor) result.push({ start: cursor, end: whole.end });
  return result;
}

function unionLength(intervals: readonly Interval[]): number {
  let total = 0;
  let current: Interval | null = null;
  for (const interval of [...intervals].sort((a, b) => a.start - b.start)) {
    if (current === null || interval.start > current.end) { if (current !== null) total += current.end - current.start; current = { ...interval }; }
    else current = { start: current.start, end: Math.max(current.end, interval.end) };
  }
  return current === null ? total : total + (current.end - current.start);
}

/**
 * Сон по дням пробуждения (минуты): сессии, которые накладываются друг на друга (телефон и часы пишут одну ночь), считаются один раз — берётся объединение
 * отрезков сна, этапы бодрствования вычитаются; ночь относится к дате окончания последней сессии группы. Сессии без длительности пропускаются.
 */
export function sleepMinutesByWakeDate(sessions: readonly SleepSessionInput[], localDateOf: (instant: string) => string): ReadonlyMap<string, number> {
  const valid = sessions.filter((session) => ms(session.endTime) > ms(session.startTime)).sort((a, b) => ms(a.startTime) - ms(b.startTime));
  const clusters: { end: number; endIso: string; intervals: Interval[] }[] = [];
  for (const session of valid) {
    const last = clusters[clusters.length - 1];
    const end = ms(session.endTime);
    if (last !== undefined && ms(session.startTime) < last.end) {
      last.intervals.push(...asleepIntervals(session));
      if (end > last.end) { last.end = end; last.endIso = session.endTime; }
    } else clusters.push({ end, endIso: session.endTime, intervals: [...asleepIntervals(session)] });
  }
  const result = new Map<string, number>();
  for (const cluster of clusters) {
    const minutes = Math.round(unionLength(cluster.intervals) / 60_000);
    if (minutes <= 0) continue;
    const date = localDateOf(cluster.endIso);
    result.set(date, (result.get(date) ?? 0) + minutes);
  }
  return result;
}

/** Последнее по времени значение за каждый локальный день (вес, % жира); значение — уже в нужных единицах. */
export function lastValuePerDay(records: readonly Readonly<{ time: string; value: number }>[], localDateOf: (instant: string) => string): ReadonlyMap<string, number> {
  const latest = new Map<string, { time: number; value: number }>();
  for (const record of records) {
    const time = ms(record.time);
    if (Number.isNaN(time) || !Number.isFinite(record.value)) continue;
    const date = localDateOf(record.time);
    const known = latest.get(date);
    if (known === undefined || time >= known.time) latest.set(date, { time, value: record.value });
  }
  return new Map([...latest].map(([date, entry]) => [date, entry.value]));
}

/** Проценты → десятые доли; округление до ближайшей десятой. */
export const toTenths = (value: number): number => Math.round(value * 10);
/** Килограммы → сотые доли (88,354 → 8835); округление до ближайшей сотой. */
export const toHundredths = (value: number): number => Math.round(value * 100);

/** Неполный ответ нельзя объявить полной синхронизацией: зацикливание и лимит страниц — явная ошибка до записи фактов. */
export async function readHealthPages<T>(readPage: (token?: string) => Promise<Readonly<{ records: readonly T[]; pageToken?: string }>>, maxPages = 50): Promise<T[]> {
  const records: T[] = [];
  const seen = new Set<string>();
  let token: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const chunk = await readPage(token);
    records.push(...chunk.records);
    token = chunk.pageToken;
    if (!token) return records;
    if (seen.has(token)) throw new Error("HEALTH_READ_PAGINATION");
    seen.add(token);
  }
  throw new Error("HEALTH_READ_LIMIT");
}

/** Не чаще чем раз в столько мс повторно читается Health Connect при возвратах в приложение: возврат из Mi Fitness (секунды) не должен упираться в паузу. */
export const HEALTH_RESYNC_MIN_GAP_MS = 15_000;

/** Пора ли снова читать Health Connect: первый раз — всегда, дальше — не раньше минимальной паузы (часы назад — тоже читаем). */
export function shouldResyncHealth(lastRunAt: number | null, now: number, minGapMs: number = HEALTH_RESYNC_MIN_GAP_MS): boolean {
  return lastRunAt === null || now < lastRunAt || now - lastRunAt >= minGapMs;
}

/** Подпись времени последнего чтения у плиток дня: «обновлено 15:40», а для другого дня — с датой «обновлено 10.11 в 09:05». */
export function syncedAtText(lastSyncAt: string | null, now: Date): string {
  if (lastSyncAt === null) return "ещё не обновлялось";
  const at = new Date(lastSyncAt);
  if (Number.isNaN(at.getTime())) return "ещё не обновлялось";
  const two = (value: number) => String(value).padStart(2, "0");
  const time = `${two(at.getHours())}:${two(at.getMinutes())}`;
  const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  return sameDay ? `обновлено ${time}` : `обновлено ${two(at.getDate())}.${two(at.getMonth() + 1)} в ${time}`;
}
