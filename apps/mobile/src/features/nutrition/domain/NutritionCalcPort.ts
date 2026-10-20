import type { CalcProfile } from "./CalcRules.ts";

export interface StoredCalcProfile {
  readonly profile: CalcProfile;
  readonly revision: number;
}

export interface StepsDay {
  readonly localDate: string;
  readonly steps: number;
}

export interface CalcCommittedChange {
  readonly clientId: string;
}

/**
 * Профиль расчёта КБЖУ клиента и суточные шаги (§49.10). Вес и % жира здесь не хранятся — их источник Measurements.
 * Ошибки: `CALC_PROFILE_INVALID`, `CALC_STEPS_INVALID`, `CALC_STALE` (профиль уже менялся или создан), `DIARY_DATE_INVALID`. Все операции ограничены `clientId`.
 */
export interface NutritionCalcPort {
  getProfile(clientId: string): Promise<StoredCalcProfile | null>;
  /** Создаёт профиль (`expectedRevision: null`) или правит по revision; устаревшая правка и повторное создание — `CALC_STALE`. */
  saveProfile(clientId: string, profile: CalcProfile, expectedRevision: number | null, now?: Date): Promise<StoredCalcProfile>;
  /** Шаги за закрытый диапазон дат; дни без записи не возвращаются (неизвестно ≠ 0). */
  listSteps(clientId: string, fromDate: string, toDate: string): Promise<readonly StepsDay[]>;
  setSteps(clientId: string, localDate: string, steps: number, now?: Date): Promise<StepsDay>;
  clearSteps(clientId: string, localDate: string): Promise<void>;
  /** Среднее по дням с известными шагами, округлённое; `null`, если шагов за период нет. */
  averageSteps(clientId: string, fromDate: string, toDate: string): Promise<number | null>;
  subscribeCommittedChanges(listener: (change: CalcCommittedChange) => void): () => void;
}
