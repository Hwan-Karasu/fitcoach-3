import type { RestTimer, RestTimerStart } from "./RestTimerRules.ts";

/** Хранение минимального состояния таймеров для восстановления после перезапуска (§44.7). */
export interface RestTimerStorePort {
  listTimers(): Promise<readonly RestTimer[]>;
  /** Записать таймер и убрать заменённый — одной транзакцией. */
  putTimer(timer: RestTimer, replacedId: string | null): Promise<void>;
  removeTimer(id: string): Promise<void>;
}

/**
 * Системный сигнал окончания (§44.4–44.5, §44.10): один `endAt` с экранным отсчётом. Отказ платформы
 * (нет разрешения, нет точного времени) возвращает `null` и не ломает таймер (§44.14).
 */
export interface RestSignalPort {
  schedule(input: Readonly<{ endAt: number; title: string; body: string }>): Promise<string | null>;
  /** Отменить ожидающий сигнал и убрать уже показанный; повторный вызов безопасен. */
  cancel(signalId: string): Promise<void>;
}

/** Таймеры отдыха для экранов: явные команды Start / Adjust / Skip (§44.11). */
export interface RestTimersPort {
  list(): readonly RestTimer[];
  start(input: RestTimerStart): Promise<void>;
  adjust(id: string, deltaSec: number): Promise<void>;
  /** «Пропустить» — досрочное окончание; на подходы и тренировку не влияет (§48.64 п. 4). */
  skip(id: string): Promise<void>;
  /** Убрать закончившийся таймер с панели. */
  dismiss(id: string): Promise<void>;
  subscribe(listener: () => void): () => void;
}
