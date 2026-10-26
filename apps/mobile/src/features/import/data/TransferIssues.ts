import * as XLSX from "xlsx";
import type { TrainingTransfer, TransferIssue } from "../../../shared/training-transfer/TrainingTransfer.ts";
export const ISSUES_SHEET = "Проверить значения";
export function appendTransferIssues(book: XLSX.WorkBook, value: TrainingTransfer): void {
  if (!value.issues?.length) return;
  const labels: Record<TransferIssue["field"], string> = { reps: "Повторы", loadGrams: "Вес, кг", durationSec: "Время, сек", distanceM: "Расстояние, м", rpe: "RPE" };
  const sheet = XLSX.utils.json_to_sheet(value.issues.map((issue) => {
    const program = value.programs.find((p) => p.id === issue.programId);
    const session = issue.scope === "FACT" ? value.sessions.find((s) => s.programId === issue.programId && s.facts.some((f) => f.id === issue.targetId)) : undefined;
    const fact = session?.facts.find((f) => f.id === issue.targetId);
    const workouts = program?.simple ? [...program.simple.workouts, ...program.simpleWeeks.flatMap((w) => w.workouts)] : program?.mesocycles.flatMap((c) => c.weeks.flatMap((w) => w.workouts)) ?? [];
    const workout = workouts.find((w) => w.id === (session?.plannedWorkoutId ?? issue.workoutId));
    const exercise = workout?.exercises.find((e) => issue.scope === "FACT" ? e.id === fact?.plannedExerciseId : e.sets.some((s) => s.id === issue.targetId));
    return { Показатель: `${issue.scope === "PLAN_SET" ? "План" : "Факт"}: ${labels[issue.field]}`, Исходное: issue.raw, Исправление: "", Подсказка: "Введите число, «пусто» или (для факта) «удалить подход»", Программа: program?.title ?? "", Неделя: session?.weekIndex ?? issue.weekIndex ?? "", Тренировка: workout?.title ?? session?.origin?.workoutTitle ?? "", Упражнение: value.exercises.find((e) => e.id === (fact?.exerciseId ?? exercise?.exerciseId))?.name ?? "", Подход: fact ? fact.position + 1 : (exercise?.sets.findIndex((s) => s.id === issue.targetId) ?? -1) + 1, Дата: session?.actualDate ?? "", metadata: JSON.stringify(issue) };
  }));
  sheet["!cols"] = [{ wch: 23 }, { wch: 30 }, { wch: 22 }, { wch: 66 }, { wch: 30 }, { wch: 10 }, { wch: 30 }, { wch: 35 }, { wch: 10 }, { wch: 13 }, { hidden: true }];
  XLSX.utils.book_append_sheet(book, sheet, ISSUES_SHEET);
}
export function readTransferIssues(book: XLSX.WorkBook): { issues: TransferIssue[]; corrections: ReadonlyMap<string, unknown> } {
  const sheet = book.Sheets[ISSUES_SHEET]; if (!sheet) return { issues: [], corrections: new Map() };
  const issues: TransferIssue[] = []; const corrections = new Map<string, unknown>();
  for (const row of XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null })) {
    const issue = JSON.parse(String(row.metadata)) as TransferIssue;
    if (!issue || typeof issue.id !== "string" || corrections.has(issue.id) || typeof issue.programId !== "string" || typeof issue.targetId !== "string" || typeof issue.raw !== "string" || !["PLAN_SET", "FACT"].includes(issue.scope) || !["reps", "loadGrams", "durationSec", "distanceM", "rpe"].includes(issue.field)) throw new Error("Повреждён список значений, требующих проверки.");
    issues.push(issue); corrections.set(issue.id, row.Исправление);
  }
  return { issues, corrections };
}
export { applyIssueCorrections } from "../domain/IssueCorrections.ts";
