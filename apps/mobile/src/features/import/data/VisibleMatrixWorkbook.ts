import * as XLSX from "xlsx";
import type { TrainingTransfer, TransferFact, TransferSet, TransferValues, TransferWorkout } from "../../../shared/training-transfer/TrainingTransfer.ts";
import { visibleTrainingTransfer } from "../../../shared/training-transfer/VisibleTrainingTransfer.ts";

const planText = (set: TransferSet) => [set.reps === null ? "" : set.repsMax === null ? String(set.reps) : `${set.reps}–${set.repsMax}`, set.loadGrams === null ? "" : `${set.loadGrams / 1000} кг`, set.durationSec === null ? "" : `${set.durationSec} с`, set.distanceM === null ? "" : `${set.distanceM} м`].filter(Boolean).join(" × ");
const metric = (f: TransferFact | undefined, field: keyof TransferValues, factor = 1): string | number | null => {
  if (!f) return null;
  const cell = (v: TransferValues) => v[field] === null ? "" : v[field]! / factor;
  if (f.sides) return `Л: ${cell(f.sides.left.values)} / П: ${cell(f.sides.right.values)}`;
  return f.drops.length ? [f.values, ...f.drops].map(cell).join(" → ") : f.values[field] === null ? null : f.values[field]! / factor;
};

