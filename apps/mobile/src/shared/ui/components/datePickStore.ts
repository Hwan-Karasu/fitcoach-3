/**
 * Запрос выбора даты (UIX-FIT-10): `pickDate` кладёт запрос сюда, лист-хост (`DatePickerHost`) показывает календарь и возвращает результат.
 * Чистый модуль без React и native: промис всегда завершается (отмена, второй запрос, нет хоста — `null`).
 */
export interface DatePickInput {
  /** Локальные даты `YYYY-MM-DD`; `min`/`max` включительно. */
  readonly value: string;
  readonly min?: string;
  readonly max?: string;
  readonly title?: string;
  readonly confirmLabel?: string;
}
export interface DatePickRequest extends DatePickInput { readonly resolve: (date: string | null) => void }

const listeners = new Set<() => void>();
let current: DatePickRequest | null = null;
let hosts = 0;
const emit = () => { for (const listener of [...listeners]) listener(); };

export const subscribeDatePick = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const datePickSnapshot = (): DatePickRequest | null => current;

/** Хост листа сообщает, что он смонтирован: без него запрос тут же завершается `null`, а не зависает. */
export function registerDatePickHost(): () => void {
  hosts += 1;
  return () => { hosts -= 1; if (hosts === 0) finishDatePick(null); };
}

export function requestDate(input: DatePickInput): Promise<string | null> {
  if (hosts === 0) return Promise.resolve(null);
  current?.resolve(null); // прежний незавершённый запрос отменяется
  return new Promise((resolve) => { current = { ...input, resolve }; emit(); });
}

/** Завершить текущий выбор: дата или `null` (отмена). */
export function finishDatePick(result: string | null): void {
  const request = current;
  current = null;
  emit();
  request?.resolve(result);
}

/** Ограничить дату диапазоном `min`/`max` (локальные `YYYY-MM-DD`, сравниваются как строки): стартовое значение вне диапазона не должно уходить как «выбранное». */
export function clampDate(value: string, min?: string, max?: string): string {
  if (min !== undefined && value < min) return min;
  if (max !== undefined && value > max) return max;
  return value;
}
