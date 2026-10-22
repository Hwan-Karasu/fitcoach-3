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
  /** Откуда запущен: по нажатию на панель тренер возвращается в эту тренировку (§44.22); `null` у таймеров, записанных раньше. */
  readonly programId: string | null;
  readonly weekIndex: number | null;
  readonly plannedWorkoutId: string | null;
  /** Остаток в мс, пока таймер на паузе; `null` — идёт. На паузе `endAt` не используется и сигнал не стоит. */
  readonly pausedLeftMs: number | null;
}

export interface RestTimerStart {
  readonly clientId: string;
  readonly clientName: string;
  readonly exerciseKey: string;
  readonly exerciseName: string;
  readonly durationSec: number;
  readonly programId: string;
  readonly weekIndex: number;
  readonly plannedWorkoutId: string;
}

export const ADJUST_STEP_SEC = 15;

/**
 * Новый запуск (§48.55 п. 8, §48.62): таймер того же упражнения того же участника перезапускается (отсчёт от последнего подхода),
 * остальные — другие упражнения и другие участники — идут дальше независимо. Таймер принадлежит упражнению тренировки
 * (`exerciseKey` — плановое упражнение) и участнику, а не экрану: смена экрана, недели или участника его не трогает.
 */
export function startTimer(timers: readonly RestTimer[], input: RestTimerStart, id: string, now: number):
  Readonly<{ timers: readonly RestTimer[]; timer: RestTimer; replaced: readonly RestTimer[] }> {
  if (!Number.isInteger(input.durationSec) || input.durationSec <= 0) throw new Error("REST_DURATION_INVALID");
  const same = timers.filter((item) => item.clientId === input.clientId && item.exerciseKey === input.exerciseKey);
  const timer: RestTimer = { id, clientId: input.clientId, clientName: input.clientName, exerciseKey: input.exerciseKey,
    exerciseName: input.exerciseName, startedAt: now, endAt: now + input.durationSec * 1000, signalId: null,
    programId: input.programId, weekIndex: input.weekIndex, plannedWorkoutId: input.plannedWorkoutId, pausedLeftMs: null };
  return { timers: [...timers.filter((item) => !same.includes(item)), timer], timer, replaced: same };
}

export const isPaused = (timer: RestTimer): boolean => timer.pausedLeftMs !== null;
/** Закончился: идущий таймер дошёл до `endAt`. Приостановленный не заканчивается. */
export const isFinished = (timer: RestTimer, now: number): boolean => timer.pausedLeftMs === null && timer.endAt <= now;

/** «+15 / −15» (§48.64): сдвигает окончание (на паузе — остаток), но не раньше текущего момента; на паузе остаётся не меньше секунды. */
export function adjustTimer(timer: RestTimer, deltaSec: number, now: number): RestTimer {
  if (timer.pausedLeftMs !== null) return { ...timer, pausedLeftMs: Math.max(1000, timer.pausedLeftMs + deltaSec * 1000) };
  return { ...timer, endAt: Math.max(now, timer.endAt + deltaSec * 1000) };
}

/** Пауза запоминает остаток и снимает системный сигнал; уже закончившийся или приостановленный таймер не меняется. */
export function pauseTimer(timer: RestTimer, now: number): RestTimer {
  if (timer.pausedLeftMs !== null || timer.endAt <= now) return timer;
  return { ...timer, pausedLeftMs: timer.endAt - now, signalId: null };
}

/** Продолжение: окончание заново считается от текущего момента, сигнал ставится снова. */
export function resumeTimer(timer: RestTimer, now: number): RestTimer {
  if (timer.pausedLeftMs === null) return timer;
  return { ...timer, endAt: now + timer.pausedLeftMs, pausedLeftMs: null, signalId: null };
}

export function remainingSec(timer: RestTimer, now: number): number {
  const leftMs = timer.pausedLeftMs ?? timer.endAt - now;
  return Math.max(0, Math.ceil(leftMs / 1000));
}

/** Идущие и приостановленные таймеры (закончившиеся отсеиваются): первым — ближайший к окончанию. */
export function runningTimers(timers: readonly RestTimer[], now: number): readonly RestTimer[] {
  return timers.filter((timer) => !isFinished(timer, now)).sort((a, b) => a.endAt - b.endAt);
}