/** Ordinary, visible worksheets only: no internal IDs, metadata, hidden rows/columns or historical plans. */
export function writeVisibleTrainingWorkbook(input: TrainingTransfer): Uint8Array {
  const value = visibleTrainingTransfer(input); const book = XLSX.utils.book_new();
  const names = new Map(value.exercises.map((e) => [e.id, e.name]));
  const sessions = new Map(value.sessions.map((s) => [JSON.stringify([s.programId, s.weekIndex, s.plannedWorkoutId]), s]));
  for (const p of value.programs) {
    const scopes = p.simple ? [{ title: p.title, weeks: Array.from({ length: p.simple.weeks }, (_, at) => ({ index: at + 1, workouts: p.simpleWeeks.find((w) => w.index === at + 1)?.workouts ?? p.simple!.workouts })) }] : p.mesocycles;
    for (const scope of scopes) {
      const timed = scope.weeks.some((w) => w.workouts.some((item) => item.exercises.some((e) => e.sets.some((s) => s.durationSec !== null || s.distanceM !== null))));
      const labels = ["План", "Пред.", "Повт.", "Кг", "Дата", ...(timed ? ["Сек", "М"] : [])];
      const rows: (string | number | null)[][] = [[`${value.client.name} · ${p.title}${scope.title !== p.title ? ` · ${scope.title}` : ""}`], ["Упражнение", "Подход"], ["", ""]];
      const merges: XLSX.Range[] = [];
      scope.weeks.forEach((w, at) => { const col = 2 + at * labels.length; rows[1]![col] = `Неделя ${w.index}`; labels.forEach((label, offset) => { rows[2]![col + offset] = label; }); merges.push({ s: { r: 1, c: col }, e: { r: 1, c: col + labels.length - 1 } }); });
      const lastCol = Math.max(1, 1 + scope.weeks.length * labels.length);
      merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } });
      const sections = new Map<string, { title: string; workouts: Map<number, TransferWorkout> }>();
      for (const week of scope.weeks) for (const w of week.workouts) { const key = w.lineageId ?? w.id; const section = sections.get(key) ?? { title: w.title, workouts: new Map() }; section.workouts.set(week.index, w); sections.set(key, section); }
      for (const section of sections.values()) {
        const sectionRow = rows.length; rows.push([section.title]); merges.push({ s: { r: sectionRow, c: 0 }, e: { r: sectionRow, c: lastCol } });
        const groups = new Map<string, Map<number, { workout: TransferWorkout; exercise: TransferWorkout["exercises"][number] }>>();
        for (const [week, workout] of section.workouts) for (const exercise of workout.exercises) { const key = JSON.stringify([exercise.lineageId ?? exercise.id, exercise.exerciseId]); const group = groups.get(key) ?? new Map(); group.set(week, { workout, exercise }); groups.set(key, group); }
        for (const group of groups.values()) {
          const entries = [...group];
          const count = Math.max(0, ...entries.map(([, e]) => e.exercise.sets.length));
          const warmups = Math.max(0, ...entries.map(([week, e]) => sessions.get(JSON.stringify([p.id, week, e.workout.id]))?.facts.filter((f) => f.plannedExerciseId === e.exercise.id && f.extra).length ?? 0));
          for (let ordinal = 0; ordinal < count + warmups; ordinal++) {
            const position = ordinal - warmups; const row: (string | number | null)[] = [ordinal === 0 ? names.get(entries[0]![1].exercise.exerciseId)! : "", position < 0 ? "Р" : position + 1];
            scope.weeks.forEach((week, at) => {
              const entry = group.get(week.index); if (!entry) return;
              const session = sessions.get(JSON.stringify([p.id, week.index, entry.workout.id]));
              const facts = session?.facts.filter((f) => f.plannedExerciseId === entry.exercise.id) ?? [];
              const fact = position < 0 ? facts.filter((f) => f.extra).sort((a, b) => a.position - b.position)[ordinal] : facts.find((f) => !f.extra && f.plannedSetId === entry.exercise.sets[position]?.id);
              const plan = position < 0 ? undefined : entry.exercise.sets[position]; if (!plan && !fact) return;
              let previous: TransferFact | undefined;
              for (const [prior, item] of entries.filter(([i]) => i < week.index).sort(([a], [b]) => b - a)) {
                previous = sessions.get(JSON.stringify([p.id, prior, item.workout.id]))?.facts.find((f) => f.plannedExerciseId === item.exercise.id && f.position === position && f.confirmed && !f.extra); if (previous) break;
              }
              const col = 2 + at * labels.length;
              const issue = (field: keyof TransferValues) => { const raw = value.issues?.find((i) => i.scope === "FACT" && i.targetId === fact?.id && i.field === field)?.raw; return raw === "Отметка выполнения без результата" ? undefined : raw; };
              const data = [plan ? planText(plan) : "", previous ? [metric(previous, "reps"), metric(previous, "loadGrams", 1000)].filter((v) => v !== null && v !== "").join(" × ") : "", issue("reps") ?? metric(fact, "reps"), issue("loadGrams") ?? metric(fact, "loadGrams", 1000), session?.actualDate ?? "неизвестно", ...(timed ? [metric(fact, "durationSec"), metric(fact, "distanceM")] : [])];
              data.forEach((cell, offset) => { row[col + offset] = cell; });
            }); rows.push(row);
          }
        }
      }
      const sheet = XLSX.utils.aoa_to_sheet(rows); sheet["!merges"] = merges;
      sheet["!cols"] = [{ wch: 38 }, { wch: 9 }, ...scope.weeks.flatMap(() => labels.map((label) => ({ wch: label === "План" ? 24 : label === "Дата" ? 15 : 12 })))];
      const baseName = scope.title.replace(/[\\/?*\u005B\u005D:]/gu, " ").trim().slice(0, 31) || "Матрица";
      let name = baseName; let suffix = 1; while (book.Sheets[name]) { const ending = ` (${++suffix})`; name = `${baseName.slice(0, 31 - ending.length)}${ending}`; }
      XLSX.utils.book_append_sheet(book, sheet, name);
    }
  }
  if (!book.SheetNames.length) throw new Error("Нет видимых матриц для экспорта.");
  const bytes: unknown = XLSX.write(book, { type: "array", bookType: "xlsx", compression: true });
  const result = new Uint8Array(bytes as ArrayBuffer);
  if (result.length > 20 * 1024 * 1024) throw new Error("Файл превышает 20 МБ. Выберите меньше программ.");
  return result;
}
