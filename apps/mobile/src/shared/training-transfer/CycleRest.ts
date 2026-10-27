/** Тип цикла (как у мезоцикла в конструкторе и в файле переноса). */
export type CycleRestType = "hypertrophy" | "strength" | "power" | "endurance" | "recomp" | "custom";

/**
 * Время отдыха упражнений по типу цикла, секунды (решение владельца 2026-10-27: гипертрофия 2:00, сила 3:00; остальные подобраны
 * по длительности восстановления: мощность 4:00, выносливость 1:00, рекомпозиция и свой — как отдых по умолчанию).
 * Одна таблица для конструктора и импорта, чтобы значения не расходились.
 */
export const CYCLE_REST_SEC: Readonly<Record<CycleRestType, number>> = {
  hypertrophy: 120, strength: 180, power: 240, endurance: 60, recomp: 90, custom: 90,
};

/** Отдых по умолчанию, когда типа цикла нет (совпадает с `REST_DEFAULT_SEC` плана — проверяется тестом). */
export const DEFAULT_REST_SEC = 90;
