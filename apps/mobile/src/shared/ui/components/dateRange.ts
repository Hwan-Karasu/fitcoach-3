import type { DateType } from "react-native-ui-datepicker";

const pad = (value: number) => String(value).padStart(2, "0");

/** Локальная дата `YYYY-MM-DD` в полночь по локальному времени — так её понимает календарь (без сдвига часового пояса). */
export function localMidnight(local: string): Date {
  const [year, month, day] = local.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}

/** Значение календаря (Date, Dayjs, строка, число) → локальная дата `YYYY-MM-DD`; пусто или некорректно — `null`. */
export function localDateOfPicker(value: DateType): string | null {
  if (value === null || value === undefined) return null;
  const date = typeof value === "object" && !(value instanceof Date) ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
