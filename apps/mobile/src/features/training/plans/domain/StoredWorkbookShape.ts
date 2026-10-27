import { arrayOf, id, integer, nullableInteger, nullableText, object, text } from "../../../../shared/domain/JsonShape.ts";
import type { BuilderWorkbookState, BuilderWorkbookCycle } from "./BuilderExcelDraft.ts";
import type { TransferSession } from "../../../../shared/training-transfer/TrainingTransfer.ts";

const values = (v: unknown): boolean => object(v) && [v.reps, v.loadGrams, v.durationSec, v.distanceM].every(nullableInteger);
const side = (v: unknown): boolean => object(v) && values(v.values) && typeof v.confirmed === "boolean";
const fact = (v: unknown): boolean => object(v) && id(v.id) && id(v.plannedSetId) && id(v.plannedExerciseId) && id(v.exerciseId)
  && integer(v.position) && ["NORMAL", "WARMUP", "FAILURE", "DROP"].includes(String(v.setType)) && values(v.values)
  && arrayOf(v.drops, (d): d is unknown => values(d)) && nullableInteger(v.rpe) && typeof v.confirmed === "boolean" && typeof v.extra === "boolean"
  && ["INPUT", "COPY", "IMPORT"].includes(String(v.origin)) && integer(v.revision)
  && (v.sides === null || object(v.sides) && side(v.sides.left) && side(v.sides.right));
const session = (v: unknown): boolean => object(v) && id(v.id) && id(v.programId) && id(v.plannedWorkoutId) && integer(v.weekIndex)
  && (v.outcome === null || ["COMPLETED", "MISSED", "CANCELLED"].includes(String(v.outcome)))
  && nullableText(v.actualDate) && nullableText(v.startedAt) && nullableText(v.finishedAt)
  && (v.origin === null || object(v.origin) && text(v.origin.programTitle) && ["SIMPLE", "PERIODIZED"].includes(String(v.origin.programKind)) && nullableText(v.origin.mesocycleTitle) && nullableText(v.origin.workoutTitle))
  && arrayOf(v.facts, (f): f is unknown => fact(f))
  && arrayOf(v.notes, (n): n is unknown => object(n) && id(n.plannedExerciseId) && text(n.text));

export function storedWorkbook(value: unknown, validWeek: (v: unknown) => boolean): value is BuilderWorkbookState {
  return object(value) && value.version === 1 && id(value.activeKey) && arrayOf(value.cycles, (c): c is BuilderWorkbookState["cycles"][number] =>
    object(c) && id(c.key) && text(c.title) && (c.repsText === undefined || text(c.repsText))
    && arrayOf(c.weeks, (w): w is BuilderWorkbookCycle["weeks"][number] => validWeek(w)) && c.weeks.length > 0
    && (c.editing === undefined || integer(c.editing) && c.editing >= 0 && c.editing < c.weeks.length)
    && (c.settings === undefined || object(c.settings)
      && (c.settings.cycleType === undefined || c.settings.cycleType === null || ["hypertrophy", "strength", "power", "endurance", "recomp", "custom"].includes(String(c.settings.cycleType)))
      && (c.settings.startDate === undefined || nullableText(c.settings.startDate))
      && (c.settings.repRange === undefined || c.settings.repRange === null || object(c.settings.repRange) && integer(c.settings.repRange.min) && nullableInteger(c.settings.repRange.max)))
    && (c.imported === undefined || object(c.imported) && id(c.imported.sourceId) && id(c.imported.sourceHash)
      && arrayOf(c.imported.sessions, (s): s is TransferSession => session(s))
      && arrayOf(c.imported.matches, (m): m is { sourceName: string; targetId: string } => object(m) && id(m.sourceName) && id(m.targetId))))
    && value.cycles.some((c) => c.key === value.activeKey) && new Set(value.cycles.map((c) => c.key)).size === value.cycles.length;
}
