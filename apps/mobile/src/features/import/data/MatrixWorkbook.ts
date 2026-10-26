import * as XLSX from "xlsx";
import { spreadsheetDay } from "../../../shared/training-transfer/SpreadsheetDay.ts";
import { parseMatrixPlan } from "../../../shared/training-transfer/MatrixPlan.ts";
export { parseMatrixPlan } from "../../../shared/training-transfer/MatrixPlan.ts";
import type { TrainingTransfer, TransferFact, TransferSet, TransferValues, TransferWorkout } from "../../../shared/training-transfer/TrainingTransfer.ts";

interface CellLink {
  sheet: string; row: number; col: number; programId: string; cycleId: string | null; week: number;
  workoutId: string; exerciseId: string; catalogId: string; setId: string | null; factId: string | null;
  before: (string | number | boolean | null)[];
  historical?: boolean;
}
const labels = ["План", "Пред.", "Повт.", "Кг", "Дата", "Тип", "Выполнен", "Сек", "М"];
const valueText = (v: TransferValues): string => [v.reps === null ? "" : `${v.reps}`, v.loadGrams === null ? "" : `${v.loadGrams / 1000} кг`, v.durationSec === null ? "" : `${v.durationSec} с`, v.distanceM === null ? "" : `${v.distanceM} м`].filter(Boolean).join(" × ");
const factText = (f: TransferFact): string => f.sides ? `Л: ${valueText(f.sides.left.values)} / П: ${valueText(f.sides.right.values)}` : [f.values, ...f.drops].map(valueText).join(" → ");
function metricCell(f: TransferFact | null, field: keyof TransferValues, factor = 1): string | number | null {
  const cell = (v: TransferValues) => v[field] === null ? null : v[field]! / factor;
  if (!f) return null;
  if (f.sides) return `Л: ${cell(f.sides.left.values) ?? "—"} / П: ${cell(f.sides.right.values) ?? "—"}`;
  return f.drops.length ? [f.values, ...f.drops].map((v) => cell(v) ?? "—").join(" → ") : cell(f.values);
}
export const matrixPlanText = (s: TransferSet): string => [s.reps === null ? "" : s.repsMax === null ? String(s.reps) : `${s.reps}–${s.repsMax}`, s.loadGrams === null ? "" : `${s.loadGrams / 1000} кг`, s.durationSec === null ? "" : `${s.durationSec} с`, s.distanceM === null ? "" : `${s.distanceM} м`].filter(Boolean).join(" × ");
const setLabels = { NORMAL: "Рабочий", WARMUP: "Разминка", FAILURE: "Отказ", DROP: "Дроп-сет" } as const;

