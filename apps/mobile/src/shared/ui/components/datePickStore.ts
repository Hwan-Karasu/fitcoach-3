import { BIRTH_DATE_START, profileSettings, type CalendarProfileId, type CalendarView } from "./calendar/calendarProfiles.ts";
import { clampToBounds, resolveBounds } from "./calendar/calendarRules.ts";

/**
 * Запрос выбора даты (UIX-FIT-10): `pickDate` кладёт запрос сюда, лист-хост (`DatePickerHost`) показывает календарь и возвращает результат.
 * Чистый модуль без React и native: промис всегда завершается (отмена, второй запрос, нет хоста — `null`).
 */
export interface DatePickInput {
  /** Локальные даты `YYYY-MM-DD`; `min`/`max` включительно. `null` — даты ещё нет (поле пустое): «Готово» неактивна, пока не выбрано. */
  readonly value: string | null;
  /** С какой даты открыть календарь, пока значения нет. */
  readonly startAt?: string;
  /** Готовый набор настроек под задачу (UI-OWN-094); свои `min`/`max`/`title` его перекрывают. */
  readonly profile?: CalendarProfileId;
  /** Дни, на которых показывается точка (например, дни с записями питания). */
  readonly markers?: ReadonlySet<string>;
  readonly min?: string;
  readonly max?: string;
  readonly title?: string;
  readonly confirmLabel?: string;
}
export interface DatePickRequest extends DatePickInput { readonly id: number; readonly resolve: (date: string | null) => void }

const listeners = new Set<() => void>();
let current: DatePickRequest | null = null;
let hosts = 0;
let sequence = 0;
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
  return new Promise((resolve) => { current = { ...input, id: ++sequence, resolve }; emit(); });
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

export interface ResolvedDatePick {
  readonly title: string;
  readonly confirmLabel: string;
  readonly min: string;
  readonly max: string;
  readonly startView: CalendarView;
  readonly typing: boolean;
  readonly showToday: boolean;
  readonly markers: ReadonlySet<string> | undefined;
  /** Выбранная дата или `null`; вне границ подтягивается к границе. */
  readonly value: string | null;
  /** Месяц, с которого открывается календарь. */
  readonly cursor: string;
}

/** Запрос + профиль + сегодня → настройки календаря. Без профиля ведёт себя как прежний выбор даты: день, «Сегодня», границы 1920 — +10 лет. */
export function resolveDatePick(input: DatePickInput, today: string): ResolvedDatePick {
  const settings = profileSettings(input.profile ?? "anyDate", today);
  const { min, max } = resolveBounds({ min: input.min ?? settings.min, max: input.max ?? settings.max }, today);
  const value = input.value === null ? null : clampToBounds(input.value, min, max);
  const start = value ?? input.startAt ?? (input.profile === "birthDate" ? BIRTH_DATE_START : today);
  return {
    title: input.title ?? "Выберите дату", confirmLabel: input.confirmLabel ?? "Готово", min, max, startView: settings.startView, typing: settings.typing,
    showToday: settings.showToday, markers: input.markers, value, cursor: clampToBounds(start, min, max),
  };
}
