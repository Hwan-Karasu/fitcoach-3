import type { ImportCellOrigin, ImportTable } from "./WorkbookFilesPort.ts";
import { isTechnicalExerciseName } from "../../../shared/training-transfer/VisibleTrainingTransfer.ts";
import { parseMatrixPlan } from "../../../shared/training-transfer/MatrixPlan.ts";
/** Adapter for the four-column weekly matrices accepted by stable 2.0. */
export function flattenLegacyMatrix(table: ImportTable): ImportTable | null {
  const text = (v: unknown) => String(v ?? "").trim();
  const key = (v: unknown) => text(v).toLowerCase().replace(/[.\s]+/gu, " ").trim();
  let header = -1; let starts: { column: number; week: string; app: boolean }[] = [];
  for (let row = 0; row < Math.min(30, table.rows.length); row++) {
    const candidates: { column: number; week: string; app: boolean }[] = [];
    for (let col = 0; col < (table.rows[row]?.length ?? 0); col++) {
      const app = key(table.rows[row]?.[col]) === "план" && /^пред/u.test(key(table.rows[row]?.[col + 1]));
      if (!app && (!/(?:пл|план).*(?:повт)/u.test(key(table.rows[row]?.[col])) || !/(?:пл|план).*(?:вес)/u.test(key(table.rows[row]?.[col + 1])))) continue;
      let label = "";
      for (let earlier = row - 1; earlier >= 0; earlier--) { const value = text(table.rows[earlier]?.[col]); if (/(?:недел|week)/iu.test(value)) { label = value; break; } }
      if (label) candidates.push({ column: col, week: label, app });
    }
    if (candidates.length) { header = row; starts = candidates; break; }
  }
  if (header < 0) return null;
  const blockEnd = (column: number) => starts.find((start) => start.column > column)?.column ?? table.rows[header]!.length;
  const hasData = (row: readonly unknown[], column: number) => row.slice(column, blockEnd(column)).some((cell) => text(cell));
  const rows: unknown[][] = [["Неделя", "Тренировка", "Упражнение", "Подходы", "План повторений", "План вес", "Факт повторений", "Факт вес", "RIR", "Заметка", "Дата", "План секунд", "План метров", "Факт секунд", "Факт метров"]];
  let workout = "Тренировка 1"; let exercise = "";
  const cellOrigins: (ImportCellOrigin | null)[][] = [[]];
  for (const [sourceIndex, row] of table.rows.entries()) {
    if (sourceIndex <= header) continue;
    const first = text(row[0]); const second = text(row[1]);
    if (first && !second && starts.every((s) => !hasData(row, s.column))) { workout = first; exercise = ""; continue; }
    if (isTechnicalExerciseName(first)) { exercise = ""; continue; }
    if (first && !/^\d+$/u.test(first) && !/^(?:итого|объем|тоннаж)/iu.test(first)) exercise = first;
    if (!exercise) continue;
    for (const start of starts) {
      if (!hasData(row, start.column)) continue;
      if (start.app) {
        const plan = text(row[start.column]);
        let values; try { values = parseMatrixPlan(plan); } catch (cause) { throw new Error(`${table.name}: ${cause instanceof Error ? cause.message : "Неверный план."}`, { cause }); }
        const durationColumn = table.rows[header]?.findIndex((v, col) => col > start.column && col < (starts.find((s) => s.column > start.column)?.column ?? Infinity) && key(v) === "сек") ?? -1;
        const distanceColumn = table.rows[header]?.findIndex((v, col) => col > start.column && col < (starts.find((s) => s.column > start.column)?.column ?? Infinity) && key(v) === "м") ?? -1;
        const dateColumn = table.rows[header]?.findIndex((v, col) => col > start.column && col < blockEnd(start.column) && key(v) === "дата") ?? -1;
        rows.push([start.week, workout, exercise, 1, values.reps === null ? "" : values.repsMax === null ? values.reps : `${values.reps}-${values.repsMax}`, values.loadGrams === null ? "" : values.loadGrams / 1000, row[start.column + 2] ?? "", row[start.column + 3] ?? "", "", "", row[dateColumn] ?? "", values.durationSec ?? "", values.distanceM ?? "", row[durationColumn] ?? "", row[distanceColumn] ?? ""]);
        cellOrigins.push([null, null, 0, 1, start.column, start.column, start.column + 2, start.column + 3,
          null, null, dateColumn, start.column, start.column, durationColumn, distanceColumn]
          .map((column) => column === null || column < 0 ? null : { row: sourceIndex + 1, column: column + 1 }));
      } else {
        rows.push([start.week, workout, exercise, 1, row[start.column] ?? "", row[start.column + 1] ?? "", row[start.column + 2] ?? "", row[start.column + 3] ?? "", "", "", ""]);
        cellOrigins.push([null, null, 0, 1, start.column, start.column + 1, start.column + 2, start.column + 3]
          .map((column) => column === null ? null : { row: sourceIndex + 1, column: column + 1 }));
      }
    }
  }
  return { name: table.name, rows, cellOrigins, matrixSource: table };
}
