/**
 * Вопрос «Завершить тренировку?» нужен, когда тренер сам уходит с экрана тренировки. Программный переход (панель таймера отдыха,
 * уведомление) заменяет экран клиента целиком — вложенный дневник при этом удаляется, но тренер никуда не уходил (UIX-FIT-11).
 *
 * Флаг синхронный и живёт только внутри `run`: `beforeRemove` навигации вызывается внутри `dispatch`, то есть до выхода из `run`.
 */
let depth = 0;

/** Выполнить переход так, чтобы открытый дневник тренировки не спрашивал о завершении (ввод при этом сохраняется, тренировка остаётся «в работе»). */
export function runWithoutWorkoutExitPrompt<T>(run: () => T): T {
  depth += 1;
  try { return run(); } finally { depth -= 1; }
}

/** Идёт программный переход, при котором вопрос о завершении не задаётся. */
export function isWorkoutExitPromptSuppressed(): boolean {
  return depth > 0;
}

/** Показывать ли вопрос при выходе: нет — при программном переходе или если тренер отключил подсказку в настройках. */
export function shouldAskWorkoutExit(skipInSettings: boolean): boolean {
  return !skipInSettings && !isWorkoutExitPromptSuppressed();
}