/** Visible worksheets mirror the app's matrix; hidden sheets retain lossless identities and non-tabular facts. */
export function appendMatrixSheets(book: XLSX.WorkBook, value: TrainingTransfer): void {
  const links: CellLink[] = []; const visible: string[] = [];
  const names = new Map(value.exercises.map((e) => [e.id, e.name]));
  const sessionMap = new Map(value.sessions.map((s) => [JSON.stringify([s.programId, s.weekIndex, s.plannedWorkoutId]), s]));
  for (const p of value.programs) {
    const scopes: { id: string | null; title: string; weeks: readonly { index: number; workouts: readonly TransferWorkout[] }[]; historical?: boolean }[] = [...(p.simple ? [{ id: null, title: p.title, weeks: Array.from({ length: p.simple.weeks }, (_, i) => ({ index: i + 1, workouts: p.simpleWeeks.find((w) => w.index === i + 1)?.workouts ?? p.simple!.workouts })) }] : p.mesocycles)];
    for (const h of value.planHistory?.filter((h) => h.programId === p.id) ?? []) scopes.push({ id: `history:${h.id}`, title: `${h.simple?.title ?? h.mesocycle?.title ?? p.title} · ${h.validFrom.slice(0, 10)} — ${h.validTo.slice(0, 10)} · История`, weeks: h.simple?.weeks ?? h.mesocycle?.weeks ?? [], historical: true });
    const represented = new Set(scopes.flatMap((scope) => scope.weeks.flatMap((w) => w.workouts.map((workout) => JSON.stringify([w.index, workout.id])))));
    const retained = value.sessions.filter((s) => s.programId === p.id && !represented.has(JSON.stringify([s.weekIndex, s.plannedWorkoutId])));
    if (retained.length) scopes.push({ id: "retained-history", title: "Сохранённые результаты без текущего плана", weeks: [...new Set(retained.map((s) => s.weekIndex))].sort((a, b) => a - b).map((index) => ({ index, workouts: retained.filter((s) => s.weekIndex === index).map((s): TransferWorkout => ({ id: s.plannedWorkoutId, title: s.origin?.workoutTitle ?? "Историческая тренировка", exercises: [...new Set(s.facts.map((f) => f.plannedExerciseId))].sort().map((id) => ({ id, exerciseId: s.facts.find((f) => f.plannedExerciseId === id)!.exerciseId, restSec: null, instruction: null, rir: null, sets: [] })) })) })) });
    for (const cycle of scopes) {
      const sheetName = `Матрица ${visible.length + 1}`; visible.push(sheetName);
      const weeks = cycle.weeks.map((week) => ({ ...week, workouts: week.workouts.map((workout): TransferWorkout => {
        if (cycle.historical) return workout;
        const facts = sessionMap.get(JSON.stringify([p.id, week.index, workout.id]))?.facts ?? [];
        const planned = new Set(workout.exercises.map((e) => e.id));
        const retained = [...new Set(facts.filter((f) => !planned.has(f.plannedExerciseId)).map((f) => f.plannedExerciseId))].sort();
        return { ...workout, exercises: [...workout.exercises, ...retained.map((id) => ({ id, exerciseId: facts.find((f) => f.plannedExerciseId === id)!.exerciseId, restSec: null, instruction: null, rir: null, sets: [] }))] };
      }) }));
      const rows: (string | number | boolean | null)[][] = [[`${value.client.name} · ${p.title}${cycle.id ? ` · ${cycle.title}` : ""}`], ["Упражнение", "Подход"], ["", ""]];
      const merges: XLSX.Range[] = [];
      weeks.forEach((week, index) => { const col = 2 + index * labels.length; rows[1]![col] = `Неделя ${week.index}`; merges.push({ s: { r: 1, c: col }, e: { r: 1, c: col + labels.length - 1 } }); labels.forEach((label, offset) => { rows[2]![col + offset] = label; }); });
      const lastCol = Math.max(1, 1 + weeks.length * labels.length);
      merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } });
      const sections = new Map<string, { title: string; workouts: Map<number, TransferWorkout> }>();
      for (const week of weeks) for (const w of week.workouts) {
        const key = w.lineageId ?? w.id; const section = sections.get(key) ?? { title: w.title, workouts: new Map<number, TransferWorkout>() }; section.workouts.set(week.index, w); sections.set(key, section);
      }
      for (const section of sections.values()) {
        const row = rows.length; rows.push([section.title]); merges.push({ s: { r: row, c: 0 }, e: { r: row, c: lastCol } });
        const exerciseRows = new Map<string, { name: string; entries: Map<number, { workout: TransferWorkout; exercise: TransferWorkout["exercises"][number] }> }>();
        for (const [week, w] of section.workouts) for (const e of w.exercises) {
          const key = `${e.lineageId ?? e.id}:${e.exerciseId}`;
          const group = exerciseRows.get(key) ?? { name: names.get(e.exerciseId) ?? e.exerciseId, entries: new Map() };
          group.entries.set(week, { workout: w, exercise: e }); exerciseRows.set(key, group);
        }
        for (const group of exerciseRows.values()) {
          const count = Math.max(0, ...[...group.entries].map(([week, { workout, exercise }]) => {
            const s = sessionMap.get(JSON.stringify([p.id, week, workout.id]));
            return Math.max(exercise.sets.length, ...s?.facts.filter((f) => f.plannedExerciseId === exercise.id && !f.extra).map((f) => f.position + 1) ?? [0]);
          }));
          const warmupCount = Math.max(0, ...[...group.entries].map(([week, { workout, exercise }]) => sessionMap.get(JSON.stringify([p.id, week, workout.id]))?.facts.filter((f) => f.plannedExerciseId === exercise.id && f.extra).length ?? 0));
          for (let ordinal = 0; ordinal < count + warmupCount; ordinal++) {
            const position = ordinal - warmupCount; const warmup = position < 0;
            const rowIndex = rows.length; const cells: (string | number | boolean | null)[] = [ordinal === 0 ? group.name : "", warmup ? "Р" : position + 1];
            weeks.forEach((week, weekPosition) => {
              const entry = group.entries.get(week.index); if (!entry) return;
              const { workout, exercise } = entry; const plan = warmup ? null : exercise.sets[position] ?? null;
              const s = sessionMap.get(JSON.stringify([p.id, week.index, workout.id]));
              const fact = (warmup ? s?.facts.filter((f) => f.plannedExerciseId === exercise.id && f.extra).sort((a, b) => a.position - b.position)[ordinal] : s?.facts.find((f) => f.plannedExerciseId === exercise.id && !f.extra && f.position === position)) ?? null;
              if (!plan && !fact) return;
              const previousEntry = group.entries.get(week.index - 1);
              const previousSession = previousEntry ? sessionMap.get(JSON.stringify([p.id, week.index - 1, previousEntry.workout.id])) : null;
              const previous = previousSession?.facts.find((f) => f.plannedExerciseId === previousEntry?.exercise.id && f.position === position && f.confirmed && !f.extra);
              const col = 2 + weekPosition * labels.length;
              const data = [plan ? matrixPlanText(plan) : "", previous ? factText(previous) : "", metricCell(fact, "reps"), metricCell(fact, "loadGrams", 1000), s?.actualDate ?? "", fact ? setLabels[fact.setType] : "Рабочий", fact?.confirmed ?? false, metricCell(fact, "durationSec"), metricCell(fact, "distanceM")];
              data.forEach((v, i) => { cells[col + i] = v; });
              links.push({ sheet: sheetName, row: rowIndex, col, programId: p.id, cycleId: cycle.id, week: week.index, workoutId: workout.id, exerciseId: exercise.id, catalogId: exercise.exerciseId, setId: plan?.id ?? null, factId: fact?.id ?? null, before: data, ...(cycle.historical ? { historical: true } : {}) });
            });
            rows.push(cells);
          }
        }
      }
      const sheet = XLSX.utils.aoa_to_sheet(rows); sheet["!merges"] = merges;
      const hasTime = weeks.some((w) => w.workouts.some((workout) => workout.exercises.some((e) => e.sets.some((s) => s.durationSec !== null)))) || value.sessions.some((s) => s.programId === p.id && s.facts.some((f) => f.values.durationSec !== null));
      const hasDistance = weeks.some((w) => w.workouts.some((workout) => workout.exercises.some((e) => e.sets.some((s) => s.distanceM !== null)))) || value.sessions.some((s) => s.programId === p.id && s.facts.some((f) => f.values.distanceM !== null));
      sheet["!cols"] = [{ wch: 38 }, { wch: 9 }, ...weeks.flatMap(() => [{ wch: 24 }, { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 13 }, { wch: 12, hidden: true }, { wch: 12, hidden: true }, { wch: 9, hidden: !hasTime }, { wch: 9, hidden: !hasDistance }])];
      XLSX.utils.book_append_sheet(book, sheet, sheetName);
    }
  }
  const guide = "Как пользоваться"; visible.push(guide);
  if (book.Sheets["Проверить значения"]) visible.push("Проверить значения");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Матрицы тренировок"],
    ["Недели расположены по столбцам, упражнения и подходы — по строкам, как в приложении."],
    ["Вес указан в килограммах. План: 8–10 × 62,5 кг. Пустая ячейка означает отсутствие значения."],
    ["Можно изменять план и фактические значения в существующих ячейках. Дата — YYYY-MM-DD, одна дата на тренировку."],
    ["Пред. рассчитывается из подтверждённых фактов предыдущей недели; изменение этой ячейки не создаёт результата."],
    ["Строки и столбцы не переставляйте и не удаляйте. Для новых планов используйте шаблон импорта."],
    ["Скрытые листы нужны для точного восстановления структуры, типов подходов, сторон и мини-сетов."],
  ]), guide);
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(links.map((l) => ({ json: JSON.stringify(l) }))), "__Матрица");
  book.SheetNames = [...visible, ...book.SheetNames.filter((n) => !visible.includes(n))];
  book.Workbook ??= {}; book.Workbook.Sheets = book.SheetNames.map((name) => ({ name, Hidden: visible.includes(name) ? 0 : 1 }));
}

