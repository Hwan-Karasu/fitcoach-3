import type { TransferSession, TransferValues } from "../../../shared/training-transfer/TrainingTransfer.ts";

/**
 * Какие импортированные тренировки считаются завершёнными (решение владельца 2026-10-27, ADR-043).
 * Запись — любое значение результата (повторы, вес, время, дистанция), в том числе в дропе или стороне подхода.
 * Тренировка с записью завершена; пустая тренировка недели, где записи есть, тоже (неделя прошла, эту не записали);
 * неделя без записей целиком остаётся «не начата». Исход, явно записанный в файле, не меняется.
 */
const filled = (values: TransferValues) => values.reps !== null || values.loadGrams !== null || values.durationSec !== null || values.distanceM !== null;

export function hasRecord(session: Pick<TransferSession, "facts">): boolean {
  return session.facts.some((fact) => filled(fact.values) || fact.drops.some(filled)
    || (fact.sides !== null && (filled(fact.sides.left.values) || filled(fact.sides.right.values))));
}

export interface SettledSessions {
  /** Занятия из файла; исход выставлен по правилу там, где в файле его нет. */
  readonly sessions: readonly TransferSession[];
  /** Тренировки без занятия в неделе, где записи есть: вызывающий создаёт для них пустое завершённое занятие. */
  readonly bare: readonly Readonly<{ weekIndex: number; workoutId: string }>[];
}

/** `weeks` и `sessions` — одного цикла (листа): неделя оценивается только по записям своего цикла. */
export function settleImportedSessions(weeks: readonly Readonly<{ index: number; workouts: readonly Readonly<{ id: string }>[] }>[],
  sessions: readonly TransferSession[]): SettledSessions {
  const active = new Set(sessions.filter(hasRecord).map((session) => session.weekIndex));
  const represented = new Set(sessions.map((session) => JSON.stringify([session.weekIndex, session.plannedWorkoutId])));
  return {
    sessions: sessions.map((session) => session.outcome !== null || !active.has(session.weekIndex) ? session : { ...session, outcome: "COMPLETED" as const }),
    bare: weeks.filter((week) => active.has(week.index)).flatMap((week) => week.workouts
      .filter((workout) => !represented.has(JSON.stringify([week.index, workout.id])))
      .map((workout) => ({ weekIndex: week.index, workoutId: workout.id }))),
  };
}
