/** Стартовые цели дня (UIX-05, UI-OWN-069; решение владельца 2026-11-09): шаги 10 000, приёмов пищи 4. Цель сна 8 ч добавится с экраном сна. */
export const STEPS_GOAL = 10_000;
export const MEALS_GOAL = 4;
/** Цель сна — 8 часов; не менее 7 часов для взрослых (консенсус AASM/SRS, 2015; решение владельца 2026-11-09). */
export const SLEEP_GOAL_HOURS = 8;
export const SLEEP_MIN_ADULT_HOURS = 7;

/** Доля цели для дуги кольца: нет данных — `null` (пустая дуга, а не ноль), перевыполнение больше единицы. */
export function goalFraction(value: number | null, goal: number): number | null {
  return value === null || goal <= 0 ? null : value / goal;
}
