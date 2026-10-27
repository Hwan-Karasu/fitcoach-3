import type { TrainingTransfer, TransferCycle, TransferSession } from "../../../shared/training-transfer/TrainingTransfer.ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { autoMatchWorkbookEntry, selectWorkbookSheet, type WorkbookReviewSession } from "./WorkbookReviewSession.ts";
import { settleImportedSessions } from "./TransferCompletion.ts";

/**
 * Стабильный ID листа и строки (лист, неделя, вид, исходный ID): один и тот же лист получает один и тот же ID при любом выборе листов.
 * Хеш нужен только для длинных ключей: короткие остаются читаемой строкой, и книга не тратит секунды на SHA-256 на телефоне.
 */
const identity = (parts: readonly unknown[]) => {
  const key = JSON.stringify(parts);
  return key.length <= 200 ? `workbook:${key}` : `workbook:${bytesToHex(sha256(utf8ToBytes(key)))}`;
};

export function prepareWholeWorkbook(session: WorkbookReviewSession,
  candidates: readonly Readonly<{ id: string; name: string; available: boolean }>[]): WorkbookReviewSession {
  let result = session;
  for (const sheet of session.sheets) result = autoMatchWorkbookEntry(selectWorkbookSheet(result, sheet.id), candidates);
  return { ...result, activeId: session.activeId };
}

function emptySheet(session: WorkbookReviewSession, id: string): boolean {
  if (session.picked.kind !== "TABLES") return false;
  const table = session.picked.tables[Number(id)]!;
  return !!table.matrixSource && table.rows.length <= 1
    || table.rows.every((row) => row.every((cell) => cell === null || cell === undefined || String(cell).trim() === ""));
}

export function wholeWorkbookStatus(session: WorkbookReviewSession): Readonly<{
  problems: readonly Readonly<{ id: string; label: string; reason: string }>[];
  emptySheets: readonly string[]; cycles: number;
}> {
  const problems: { id: string; label: string; reason: string }[] = [];
  const emptySheets: string[] = [];
  for (const sheet of session.sheets) {
    if (emptySheet(session, sheet.id)) { emptySheets.push(sheet.label); continue; }
    if (!session.selectedSheetIds.has(sheet.id)) continue;
    const entry = session.entries[sheet.id];
    const missing = entry?.value?.exercises.filter((e) => !entry.mapping[e.id]).length ?? 0;
    const reason = !entry?.value ? entry?.error || "Лист ещё не прочитан"
      : entry.settingsDirty ? "Примените настройки столбцов"
        : missing ? `Выберите упражнения: ${missing}`
          : entry.value.issues?.length ? `Проверьте значения: ${entry.value.issues.length}` : "";
    if (reason) problems.push({ ...sheet, reason });
  }
  return { problems, emptySheets, cycles: session.sheets.filter((s) => session.selectedSheetIds.has(s.id) && !emptySheet(session, s.id)).length };
}

