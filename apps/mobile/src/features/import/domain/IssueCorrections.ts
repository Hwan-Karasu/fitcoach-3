import type { TrainingTransfer, TransferIssue, TransferSet, TransferFact } from "../../../shared/training-transfer/TrainingTransfer.ts";
const ISSUES_SHEET = "Проверить значения";
function find(value: TrainingTransfer, issue: TransferIssue): TransferSet | TransferFact | null {
  if (issue.scope === "FACT") return value.sessions.filter((s) => s.programId === issue.programId).flatMap((s) => s.facts).find((f) => f.id === issue.targetId) ?? null;
  const p = value.programs.find((p) => p.id === issue.programId); if (!p) return null;
  const weeks = p.simple ? p.simpleWeeks.length ? p.simpleWeeks : [{ index: 1, workouts: p.simple.workouts }] : p.mesocycles.flatMap((c) => c.weeks);
  return weeks.filter((w) => issue.weekIndex === undefined || w.index === issue.weekIndex).flatMap((w) => w.workouts).filter((w) => issue.workoutId === undefined || w.id === issue.workoutId).flatMap((w) => w.exercises.flatMap((e) => e.sets)).find((s) => s.id === issue.targetId) ?? null;
}
export function applyIssueCorrections(value: TrainingTransfer, original: TrainingTransfer, corrections: ReadonlyMap<string, unknown>): TrainingTransfer {
  if (!value.issues?.length) return value;
  const pending: TransferIssue[] = []; const removed = new Set<string>();
  for (const issue of value.issues) {
    const target = find(value, issue); if (!target) throw new Error("Значение для проверки ссылается на отсутствующий подход.");
    const correction = corrections.get(issue.id); const command = String(correction ?? "").trim().toLowerCase();
    if (command === "удалить подход" && issue.scope === "FACT") { removed.add(issue.targetId); continue; }
    if (!command) {
      const before = find(original, issue);
      const field = issue.scope === "FACT" && issue.field !== "rpe" ? (target as TransferFact).values[issue.field] : (target as unknown as Record<string, unknown>)[issue.field];
      const old = issue.scope === "FACT" && issue.field !== "rpe" ? (before as TransferFact | null)?.values[issue.field] : (before as unknown as Record<string, unknown> | null)?.[issue.field];
      if (field === old || field === null || field === undefined) pending.push(issue);
      continue;
    }
    let n: number | null = null;
    if (command !== "пусто") {
      const parsed = Number(command.replace(",", ".")) * (issue.field === "loadGrams" ? 1000 : 1);
      const minimum = issue.field === "loadGrams" ? 0 : 1;
      const maximum = issue.field === "reps" ? 999 : issue.field === "durationSec" ? 86400 : issue.field === "rpe" ? 10 : 1000000;
      if (!Number.isFinite(parsed) || Math.abs(Math.round(parsed) - parsed) > 0.00001 || parsed < minimum || parsed > maximum) throw new Error(`Лист «${ISSUES_SHEET}», строка ${[...corrections.keys()].indexOf(issue.id) + 2}, столбец «Исправление»: введите допустимое число либо «пусто».`);
      n = Math.round(parsed);
    }
    if (issue.scope === "FACT") {
      if (issue.field === "rpe") Object.assign(target, { rpe: n });
      else Object.assign((target as TransferFact).values, { [issue.field]: n });
    } else Object.assign(target, { [issue.field]: n });
  }
  for (const session of value.sessions) (session as { facts: readonly TransferFact[] }).facts = session.facts.filter((f) => !removed.has(f.id));
  const issues = pending.filter((i) => !removed.has(i.targetId));
  const touched = new Set(value.issues.filter((issue) => issue.scope === "FACT" && corrections.has(issue.id)
    && String(corrections.get(issue.id) ?? "").trim()).map((issue) => issue.targetId));
  for (const fact of value.sessions.flatMap((session) => session.facts)) {
    if (touched.has(fact.id)) Object.assign(fact, { confirmed: !issues.some((issue) => issue.targetId === fact.id)
      && Object.values(fact.values).some((field) => field !== null) });
  }
  const { issues: originalIssues, ...rest } = value; void originalIssues;
  return issues.length ? { ...rest, issues } : rest;
}

/** UI corrections operate on a copy so another worksheet or the source workbook cannot be mutated. */
export function correctTransferIssue(value: TrainingTransfer, issueId: string, correction: string): TrainingTransfer {
  if (!value.issues?.some((issue) => issue.id === issueId)) throw new Error("Значение уже исправлено или лист изменился.");
  if (!correction.trim()) throw new Error("Введите число или нажмите «Оставить пустым».");
  if (correction.trim().toLowerCase() === "удалить подход") throw new Error("Введите число или нажмите «Оставить пустым».");
  const copy = JSON.parse(JSON.stringify(value)) as TrainingTransfer;
  try { return applyIssueCorrections(copy, value, new Map([[issueId, correction]])); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith(`Лист «${ISSUES_SHEET}»`)) {
      throw new Error("Введите допустимое число или нажмите «Оставить пустым».", { cause: error });
    }
    throw error;
  }
}
