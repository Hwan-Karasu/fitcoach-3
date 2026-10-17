/**
 * Таймер отдыха (§44, §48.55–48.64). Источник истины — абсолютный `endAt` (мс), не убывающий счётчик:
 * сворачивание, перерисовка и перезапуск процесса не сдвигают окончание. Таймер — не тренировочный факт:
 * хранится только для восстановления и системного сигнала (§44.8).
 */
export interface RestTimer {
  readonly id: string;
  readonly clientId: string;
  /** Подпись для панели: таймеры разных клиентов различимы (§48.62 п. 2). */
  readonly clientName: string;
  /** Упражнение тренировки (плановое упражнение): у клиента свой таймер на каждое упражнение. */
  readonly exerciseKey: string;
  readonly exerciseName: string;
  readonly startedAt: number;
  readonly endAt: number;
  /** Запланированный системный сигнал; `null` — сигнал недоступен, таймер всё равно идёт (§44.14). */
  readonly signalId: string | null;
}

export interface RestTimerStart {
  readonly clientId: string;
  readonly clientName: string;
  readonly exerciseKey: string;
  readonly exerciseName: string;
  readonly durationSec: number;
}

export const ADJUST_STEP_SEC = 15;

/**
 * Новый запуск (§48.55 п. 8): таймер того же упражнения того же клиента перезапускается, остальные
 * (другие упражнения, другие клиенты) идут дальше (§48.59 п. 7, §48.62 п. 5).
 */
export function startTimer(timers: readonly RestTimer[], input: RestTimerStart, id: string, now: number):
  Readonly<{ timers: readonly RestTimer[]; timer: RestTimer; replaced: RestTimer | null }> {
  if (!Number.isInteger(input.durationSec) || input.durationSec <= 0) throw new Error("REST_DURATION_INVALID");
  const replaced = timers.find((timer) => timer.clientId === input.clientId && timer.exerciseKey === input.exerciseKey) ?? null;
  const timer: RestTimer = { id, clientId: input.clientId, clientName: input.clientName, exerciseKey: input.exerciseKey,
    exerciseName: input.exerciseName, startedAt: now, endAt: now + input.durationSec * 1000, signalId: null };
  return { timers: [...timers.filter((item) => item !== replaced), timer], timer, replaced };
}

/** «+15 / −15» (§48.64): двигает только этот `endAt`, не раньше текущего момента. */
export function adjustTimer(timer: RestTimer, deltaSec: number, now: number): RestTimer {
  return { ...timer, endAt: Math.max(now, timer.endAt + deltaSec * 1000) };
}

export function remainingSec(timer: RestTimer, now: number): number {
  return Math.max(0, Math.ceil((timer.endAt - now) / 1000));
}

/** Идущие таймеры: первым — ближайший к окончанию (§48.62 п. 4). */
export function runningTimers(timers: readonly RestTimer[], now: number): readonly RestTimer[] {
  return timers.filter((timer) => timer.endAt > now).sort((a, b) => a.endAt - b.endAt);
}