/** One workbook is one new programme. IDs include sheet/week context, even for repeated simple plans. */
export function compileWholeWorkbook(session: WorkbookReviewSession): Readonly<{
  value: TrainingTransfer; mapping: Readonly<Record<string, string>>;
}> {
  const status = wholeWorkbookStatus(session);
  if (status.problems.length) throw new Error(status.problems.map((p) => `${p.label}: ${p.reason}`).join("\n"));
  if (!status.cycles) throw new Error("В книге нет тренировок для импорта.");
  if (!session.programTitle.trim() || session.programTitle.trim().length > 80) throw new Error("Название программы должно содержать от 1 до 80 символов.");
  const entries = session.sheets.filter((s) => session.selectedSheetIds.has(s.id) && !emptySheet(session, s.id));
  const first = session.entries[entries[0]!.id]!.value!;
  const sourcePrograms = [...new Set(entries.flatMap((s) => session.entries[s.id]!.value!.programs.map((p) => p.id)))].sort();
  const programId = identity([first.sourceId, sourcePrograms, entries.map((s) => s.id)]);
  const exercises = new Map<string, { id: string; name: string }>();
  const mapping: Record<string, string> = {};
  const cycles: TransferCycle[] = []; const sessions: TransferSession[] = [];
  for (const sheet of entries) {
    const entry = session.entries[sheet.id]!; const value = entry.value!;
    for (const e of value.exercises) {
      if (exercises.has(e.id) && (exercises.get(e.id)!.name !== e.name || mapping[e.id] !== entry.mapping[e.id])) {
        throw new Error(`Конфликт сопоставления упражнения: ${e.name}`);
      }
      exercises.set(e.id, e); mapping[e.id] = entry.mapping[e.id]!;
    }
    const original = value.programs[0]!.mesocycles[0]!;
    const remembered = new Map<string, string>();
    const rowId = (week: number, kind: string, id: string) => {
      const key = `${week}|${kind}|${id}`;
      const known = remembered.get(key);
      if (known !== undefined) return known;
      const made = identity([first.sourceId, original.id, week, kind, id]);
      remembered.set(key, made);
      return made;
    };
    cycles.push({ ...original, id: rowId(0, "cycle", original.id), lineageId: rowId(0, "cycle", original.lineageId), title: sheet.label,
      weeks: original.weeks.map((week) => ({ ...week, id: rowId(week.index, "week", week.id),
        workouts: week.workouts.map((workout) => ({ ...workout, id: rowId(week.index, "workout", workout.id),
          lineageId: rowId(0, "workout-lineage", workout.lineageId ?? workout.id),
          exercises: workout.exercises.map((exercise) => ({ ...exercise, id: rowId(week.index, "exercise", exercise.id),
            lineageId: rowId(0, "exercise-lineage", exercise.lineageId ?? exercise.id),
            supersetId: exercise.supersetId ? rowId(week.index, "superset", exercise.supersetId) : undefined,
            sets: exercise.sets.map((set) => ({ ...set, id: rowId(week.index, "set", set.id) })) })) })) })) });
    // Исход по записям (ADR-043): завершены тренировки с результатами и пустые тренировки недели, где результаты есть; неделя без записей не начата.
    const settled = settleImportedSessions(original.weeks, value.sessions);
    for (const s of settled.sessions) sessions.push({ ...s, id: rowId(s.weekIndex, "session", s.id), programId,
      plannedWorkoutId: rowId(s.weekIndex, "workout", s.plannedWorkoutId),
      facts: s.facts.map((f) => ({ ...f, id: rowId(s.weekIndex, "fact", f.id), plannedSetId: rowId(s.weekIndex, "set", f.plannedSetId),
        plannedExerciseId: rowId(s.weekIndex, "exercise", f.plannedExerciseId) })),
      notes: s.notes.map((n) => ({ ...n, plannedExerciseId: rowId(s.weekIndex, "exercise", n.plannedExerciseId) })) });
    for (const { weekIndex, workoutId } of settled.bare) {
      sessions.push({ id: rowId(weekIndex, "empty-session", workoutId), programId, weekIndex,
        plannedWorkoutId: rowId(weekIndex, "workout", workoutId), outcome: "COMPLETED", actualDate: null,
        startedAt: null, finishedAt: null, origin: null, facts: [], notes: [] });
    }
  }
  return { mapping, value: { ...first, client: { ...first.client, id: `${first.sourceId}:workbook:${session.picked.kind === "TRANSFER" ? session.picked.value.client.id : "client"}:${programId}` },
    exercises: [...exercises.values()], sessions, issues: [], planHistory: [],
    programs: [{ ...first.programs[0]!, id: programId, title: session.programTitle.trim(), kind: "PERIODIZED", simple: null, simpleWeeks: [], mesocycles: cycles }] } };
}

export async function prepareWorkbookResponsive(session: WorkbookReviewSession,
  candidates: readonly Readonly<{ id: string; name: string; available: boolean }>[],
  active: () => boolean, progress: (done: number, total: number) => void): Promise<WorkbookReviewSession | null> {
  let result = session;
  for (const [index, sheet] of session.sheets.entries()) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (!active()) return null;
    result = autoMatchWorkbookEntry(selectWorkbookSheet(result, sheet.id), candidates);
    progress(index + 1, session.sheets.length);
  }
  return active() ? { ...result, activeId: session.activeId } : null;
}
