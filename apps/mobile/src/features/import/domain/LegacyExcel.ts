import type { TrainingTransfer, TransferExercise, TransferWorkout, TransferSession, TransferIssue, TransferValues } from "../../../shared/training-transfer/TrainingTransfer.ts";
import type { ImportTable } from "./WorkbookFilesPort.ts";
import { spreadsheetDay } from "../../../shared/training-transfer/SpreadsheetDay.ts";
import { isTechnicalExerciseName } from "../../../shared/training-transfer/VisibleTrainingTransfer.ts";
export const legacyFields = { week: "Неделя", workout: "Тренировка", exercise: "Упражнение", sets: "Подходы", reps: "План повторений", load: "План вес", actualReps: "Факт повторений", actualLoad: "Факт вес", rir: "RIR", note: "Заметка", date: "Дата", duration: "План секунд", distance: "План метров", actualDuration: "Факт секунд", actualDistance: "Факт метров" } as const;
export type LegacyMapping = Partial<Record<keyof typeof legacyFields, number>>;
const key = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/ё/gu, "е");
const actualFields: Partial<Record<keyof LegacyMapping, keyof TransferValues>> = {
  actualReps: "reps", actualLoad: "loadGrams", actualDuration: "durationSec", actualDistance: "distanceM",
};
export function detectLegacyMapping(table: ImportTable): { header: number; mapping: LegacyMapping } {
  let best: { header: number; mapping: LegacyMapping } = { header: 0, mapping: {} };
  table.rows.slice(0, 30).forEach((row, header) => {
    const mapping: LegacyMapping = {};
    for (const [field, title] of Object.entries(legacyFields)) { const index = row.findIndex((v) => key(v) === key(title)); if (index >= 0) mapping[field as keyof LegacyMapping] = index; }
    if (Object.keys(mapping).length > Object.keys(best.mapping).length) best = { header, mapping };
  });
  return best;
}
export function normalizeLegacyTable(table: ImportTable, sourceId: string, header: number, mapping: LegacyMapping): TrainingTransfer {
  if (mapping.exercise === undefined) throw new Error("Сопоставьте столбец «Упражнение».");
  const workouts = new Map<string, { index: number; workout: TransferWorkout; exercises: TransferExercise[] }>();
  const catalog = new Map<string, { id: string; name: string }>(); const sessions = new Map<string, TransferSession>();
  const issues: TransferIssue[] = [];
  const source = `${sourceId}:${table.name}`; const programId = `${source}:program`;
  const get = (row: readonly unknown[], field: keyof LegacyMapping) => String(row[mapping[field] ?? -1] ?? "").trim();
  // Keep old IDs for ordinary workbooks; distinguish literal names only when old folded keys collide.
  const variants = new Map<string, Set<string>>();
  for (const row of table.rows.slice(header + 1)) {
    const name = get(row, "exercise"); if (!name || isTechnicalExerciseName(name)) continue;
    const folded = key(name); const names = variants.get(folded) ?? new Set<string>(); names.add(name); variants.set(folded, names);
  }
  let weekText = "1"; let workoutTitle = "Тренировка 1"; let maxWeek = 1;
  for (const [index, row] of table.rows.entries()) {
    if (index <= header || row.every((v) => !String(v ?? "").trim())) continue;
    const fail = (field: keyof LegacyMapping, message: string): never => { throw new Error(`${table.name}, строка ${index + 1}, столбец ${legacyFields[field]}: ${message}`); };
    const invalid: { field: keyof TransferValues; raw: string; source: NonNullable<TransferIssue["source"]> }[] = [];
    const numeric = (field: keyof LegacyMapping, factor = 1): number | null => {
      const text = get(row, field); if (!text) return null;
      const n = Number(text.replace(",", ".")) * factor;
      const actual = actualFields[field];
      const minimum = actual && actual !== "loadGrams" ? 1 : 0;
      const maximum = actual === "reps" ? 999 : actual === "durationSec" ? 86400 : actual ? 1000000 : Number.MAX_SAFE_INTEGER;
      if (!Number.isSafeInteger(Math.round(n)) || n < minimum || n > maximum || Math.abs(Math.round(n) - n) > 0.00001) {
        if (!actual) return fail(field, "неверное число");
        const column = mapping[field]!;
        invalid.push({ field: actual, raw: text, source: { sheet: table.name,
          ...(table.cellOrigins?.[index]?.[column] ?? { row: index + 1, column: column + 1 }) } });
        return null;
      }
      return Math.round(n);
    };
    weekText = get(row, "week") || weekText; workoutTitle = get(row, "workout") || workoutTitle;
    const week = Number(/\d+/u.exec(weekText)?.[0]); if (!week || week > 52) fail("week", "ожидается неделя от 1 до 52"); maxWeek = Math.max(maxWeek, week);
    const name = get(row, "exercise"); if (!name) fail("exercise", "не задано название");
    if (isTechnicalExerciseName(name)) continue;
    const exerciseId = `${source}:exercise:${key(name)}${(variants.get(key(name))?.size ?? 0) > 1 ? `:literal:${JSON.stringify(name)}` : ""}`;
    catalog.set(exerciseId, { id: exerciseId, name });
    const workoutKey = `${week}:${workoutTitle}`; let group = workouts.get(workoutKey);
    if (!group) { const exercises: TransferExercise[] = []; group = { index: week, exercises, workout: { id: `${source}:workout:${workoutKey}`, lineageId: `${source}:workout:${workoutTitle}`, title: workoutTitle, exercises } }; workouts.set(workoutKey, group); }
    const repsText = get(row, "reps").replace(/[–—]/gu, "-"); const range = repsText ? /^(\d+)(?:\s*-\s*(\d+))?$/u.exec(repsText) : null;
    if (repsText && !range) fail("reps", "ожидается число или диапазон 8-12");
    const count = numeric("sets") ?? 1; if (count < 1 || count > 100) fail("sets", "ожидается от 1 до 100 подходов");
    const rowId = `${source}:row:${index}`; const load = numeric("load", 1000); const rir = numeric("rir");
    const exercise: TransferExercise = { id: rowId, lineageId: `${source}:exercise-slot:${workoutTitle}:${group.exercises.length}`, exerciseId, restSec: null, instruction: get(row, "note") || null, rir: rir === null ? null : { min: rir, max: null }, sets: Array.from({ length: count }, (_, n) => ({ id: `${rowId}:set:${n}`, reps: range ? Number(range[1]) : null, repsMax: range?.[2] ? Number(range[2]) : null, loadGrams: load, durationSec: numeric("duration"), distanceM: numeric("distance") })) };
    const previous = group.exercises.at(-1);
    const merged = count === 1 && previous?.exerciseId === exerciseId ? { ...previous, sets: [...previous.sets, ...exercise.sets] } : exercise;
    const offset = merged === exercise ? 0 : previous!.sets.length;
    if (merged === exercise) group.exercises.push(exercise); else group.exercises[group.exercises.length - 1] = merged;
    const actualReps = numeric("actualReps"); const actualLoad = numeric("actualLoad", 1000);
    const actualDuration = numeric("actualDuration"); const actualDistance = numeric("actualDistance");
    if (invalid.length || actualReps !== null || actualLoad !== null || actualDuration !== null || actualDistance !== null) {
      const rawDate = get(row, "date"); const date = rawDate && !/^неизвестно$/iu.test(rawDate) ? spreadsheetDay(rawDate) ?? fail("date", "ожидается YYYY-MM-DD, ДД.ММ.ГГГГ или «неизвестно»") : "";
      let session = sessions.get(workoutKey);
      if (session && session.actualDate !== (date || null)) fail("date", "у одной тренировки указаны разные даты; разделите тренировки");
      session ??= { id: `${group.workout.id}:session`, programId, weekIndex: week, plannedWorkoutId: group.workout.id, outcome: null, actualDate: date || null, startedAt: null, finishedAt: null, origin: null, facts: [], notes: [] };
      session = { ...session, facts: [...session.facts, ...exercise.sets.map((set, n) => {
        const id = `${rowId}:fact:${n}`;
        for (const issue of invalid) issues.push({ ...issue, id: JSON.stringify([id, exerciseId, week, workoutTitle, issue.field, issue.source, issue.raw]),
          programId, targetId: id, scope: "FACT", weekIndex: week, workoutId: group.workout.id });
        return { id, plannedSetId: set.id, plannedExerciseId: merged.id, exerciseId, position: offset + n, setType: "NORMAL" as const,
          values: { reps: actualReps, loadGrams: actualLoad, durationSec: actualDuration, distanceM: actualDistance }, drops: [], sides: null,
          rpe: null, confirmed: invalid.length === 0, extra: false, origin: "IMPORT" as const, revision: 1 };
      })] };
      sessions.set(workoutKey, session);
    }
  }
  if (!workouts.size) throw new Error("На выбранном листе нет тренировок.");
  const weeks = Array.from({ length: maxWeek }, (_, i) => ({ id: `${source}:week:${i + 1}`, index: i + 1, type: "base" as const, workouts: [...workouts.values()].filter((w) => w.index === i + 1).map((w) => w.workout) }));
  return { format: "athlete-training", version: 1, sourceId, client: { id: source, name: "Импорт Excel" }, exercises: [...catalog.values()], programs: [{ id: programId, title: table.name, kind: "PERIODIZED", createdAt: "2000-01-01T00:00:00.000Z", archivedAt: null, simple: null, simpleWeeks: [], mesocycles: [{ id: `${source}:cycle`, lineageId: `${source}:cycle`, title: table.name, ...table.cycle, weeks }] }], sessions: [...sessions.values()], ...(issues.length ? { issues } : {}) };
}
