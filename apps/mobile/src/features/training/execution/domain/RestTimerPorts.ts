import type { RestTimer, RestTimerStart } from "./RestTimerRules.ts";

/** Куда ведёт нажатие на уведомление или панель таймера: только идентификаторы (§44.22). У старых таймеров известен лишь клиент. */
export type RestTimerRoute =
  | Readonly<{ clientId: string }>
  | Readonly<{ clientId: string; programId: string; weekIndex: number; plannedWorkoutId: string; exerciseKey: string }>;

/** Хранение минимального состояния таймеров для восстановления после перезапуска (§44.7). */
export interface RestTimerStorePort {
  listTimers(): Promise<readonly RestTimer[]>;
  /** Записать таймер и убрать заменённые — одной транзакцией. */
  putTimer(timer: RestTimer, replacedIds: readonly string[]): Promise<void>;
  removeTimer(id: string): Promise<void>;
}

/**
 * Системный сигнал окончания (§44.4–44.5, §44.10): один `endAt` с экранным отсчётом. Отказ платформы
 * (нет разрешения, нет точного времени) возвращает `null` и не ломает таймер (§44.14).
 */
export interface RestSignalPort {
  schedule(input: Readonly<{ endAt: number; title: string; body: string; route: RestTimerRoute;
    /** Boot/restore only reuses existing permission and never opens a system prompt. */
    requestPermission?: boolean }>): Promise<string | null>;
  /** Отменить ожидающий сигнал и убрать уже показанный; повторный вызов безопасен. */
  cancel(signalId: string): Promise<void>;
  /** Enumerate/cancel only notifications owned by the rest-timer kind, including orphan IDs. */
  clearOwned?(): Promise<void>;
}

/** Таймеры отдыха для экранов: явные команды Start / Adjust / Skip (§44.11). */
export interface RestTimersPort {
  list(): readonly RestTimer[];
  start(input: RestTimerStart): Promise<void>;
  adjust(id: string, deltaSec: number): Promise<void>;
  /** Пауза: остаток замирает, системный сигнал снимается; продолжение пересчитывает окончание. */
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  /** «Пропустить» — досрочное окончание; на подходы и тренировку не влияет (§48.64 п. 4). */
  skip(id: string): Promise<void>;
  /** Убрать закончившийся таймер с панели. */
  dismiss(id: string): Promise<void>;
  subscribe(listener: () => void): () => void;
}