/** Apply edits in visible cells to the validated underlying graph before preview/commit. */
export function applyMatrixEdits(book: XLSX.WorkBook, value: TrainingTransfer): TrainingTransfer {
  const indexSheet = book.Sheets["__Матрица"]; if (!indexSheet) return value;
  // The expected links are derived again from validated data; the supplied index cannot redirect writes.
  const expected = XLSX.utils.book_new(); appendMatrixSheets(expected, value);
  const expectedLinks = XLSX.utils.sheet_to_json<{ json: string }>(expected.Sheets["__Матрица"]!);
  const suppliedLinks = XLSX.utils.sheet_to_json<{ json: string }>(indexSheet);
  if (JSON.stringify(expectedLinks) !== JSON.stringify(suppliedLinks)) throw new Error("Служебная структура матрицы изменена. Повторите экспорт.");
  const result = JSON.parse(JSON.stringify(value)) as TrainingTransfer;
  for (const name of expected.SheetNames.filter((n) => n.startsWith("Матрица "))) {
    const original = expected.Sheets[name]!; const edited = book.Sheets[name];
    if (!edited || edited["!ref"] !== original["!ref"]) throw new Error(`Структура листа ${name} изменилась. Повторите экспорт.`);
    const end = XLSX.utils.decode_range(original["!ref"] ?? "A1").e;
    for (let row = 0; row <= end.r; row++) for (const col of row < 3 ? Array.from({ length: end.c + 1 }, (_, i) => i) : [0, 1]) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      if (String(edited[address]?.v ?? "") !== String(original[address]?.v ?? "")) throw new Error(`${name}: названия, номера подходов и заголовки должны сохраняться.`);
    }
  }
  const sessions = result.sessions as TransferSessionMutable[];
  const plansByWeek = new Map<string, TransferSet>();
  for (const p of result.programs) {
    if (p.simple) for (let week = 1; week <= p.simple.weeks; week++) {
      const override = p.simpleWeeks.find((w) => w.index === week);
      // Independent week copies are necessary when editing the repeated base plan.
      if (!override) (p.simpleWeeks as { index: number; workouts: TransferWorkout[] }[]).push({ index: week, workouts: JSON.parse(JSON.stringify(p.simple.workouts)) as TransferWorkout[] });
    }
    const visit = (week: number, workouts: readonly TransferWorkout[]) => workouts.forEach((w) => w.exercises.forEach((e) => e.sets.forEach((s) => plansByWeek.set(JSON.stringify([p.id, week, w.id, e.id, s.id]), s))));
    p.simpleWeeks.forEach((w) => visit(w.index, w.workouts)); p.mesocycles.forEach((c) => c.weeks.forEach((w) => visit(w.index, w.workouts)));
  }
  const touchedDates = new Map<string, string>();
  for (const entry of expectedLinks) {
    const link = JSON.parse(entry.json) as CellLink;
    const sheet = book.Sheets[link.sheet]; if (!sheet) throw new Error(`Отсутствует лист ${link.sheet}.`);
    const now = labels.map((_, i) => sheet[XLSX.utils.encode_cell({ r: link.row, c: link.col + i })]?.v ?? null);
    const normalized = (v: unknown) => v === null || v === undefined || v === "" ? "" : String(v);
    const changed = now.map((v, i) => normalized(v) !== normalized(link.before[i]));
    if (!changed.some((v, i) => v && i !== 1)) continue; // «Пред.» is derived, never imported as a fact.
    const fail = (message: string): never => { throw new Error(`${link.sheet}, строка ${link.row + 1}: ${message}`); };
    if (link.historical) fail("историческая версия плана доступна только для чтения");
    if (changed[0]) {
      const plan = plansByWeek.get(JSON.stringify([link.programId, link.week, link.workoutId, link.exerciseId, link.setId]));
      if (!plan) fail("у исторического подхода нет текущего плана");
      try { Object.assign(plan!, parseMatrixPlan(String(now[0] ?? ""))); }
      catch (cause) { fail(cause instanceof Error ? cause.message : "некорректный план подхода"); }
    }
    const sessionKey = JSON.stringify([link.programId, link.week, link.workoutId]);
    let session = sessions.find((s) => s.programId === link.programId && s.weekIndex === link.week && s.plannedWorkoutId === link.workoutId);
    if (changed[4]) {
      const date = spreadsheetDay(now[4], !!book.Workbook?.WBProps?.date1904) ?? fail("укажите дату YYYY-MM-DD или ДД.ММ.ГГГГ");
      if (touchedDates.has(sessionKey) && touchedDates.get(sessionKey) !== date) fail("у одной тренировки указаны разные даты");
      touchedDates.set(sessionKey, date);
    }
    const changedFact = [2, 3, 5, 6, 7, 8].some((i) => changed[i]);
    if (!changedFact && !changed[4]) continue;
    if (!session) {
      if (!link.setId) fail("нельзя создать факт без планового подхода");
      session = { id: `matrix:${link.programId}:${link.week}:${link.workoutId}`, programId: link.programId, weekIndex: link.week, plannedWorkoutId: link.workoutId, actualDate: null, startedAt: null, finishedAt: null, outcome: null, origin: null, facts: [], notes: [] }; sessions.push(session);
    }
    if (changedFact) {
      const existing = session.facts.find((f) => f.id === link.factId);
      if (existing?.sides || existing?.drops.length) fail("стороны и мини-сеты этого подхода редактируются в приложении");
      const number = (index: number, factor = 1) => { const v = now[index]; if (v === null || v === "") return null; const n = Number(String(v).replace(",", ".")) * factor; if (!Number.isFinite(n) || Math.abs(Math.round(n) - n) > 0.00001) return fail(`неверное число в ${labels[index]}`); return Math.round(n); };
      const type = Object.entries(setLabels).find(([, label]) => label === now[5])?.[0] as TransferFact["setType"] | undefined;
      if (!type || type === "DROP") fail("для нового дроп-сета нужны мини-сеты; создайте его в приложении");
      if (now[6] !== true && now[6] !== false) fail("в «Выполнен» укажите TRUE или FALSE");
      const fact: TransferFact = { id: existing?.id ?? `matrix:${session.id}:${link.setId}`, plannedSetId: existing?.plannedSetId ?? link.setId!, plannedExerciseId: link.exerciseId, exerciseId: link.catalogId, position: existing?.position ?? Number(sheet[XLSX.utils.encode_cell({ r: link.row, c: 1 })]?.v) - 1,
        setType: type!, values: { reps: number(2), loadGrams: number(3, 1000), durationSec: number(7), distanceM: number(8) }, confirmed: now[6] === true, drops: [], sides: null, extra: existing?.extra ?? false, origin: existing?.origin ?? "IMPORT", revision: existing?.revision ?? 1, rpe: existing?.rpe ?? null };
      if (existing) session.facts[session.facts.indexOf(existing)] = fact; else session.facts.push(fact);
    }
  }
  for (const session of sessions) { const date = touchedDates.get(JSON.stringify([session.programId, session.weekIndex, session.plannedWorkoutId])); if (date) session.actualDate = date; }
  return result;
}
type TransferSessionMutable = Omit<TrainingTransfer["sessions"][number], "facts" | "actualDate"> & { actualDate: string | null; facts: TransferFact[] };
