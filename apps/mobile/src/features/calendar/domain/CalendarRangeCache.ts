import type { Appointment, CalendarInterval, LocalDate } from "./CalendarModel.ts";

export type CalendarRange = Readonly<{ appointments: readonly Appointment[]; intervals: readonly CalendarInterval[] }>;

/**
 * Прочитанные диапазоны календаря (CAL-RANGE-CACHE): переключение «неделя ↔ день» и возврат к недавней неделе не ждут чтения базы и не
 * рисуют пустую сетку. День берётся из закэшированной недели. Размер жёстко ограничен (вытесняется давно не использованный), поэтому
 * память не растёт с годами записей; любое подтверждённое изменение календаря сбрасывает затронутые даты.
 */
export class RangeCache {
  private readonly entries = new Map<string, Readonly<{ from: LocalDate; to: LocalDate; range: CalendarRange }>>();
  private readonly capacity: number;
  private generation = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  get size(): number { return this.entries.size; }

  /** Меняется при каждом сбросе: чтение, начатое до изменения календаря, не записывает в кэш устаревший результат. */
  get version(): number { return this.generation; }

  get(from: LocalDate, to: LocalDate): CalendarRange | null {
    const exactKey = `${from}:${to}`;
    const exact = this.entries.get(exactKey);
    if (exact !== undefined) { this.touch(exactKey, exact); return exact.range; }
    for (const [key, entry] of this.entries) {
      if (entry.from <= from && entry.to >= to) {
        this.touch(key, entry);
        const within = (row: Readonly<{ localDate: LocalDate }>) => row.localDate >= from && row.localDate <= to;
        return { appointments: entry.range.appointments.filter(within), intervals: entry.range.intervals.filter(within) };
      }
    }
    return null;
  }

  put(from: LocalDate, to: LocalDate, range: CalendarRange, readAtVersion: number = this.generation): void {
    if (readAtVersion !== this.generation) return;
    const key = `${from}:${to}`;
    this.entries.delete(key);
    this.entries.set(key, { from, to, range });
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value as string);
  }

  /** Подтверждённое изменение календаря: сбрасываются диапазоны с затронутыми датами (`"ALL"` — все). */
  invalidate(dates: readonly LocalDate[] | "ALL"): void {
    this.generation += 1;
    if (dates === "ALL") { this.entries.clear(); return; }
    for (const [key, entry] of this.entries) if (dates.some((date) => date >= entry.from && date <= entry.to)) this.entries.delete(key);
  }

  private touch(key: string, entry: Readonly<{ from: LocalDate; to: LocalDate; range: CalendarRange }>): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }
}
