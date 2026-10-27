import { assertValidTransfer } from "../domain/TransferValidation.ts";
import * as XLSX from "xlsx";
import { appendMatrixSheets, applyMatrixEdits } from "./MatrixWorkbook.ts";
import { appendTransferIssues, readTransferIssues, applyIssueCorrections } from "./TransferIssues.ts";
import type { TrainingTransfer, TransferProgram, TransferWorkout, TransferExercise, TransferSet, TransferCycle, TransferWeek, TransferSession, TransferFact } from "../../../shared/training-transfer/TrainingTransfer.ts";

type Row = Record<string, string | number | boolean | null>;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 100000;
const sheets = ["Программы", "Мезоциклы", "Недели", "Тренировки", "Упражнения плана", "Плановые подходы", "Занятия", "Фактические подходы", "Заметки", "Справочник"] as const;
export class WorkbookError extends Error {
  readonly sheet: string; readonly row: number; readonly column: string;
  constructor(sheet: string, row: number, column: string, message: string) {
    super(`${sheet}, строка ${row}, столбец ${column}: ${message}`);
    this.sheet = sheet; this.row = row; this.column = column;
  }
}
export function writeTrainingWorkbook(value: TrainingTransfer): Uint8Array {
  const book = XLSX.utils.book_new();
  const rows: Record<string, Row[]> = Object.fromEntries(sheets.map((name) => [name, []]));
  const metadata: Row[] = [{ format: value.format, version: value.version, sourceId: value.sourceId, clientId: value.client.id, clientName: value.client.name, issueCount: value.issues?.length ?? 0,
    description: "Одна строка — один подход. Вес в граммах, время в секундах, расстояние в метрах. Пустая ячейка — значение отсутствует. Пред. рассчитывается из фактов." }];
  let serial = 0;
  const push = (sheet: string, row: Row) => { rows[sheet]!.push(row); };
  const workouts = (programId: string, scope: string, parent: string, items: readonly TransferWorkout[]) => {
    for (const [position, { exercises, ...workout }] of items.entries()) {
      const key = `w${++serial}`;
      push("Тренировки", { key, programId, scope, parent, position, ...workout });
      for (const [exercisePosition, { sets, rir, ...exercise }] of exercises.entries()) {
        const exerciseKey = `e${++serial}`;
        push("Упражнения плана", { key: exerciseKey, parent: key, position: exercisePosition, ...exercise, rirMin: rir?.min ?? null, rirMax: rir?.max ?? null });
        for (const [setPosition, set] of sets.entries()) push("Плановые подходы", { parent: exerciseKey, position: setPosition, ...set });
      }
    }
  };
  for (const { simple, simpleWeeks, mesocycles, ...program } of value.programs) {
    push("Программы", { ...program, weeks: simple?.weeks ?? null });
    if (simple) workouts(program.id, "BASE", "", simple.workouts);
    for (const week of simpleWeeks) workouts(program.id, "OVERRIDE", String(week.index), week.workouts);
    for (const [position, { weeks, repRange, ...cycle }] of mesocycles.entries()) {
      push("Мезоциклы", { ...cycle, programId: program.id, position, repMin: repRange?.min ?? null, repMax: repRange?.max ?? null });
      for (const { workouts: items, ...week } of weeks) {
        push("Недели", { ...week, parent: cycle.id });
        workouts(program.id, "WEEK", week.id, items);
      }
    }
  }
  for (const { facts, notes, origin, ...session } of value.sessions) {
    push("Занятия", { ...session, origin: origin ? JSON.stringify(origin) : null });
    for (const { values, drops, sides, ...fact } of facts) push("Фактические подходы", { ...fact, ...values, parent: session.id, drops: JSON.stringify(drops), sides: sides ? JSON.stringify(sides) : null });
    for (const note of notes) push("Заметки", { ...note, parent: session.id });
  }
  rows["Справочник"] = value.exercises.map((e) => ({ ...e }));
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(metadata), "Формат");
  for (const name of sheets) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows[name]!), name);
  if (value.planHistory?.length) {
    const chunks: Row[] = [];
    for (const h of value.planHistory) { const json = JSON.stringify(h); for (let start = 0, part = 0; start < json.length; start += 16000, part++) chunks.push({ id: h.id, part, json: json.slice(start, start + 16000) }); }
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(chunks), "Версии плана");
  }
  appendTransferIssues(book, value);
  appendMatrixSheets(book, value);
  let rowCount = 0;
  for (const name of book.SheetNames) rowCount += XLSX.utils.decode_range(book.Sheets[name]?.["!ref"] ?? "A1").e.r + 1;
  if (book.SheetNames.length > 100 || rowCount > MAX_ROWS) throw new Error("Для одной книги слишком много данных. Выберите меньше программ.");
  const bytes: unknown = XLSX.write(book, { type: "array", bookType: "xlsx", compression: true });
  const result = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayBuffer);
  if (result.byteLength > MAX_BYTES) throw new Error("Файл превышает 20 МБ. Выберите меньше программ.");
  return result;
}

