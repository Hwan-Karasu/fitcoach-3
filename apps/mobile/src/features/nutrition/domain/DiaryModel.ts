import type { Nutrients } from "./FoodModel.ts";
import type { FoodSnapshot } from "./FoodSnapshot.ts";

/** Привычные приёмы пищи FitCoach 2.0 (§49.2); состав и число слотов в V1 не расширяются. */
export const MEAL_SLOTS = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const;
export type MealSlot = typeof MEAL_SLOTS[number];

/** Пищевая запись дня клиента: снимок продукта или рецепта на момент записи (§49.5.1) и фактическое количество. */
export interface DiaryEntry {
  readonly id: string;
  readonly clientId: string;
  readonly localDate: string;
  readonly slot: MealSlot;
  /** Порядок внутри приёма пищи. */
  readonly position: number;
  readonly snapshot: FoodSnapshot;
  readonly revision: number;
}

export interface DiaryEntryInput {
  readonly localDate: string;
  readonly slot: MealSlot;
  readonly snapshot: FoodSnapshot;
}

/** Вода — отдельный факт дня, не еда и не часть рациона (§49.5.5). */
export interface WaterDay {
  readonly localDate: string;
  readonly ml: number;
}

/** «Нет еды» не равно «нулевой рацион»: день без пищевых записей учётом не считается (§49.22). */
export type DayState = "NO_FOOD" | "FOOD_RECORDED";

export interface DaySummary {
  readonly localDate: string;
  readonly state: DayState;
  readonly foodEntries: number;
  /** Сумма внесённого за день; нутриент, неизвестный хотя бы в одной записи, — `null`, а не неполная сумма. */
  readonly totals: Nutrients;
  readonly bySlot: Readonly<Record<MealSlot, Nutrients | null>>;
}

/**
 * Копирование приёма пищи (`slot`) или всего дня (`slot: null`) на целевую дату (§49.5.6). `APPEND` — добавить в конец; `SKIP_FILLED` — копировать только
 * в приёмы, где у цели пока нет записей; `REPLACE` — заменить записи цели в копируемой области (требует подтверждения в UI).
 */
export type CopyMode = "APPEND" | "SKIP_FILLED" | "REPLACE";

export interface CopyEntriesRequest {
  readonly fromDate: string;
  readonly toDate: string;
  readonly slot: MealSlot | null;
  /** Приём пищи цели; `null` — тот же слот, что у источника. Для копирования дня должен быть `null`. */
  readonly targetSlot: MealSlot | null;
  readonly mode: CopyMode;
}

export interface CopyEntriesResult {
  readonly copied: number;
  /** Сколько записей цели заменено (только `REPLACE`). */
  readonly replaced: number;
}
