/**
 * Правила единого календаря (UI-OWN-094): чистые функции без React и native. Даты — локальные `YYYY-MM-DD`; сравниваются как строки.
 * Неделя с понедельника. Ничего здесь не знает ни о теме, ни о конкретном экране.
 */
export const CALENDAR_MIN_YEAR = 1920;
/** Сколько лет вперёд от сегодняшнего года доступно, если верхней границы нет. */
export const CALENDAR_YEARS_AHEAD = 10;

export const MONTH_NAMES = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"] as const;
const MONTH_GENITIVE = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"] as const;
const WEEKDAY_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"] as const;
export const WEEKDAY_HEADERS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

export interface DateRange {
  /** Локальные даты `YYYY-MM-DD`; `null` — граница ещё не выбрана. */
  readonly from: string | null;
  readonly to: string | null;
}

const pad = (value: number) => String(value).padStart(2, "0");
export const isoOf = (year: number, month: number, day: number): string => `${year}-${pad(month)}-${pad(day)}`;

export function partsOf(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  return { year, month, day };
}

export const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Настоящая календарная дата (31.02 и 29.02 в невисокосный год — нет). */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const { year, month, day } = partsOf(value);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** Сколько пустых клеток стоит перед 1-м числом, если неделя начинается с понедельника. */
export const leadingBlanks = (year: number, month: number): number => (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;

/** Первое число месяца даты. */
export const firstOfMonth = (iso: string): string => `${iso.slice(0, 7)}-01`;

/** Сдвиг на месяцы; день подтягивается к последнему дню месяца (31 января + 1 месяц = 28/29 февраля). */
export function addMonths(iso: string, count: number): string {
  const { year, month, day } = partsOf(iso);
  const index = year * 12 + (month - 1) + count;
  const nextYear = Math.floor(index / 12), nextMonth = (index % 12) + 1;
  return isoOf(nextYear, nextMonth, Math.min(day, daysInMonth(nextYear, nextMonth)));
}

export function addDays(iso: string, count: number): string {
  const { year, month, day } = partsOf(iso);
  const moved = new Date(Date.UTC(year, month - 1, day + count));
  return isoOf(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

export const monthIndex =(iso: string): number => { const { year, month } = partsOf(iso); return year * 12 + month - 1; };

/** Границы выбора: заданные или 1920-01-01 … 31 декабря через `CALENDAR_YEARS_AHEAD` лет от сегодняшнего года. */
export function resolveBounds(bounds: Readonly<{ min?: string; max?: string }>, today: string): { min: string; max: string } {
  return {
    min: bounds.min ?? `${CALENDAR_MIN_YEAR}-01-01`,
    max: bounds.max ?? `${partsOf(today).year + CALENDAR_YEARS_AHEAD}-12-31`,
  };
}

export const isWithin = (iso: string, min: string, max: string): boolean => iso >= min && iso <= max;

/** Дата вне границ подтягивается к ближайшей границе. */
export const clampToBounds = (iso: string, min: string, max: string): string => iso < min ? min : iso > max ? max : iso;

/** Страниц-месяцев между границами включительно: страница 0 — месяц `min`. */
export const monthPageCount = (min: string, max: string): number => Math.max(1, monthIndex(max) - monthIndex(min) + 1);
export const monthPageOf = (iso: string, min: string): number => monthIndex(iso) - monthIndex(min);
export const monthOfPage = (page: number, min: string): string => addMonths(firstOfMonth(min), page);

export function yearList(min: string, max: string): number[] {
  const from = partsOf(min).year, to = partsOf(max).year;
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);
}

/** «чт, 12 ноября 2026». */
export function formatLong(iso: string): string {
  const { year, month, day } = partsOf(iso);
  return `${WEEKDAY_SHORT[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]}, ${day} ${MONTH_GENITIVE[month - 1]} ${year}`;
}

/** «12.11.2026». */
export function formatNumeric(iso: string): string {
  const { year, month, day } = partsOf(iso);
  return `${pad(day)}.${pad(month)}.${year}`;
}

/**
 * Нажатие на день в режиме диапазона: первое — начало, второе — конец; второе раньше первого меняет границы; нажатие при готовом
 * диапазоне начинает новый. Тот же день дважды — диапазон из одного дня.
 */
export function applyRangeTap(range: DateRange, tapped: string): DateRange {
  if (range.from === null || range.to !== null) return { from: tapped, to: null };
  return tapped < range.from ? { from: tapped, to: range.from } : { from: range.from, to: tapped };
}

/** Набранные цифры → маска `ДД.ММ.ГГГГ` (лишнее отбрасывается). */
export function maskTyped(raw: string): string {
  const digits = raw.replace(/\D/gu, "").slice(0, 8);
  let masked = digits.slice(0, 2);
  if (digits.length > 2) masked += `.${digits.slice(2, 4)}`;
  if (digits.length > 4) masked += `.${digits.slice(4)}`;
  return masked;
}

export type TypedDate =
  | { readonly kind: "incomplete" }
  | { readonly kind: "ok"; readonly value: string }
  | { readonly kind: "error"; readonly message: string };

/** Разбор набранной даты: пока не набраны все цифры — `incomplete`; иначе дата или понятная ошибка. */
export function parseTyped(text: string, min: string, max: string): TypedDate {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/u.exec(text);
  if (match === null) return text.replace(/\D/gu, "").length >= 8 ? { kind: "error", message: "Введите дату как ДД.ММ.ГГГГ" } : { kind: "incomplete" };
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  if (!isIsoDate(iso)) return { kind: "error", message: "Такой даты нет" };
  if (iso < min) return { kind: "error", message: `Не раньше ${formatNumeric(min)}` };
  if (iso > max) return { kind: "error", message: `Не позже ${formatNumeric(max)}` };
  return { kind: "ok", value: iso };
}