export function readWorkbook(bytes: Uint8Array): XLSX.WorkBook {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) throw new Error("Выберите Excel-файл размером до 20 МБ.");
  const book = XLSX.read(bytes, { type: "array", cellDates: false, cellFormula: true, sheetRows: MAX_ROWS + 2 });
  if (book.SheetNames.length > 100) throw new Error("В файле слишком много листов.");
  let count = 0;
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name]!;
    const range = XLSX.utils.decode_range(sheet["!fullref"] ?? sheet["!ref"] ?? "A1");
    count += range.e.r + 1;
    if (range.e.c > 512 || count > MAX_ROWS) throw new Error("В файле слишком много строк или столбцов.");
    for (const [address, cell] of Object.entries(sheet)) if (!address.startsWith("!") && cell && typeof cell === "object" && "f" in cell) {
      throw new WorkbookError(name, XLSX.utils.decode_cell(address).r + 1, address.replace(/\d+/u, ""), "замените формулу её значением");
    }
  }
  return book;
}
export function readTrainingWorkbook(book: XLSX.WorkBook): TrainingTransfer {
  const consumed = new Map<string, Set<Row>>();
  const table = (name: string): Row[] => {
    if (!book.Sheets[name]) throw new WorkbookError(name, 1, "A", "отсутствует обязательный лист");
    return XLSX.utils.sheet_to_json<Row>(book.Sheets[name]!, { defval: null, raw: true });
  };
  const all: Record<string, Row[]> = Object.fromEntries(["Формат", ...sheets].map((name) => [name, table(name)]));
  const error = (name: string, row: Row, key: string, message: string): never => { throw new WorkbookError(name, all[name]!.indexOf(row) + 2, key, message); };
  const text = (name: string, row: Row, key: string, optional = false): string => {
    const v = row[key];
    if (optional && v === null) return "";
    if (typeof v !== "string" || !v.trim() || v.length > 2000) return error(name, row, key, "ожидается непустой текст до 2000 символов");
    return v;
  };
  const number = (name: string, row: Row, key: string, min: number, max: number, nullable = false): number | null => {
    const v = row[key];
    if (nullable && (v === null || v === undefined)) return null;
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max) return error(name, row, key, `ожидается целое число от ${min} до ${max}`);
    return v;
  };
  const bool = (name: string, row: Row, key: string): boolean => {
    if (typeof row[key] !== "boolean") return error(name, row, key, "ожидается TRUE или FALSE");
    return row[key] as boolean;
  };
  const choice = <const T extends string>(name: string, row: Row, key: string, choices: readonly T[]): T => {
    if (!choices.includes(row[key] as T)) return error(name, row, key, "неизвестное значение");
    return row[key] as T;
  };
  const optional = (name: string, row: Row, key: string): string | null => row[key] == null ? null : text(name, row, key);
  const day = (name: string, row: Row, key: string): string | null => {
    const v = optional(name, row, key);
    if (v !== null && (!/^\d{4}-\d{2}-\d{2}$/u.test(v) || !Number.isFinite(Date.parse(`${v}T00:00:00Z`)) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v)) return error(name, row, key, "ожидается дата YYYY-MM-DD");
    return v;
  };
  const instant = (name: string, row: Row, key: string): string | null => {
    const v = optional(name, row, key);
    if (v !== null && (!v.endsWith("Z") || !Number.isFinite(Date.parse(v)))) return error(name, row, key, "ожидается дата и время UTC");
    return v;
  };
  const values = (name: string, row: Row) => ({ reps: number(name, row, "reps", 1, 999, true), loadGrams: number(name, row, "loadGrams", 0, 1000000, true), durationSec: number(name, row, "durationSec", 1, 86400, true), distanceM: number(name, row, "distanceM", 1, 1000000, true) });
  const children = (name: string, parent: string, key = "parent"): Row[] => {
    const result = all[name]!.filter((r) => r[key] === parent);
    const seen = consumed.get(name) ?? new Set<Row>(); result.forEach((r) => seen.add(r)); consumed.set(name, seen);
    return result.sort((a, b) => Number(a.position ?? a.index ?? 0) - Number(b.position ?? b.index ?? 0));
  };
  const unique = (name: string, rows: Row[], key: string) => {
    const ids = new Set<string>();
    for (const row of rows) { const id = text(name, row, key); if (ids.has(id)) error(name, row, key, "повтор идентификатора"); ids.add(id); }
  };
  for (const name of ["Программы", "Мезоциклы", "Недели", "Занятия", "Фактические подходы", "Справочник"]) unique(name, all[name]!, "id");
  unique("Тренировки", all["Тренировки"]!, "key"); unique("Упражнения плана", all["Упражнения плана"]!, "key");
  const m = all["Формат"]![0];
  if (!m || all["Формат"]!.length !== 1 || m.format !== "athlete-training" || m.version !== 1) throw new Error("Неподдерживаемая версия формата Excel.");
  const workouts = (programId: string, scope: string, parent: string): TransferWorkout[] => {
    const matches = all["Тренировки"]!.filter((r) => r.programId === programId && r.scope === scope && (r.parent ?? "") === parent);
    const seen = consumed.get("Тренировки") ?? new Set<Row>(); matches.forEach((r) => seen.add(r)); consumed.set("Тренировки", seen);
    return matches.sort((a, b) => Number(a.position) - Number(b.position)).map((w) => ({ id: text("Тренировки", w, "id"), title: text("Тренировки", w, "title"), ...(w.lineageId ? { lineageId: text("Тренировки", w, "lineageId") } : {}),
      exercises: children("Упражнения плана", text("Тренировки", w, "key")).map((e): TransferExercise => ({ id: text("Упражнения плана", e, "id"), exerciseId: text("Упражнения плана", e, "exerciseId"),
        ...(e.lineageId ? { lineageId: text("Упражнения плана", e, "lineageId") } : {}), ...(e.supersetId ? { supersetId: text("Упражнения плана", e, "supersetId") } : {}),
        restSec: number("Упражнения плана", e, "restSec", 1, 3600, true), instruction: optional("Упражнения плана", e, "instruction"),
        rir: e.rirMin == null ? null : { min: number("Упражнения плана", e, "rirMin", 0, 10)!, max: number("Упражнения плана", e, "rirMax", 0, 10, true) },
        sets: children("Плановые подходы", text("Упражнения плана", e, "key")).map((s): TransferSet => ({ id: text("Плановые подходы", s, "id"), ...values("Плановые подходы", s), repsMax: number("Плановые подходы", s, "repsMax", 1, 999, true) })) })) }));
  };
  const programs = all["Программы"]!.map((p): TransferProgram => {
    const id = text("Программы", p, "id"); const kind = choice("Программы", p, "kind", ["SIMPLE", "PERIODIZED"]);
    const weeks = kind === "SIMPLE" ? number("Программы", p, "weeks", 1, 52)! : 0;
    return { id, kind, title: text("Программы", p, "title"), archivedAt: instant("Программы", p, "archivedAt"), createdAt: instant("Программы", p, "createdAt") ?? error("Программы", p, "createdAt", "не задано время создания"),
      simple: kind === "SIMPLE" ? { weeks, workouts: workouts(id, "BASE", "") } : null,
      simpleWeeks: Array.from({ length: weeks }, (_, i) => ({ index: i + 1, workouts: workouts(id, "OVERRIDE", String(i + 1)) })).filter((w) => w.workouts.length > 0),
      mesocycles: children("Мезоциклы", id, "programId").map((c): TransferCycle => ({ id: text("Мезоциклы", c, "id"), lineageId: text("Мезоциклы", c, "lineageId"), title: text("Мезоциклы", c, "title"),
        cycleType: c.cycleType == null ? null : choice("Мезоциклы", c, "cycleType", ["hypertrophy", "strength", "power", "endurance", "recomp", "custom"]),
        repRange: c.repMin == null ? null : { min: number("Мезоциклы", c, "repMin", 0, 999)!, max: number("Мезоциклы", c, "repMax", 0, 999, true) }, startDate: day("Мезоциклы", c, "startDate"),
        weeks: children("Недели", text("Мезоциклы", c, "id")).map((w): TransferWeek => ({ id: text("Недели", w, "id"), index: number("Недели", w, "index", 1, 52)!, type: choice("Недели", w, "type", ["base", "light", "medium", "heavy", "deload"]), workouts: workouts(id, "WEEK", text("Недели", w, "id")) })) })) };
  });
  const sessions = all["Занятия"]!.map((s): TransferSession => ({ id: text("Занятия", s, "id"), programId: text("Занятия", s, "programId"), plannedWorkoutId: text("Занятия", s, "plannedWorkoutId"), weekIndex: number("Занятия", s, "weekIndex", 1, 52)!,
    outcome: s.outcome == null ? null : choice("Занятия", s, "outcome", ["COMPLETED", "MISSED", "CANCELLED"]), actualDate: day("Занятия", s, "actualDate"), startedAt: instant("Занятия", s, "startedAt"), finishedAt: instant("Занятия", s, "finishedAt"),
    origin: s.origin == null ? null : parseOrigin(String(s.origin)),
    notes: children("Заметки", text("Занятия", s, "id")).map((n) => ({ plannedExerciseId: text("Заметки", n, "plannedExerciseId"), text: text("Заметки", n, "text") })),
    facts: children("Фактические подходы", text("Занятия", s, "id")).map((f): TransferFact => {
      const name = "Фактические подходы";
      const complex = parseFactDetails(String(f.drops ?? "[]"), f.sides == null ? null : String(f.sides));
      return { id: text(name, f, "id"), plannedSetId: text(name, f, "plannedSetId"), plannedExerciseId: text(name, f, "plannedExerciseId"), exerciseId: text(name, f, "exerciseId"), position: number(name, f, "position", 0, 999)!,
        setType: choice(name, f, "setType", ["NORMAL", "WARMUP", "FAILURE", "DROP"]), values: values(name, f), ...complex, rpe: number(name, f, "rpe", 1, 10, true),
        confirmed: bool(name, f, "confirmed"), extra: bool(name, f, "extra"), origin: choice(name, f, "origin", ["INPUT", "COPY", "IMPORT"]), revision: number(name, f, "revision", 1, 2147483647)! };
    }) }));
  for (const name of sheets.filter((n) => !["Программы", "Занятия", "Справочник"].includes(n))) {
    if (all[name]!.some((r) => !consumed.get(name)?.has(r))) throw new WorkbookError(name, 2, "parent", "строка ссылается на отсутствующую структуру");
  }
  let result: TrainingTransfer = { format: "athlete-training", version: 1, sourceId: text("Формат", m, "sourceId"), client: { id: text("Формат", m, "clientId"), name: text("Формат", m, "clientName") }, programs, sessions,
    exercises: all["Справочник"]!.map((e) => ({ id: text("Справочник", e, "id"), name: text("Справочник", e, "name") })) };
  if (book.Sheets["Версии плана"]) {
    const chunks = XLSX.utils.sheet_to_json<{ id: string; part: number; json: string }>(book.Sheets["Версии плана"]!);
    const groups = new Map<string, string[]>();
    for (const row of chunks) { const parts = groups.get(row.id) ?? []; if (typeof row.id !== "string" || row.part !== parts.length || typeof row.json !== "string" || row.json.length > 16000) throw new Error("Повреждена история структуры программы."); parts.push(row.json); groups.set(row.id, parts); }
    const history = [...groups].map(([id, parts]) => {
      const h = JSON.parse(parts.join("")) as import("../../../shared/training-transfer/TrainingTransfer.ts").TransferPlanHistory;
      if (!h || h.id !== id || !programs.some((p) => p.id === h.programId) || !Number.isFinite(Date.parse(h.validFrom)) || !Number.isFinite(Date.parse(h.validTo)) || h.validFrom > h.validTo || (!!h.simple === !!h.mesocycle)) throw new Error("Некорректная версия структуры программы.");
      const parent = programs.find((p) => p.id === h.programId)!;
      const probe: TrainingTransfer = { ...result, programs: [{ ...parent, title: h.simple?.title ?? parent.title, kind: h.simple ? "SIMPLE" : "PERIODIZED", simple: h.simple ? { weeks: h.simple.weeks.length, workouts: [] } : null, simpleWeeks: h.simple?.weeks ?? [], mesocycles: h.mesocycle ? [h.mesocycle] : [] }], sessions: [] };
      // Reuse the full structural validator without history recursion.
      readTrainingWorkbook(readWorkbook(writeTrainingWorkbook(probe)));
      return h;
    });
    result = { ...result, planHistory: history };
  }
  const issueInput = readTransferIssues(book);
  if (m.issueCount != null && m.issueCount !== issueInput.issues.length) throw new Error("Список значений для проверки изменён или отсутствует. Повторите экспорт.");
  if (issueInput.issues.length) result = { ...result, issues: issueInput.issues };
  const withEdits = applyIssueCorrections(applyMatrixEdits(book, result), result, issueInput.corrections);
  assertValidTransfer(withEdits);
  return withEdits;
}

function parseOrigin(json: string): TransferSession["origin"] {
  const v: unknown = JSON.parse(json);
  if (!v || typeof v !== "object" || !("programTitle" in v) || typeof v.programTitle !== "string" || !("programKind" in v) || !["SIMPLE", "PERIODIZED"].includes(String(v.programKind)) || !("mesocycleTitle" in v) || !("workoutTitle" in v) || ![v.mesocycleTitle, v.workoutTitle].every((x) => x === null || typeof x === "string")) throw new Error("Некорректное описание архивной тренировки.");
  return v as NonNullable<TransferSession["origin"]>;
}
function parseFactDetails(dropsJson: string, sidesJson: string | null): Pick<TransferFact, "drops" | "sides"> {
  const drops: unknown = JSON.parse(dropsJson); const sides: unknown = sidesJson === null ? null : JSON.parse(sidesJson);
  const values = (v: unknown): boolean => !!v && typeof v === "object" && ["reps", "loadGrams", "durationSec", "distanceM"].every((key) => { const n = (v as Record<string, unknown>)[key]; return n === null || typeof n === "number" && Number.isSafeInteger(n) && n >= (key === "loadGrams" ? 0 : 1) && n <= ({ reps: 999, loadGrams: 1000000, durationSec: 86400, distanceM: 1000000 }[key] ?? 0); });
  const side = (v: unknown): boolean => !!v && typeof v === "object" && "values" in v && values(v.values) && "confirmed" in v && typeof v.confirmed === "boolean";
  if (!Array.isArray(drops) || drops.length > 9 || !drops.every(values) || sides !== null && !(typeof sides === "object" && "left" in sides && "right" in sides && side(sides.left) && side(sides.right))) throw new Error("Некорректные мини-сеты или стороны подхода.");
  return { drops, sides } as Pick<TransferFact, "drops" | "sides">;
}
