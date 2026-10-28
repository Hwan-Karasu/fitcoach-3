import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { ImportCellOrigin, ImportTable, PickedWorkbook } from "./WorkbookFilesPort.ts";
import { legacyFields } from "./LegacyExcel.ts";
import { spreadsheetDay } from "../../../shared/training-transfer/SpreadsheetDay.ts";
import type { TransferCycle } from "../../../shared/training-transfer/TrainingTransfer.ts";

/**
 * Импорт тренировок из текста заметок (TEXT-LOG-1). Строка с датой (или «Тренировка…»/«День…») — тренировка,
 * «вес на повторы» — подход, прочая строка с буквами — упражнение. Результат — плоская таблица `legacyFields`:
 * дальше работают обычные проверка, сверка упражнений и запись Excel-импорта.
 */
export interface LogSet { readonly loadKg: number | null; readonly reps: number; readonly note: string | null; readonly line: number }
export interface LogExercise { readonly name: string; readonly note: string | null; readonly sets: readonly LogSet[]; readonly line: number }
export interface LogWorkout { readonly title: string; readonly date: string | null; readonly exercises: readonly LogExercise[]; readonly line: number }
export interface WorkoutLog {
  readonly workouts: readonly LogWorkout[];
  readonly unknownLines: readonly Readonly<{ line: number; text: string }>[];
}
type RepRange = Readonly<{ min: number; max: number | null }> | null;
type CycleType = NonNullable<TransferCycle["cycleType"]>;

const HEADER = /^(?:тренировка|день|workout|day)(?![\p{L}])/iu;
// С годом — «26.07.2026», «28.09.26», «1/8/2026»; без года — только «26.07» (двузначный месяц через точку): «Гантели 7.5»,
// «Присед 1/2» остаются названиями.
const DATE = /(?<![\d.,/])(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})(?![\d.,/])|(?<![\d.,/])(\d{1,2})\.(\d{2})(?![\d.,/])/u;
// «22 на 15», «27,5 x 14», «31 на 20 x 2» (два подхода), «5 кг на 20 раз»; одно число — только повторы.
const SET = /^(\d{1,4}(?:\.\d{1,3})?)\s*(?:на|x|х|×|\*)\s*(\d{1,3})(?:\s*(?:x|х|×|\*)\s*(\d{1,2}))?$/u;
const REPS = /^(\d{1,3})$/u;

function parseSets(body: string): readonly Readonly<{ loadKg: number | null; reps: number }>[] | null {
  const text = body.toLowerCase().replace(/,/gu, ".").replace(/(\d)\s*(?:кг|kg)(?![\p{L}])\.?/gu, "$1")
    .replace(/\s+(?:раз|повт(?:орений|\.)?|reps)\.?$/u, "").replace(/\s+/gu, " ").trim();
  const set = SET.exec(text); const only = set ? null : REPS.exec(text);
  if (!set && !only) return null;
  const loadKg = set ? Number(set[1]) : null; const reps = Number(set ? set[2] : only![1]); const count = set?.[3] ? Number(set[3]) : 1;
  if (reps < 1 || count < 1 || (loadKg !== null && loadKg > 1000)) return null;
  return Array.from({ length: count }, () => ({ loadKg, reps }));
}

function findDate(body: string, today: string): Readonly<{ iso: string; match: string }> | null {
  const found = DATE.exec(body); if (!found) return null;
  const [match] = found; const rawYear = found[3];
  const day = found[1] ?? found[4]; const month = found[2] ?? found[5];
  const pad = (v: string) => v.padStart(2, "0");
  if (rawYear) {
    const iso = spreadsheetDay(`${rawYear.length === 2 ? `20${rawYear}` : rawYear}-${pad(month!)}-${pad(day!)}`);
    return iso ? { iso, match } : null;
  }
  // Без года — ближайшая прошедшая дата: заметки пишутся по факту.
  const year = Number(today.slice(0, 4)); const candidate = spreadsheetDay(`${year}-${pad(month!)}-${pad(day!)}`);
  const iso = candidate && candidate > today ? spreadsheetDay(`${year - 1}-${pad(month!)}-${pad(day!)}`) : candidate;
  return iso ? { iso, match } : null;
}

const titleOf = (text: string) => {
  const title = text.replace(/^[\s\-–—,:.]+|[\s\-–—,:.]+$/gu, "").replace(/\s+/gu, " ");
  return title ? title.charAt(0).toUpperCase() + title.slice(1) : "Тренировка";
};

export function parseWorkoutLog(text: string, today: string): WorkoutLog {
  type Exercise = { name: string; note: string | null; sets: LogSet[]; line: number };
  type Workout = { title: string; date: string | null; exercises: Exercise[]; line: number };
  const workouts: Workout[] = []; const unknownLines: { line: number; text: string }[] = [];
  let workout: Workout | null = null; let exercise: Exercise | null = null;
  for (const [index, raw] of text.split(/\r?\n/u).entries()) {
    const line = index + 1; const source = raw.trim(); if (!source) continue;
    const note = /\(([^)]*)\)/u.exec(source)?.[1]?.trim() || null;
    const body = source.replace(/\([^)]*\)/gu, " ").replace(/\s+/gu, " ").trim();
    const sets = parseSets(body);
    if (sets) {
      if (exercise) exercise.sets.push(...sets.map((set, i) => ({ ...set, note: i === 0 ? note : null, line })));
      else unknownLines.push({ line, text: source });
      continue;
    }
    const date = findDate(body, today);
    if (date || HEADER.test(body)) {
      workout = { title: titleOf(date ? body.replace(date.match, " ") : body), date: date?.iso ?? null, exercises: [], line };
      workouts.push(workout); exercise = null; continue;
    }
    if (/^\d/u.test(body) || !/\p{L}/u.test(body)) { unknownLines.push({ line, text: source }); continue; }
    if (!workout) { workout = { title: "Тренировка 1", date: null, exercises: [], line }; workouts.push(workout); }
    exercise = { name: body, note, sets: [], line }; workout.exercises.push(exercise);
  }
  return { workouts, unknownLines };
}

/** Шаг «Распределение» (TEXT-LOG-2): упражнение в тренировку `target`; `target` = число тренировок — новая «Тренировка N+1». */
export function moveLogExercise(log: WorkoutLog, workout: number, exercise: number, target: number): WorkoutLog {
  const item = log.workouts[workout]?.exercises[exercise];
  if (!item || target === workout || target < 0 || target > log.workouts.length) return log;
  const workouts = target === log.workouts.length
    ? [...log.workouts, { title: `Тренировка ${target + 1}`, date: null, exercises: [], line: item.line }] : [...log.workouts];
  workouts[workout] = { ...workouts[workout]!, exercises: workouts[workout]!.exercises.filter((_, i) => i !== exercise) };
  workouts[target] = { ...workouts[target]!, exercises: [...workouts[target]!.exercises, item] };
  return { ...log, workouts };
}

export function editLogWorkout(log: WorkoutLog, index: number, patch: Readonly<{ title?: string; date?: string | null }>): WorkoutLog {
  return { ...log, workouts: log.workouts.map((w, i) => i === index ? { ...w, ...patch } : w) };
}

/** Пара [оставить, заменить]: названия второго (с точностью до регистра и знаков) получают название первого. */
export function mergeLogNames(log: WorkoutLog, pairs: readonly (readonly [string, string])[]): WorkoutLog {
  const rename = new Map(pairs.map(([keep, replace]) => [logNameKey(replace), keep]));
  return { ...log, workouts: log.workouts.map((w) => ({ ...w, exercises: w.exercises.map((e) => {
    const name = rename.get(logNameKey(e.name)); return name === undefined ? e : { ...e, name };
  }) })) };
}

/** Одно упражнение с точностью до регистра, «ё», пробелов и знаков. */
export const logNameKey = (name: string) => name.toLowerCase().replace(/ё/gu, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length]!;
}

/** Пары похожих названий для предложения «объединить» (опечатка, окончание, порядок слов); сами не сливаются. */
export function similarLogNames(log: WorkoutLog): readonly (readonly [string, string])[] {
  const names = new Map<string, string>();
  for (const workout of log.workouts) for (const exercise of workout.exercises) if (!names.has(logNameKey(exercise.name))) names.set(logNameKey(exercise.name), exercise.name);
  const keys = [...names.keys()]; const sorted = (key: string) => key.split(" ").sort().join(" ");
  const result: (readonly [string, string])[] = [];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = keys[i]!; const b = keys[j]!;
    if (Math.min(a.length, b.length) < 6) continue;
    if (Math.min(distance(a, b), distance(sorted(a), sorted(b))) <= 2) result.push([names.get(a)!, names.get(b)!]);
  }
  return result;
}

const monday = (iso: string) => { const day = new Date(`${iso}T00:00:00Z`); return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10); };
const COLUMNS = ["week", "workout", "exercise", "sets", "reps", "load", "actualReps", "actualLoad", "rir", "note", "date"] as const;
const WEEKS_PER_SHEET = 52;

/**
 * Лист на каждые 52 недели с занятиями. Неделя — календарная (с понедельника), пустые недели не создаются; если даты есть у всех
 * тренировок, они упорядочиваются по дате. Повтор названия в неделе получает номер («Фуллбоди 2»). План повторений — по типу цикла.
 */
export function workoutLogTables(log: WorkoutLog, options: Readonly<{ name: string; reps: RepRange; cycleType?: CycleType }>): readonly ImportTable[] {
  // Тренировка без подходов (опустевшая при распределении) не создаёт неделю.
  const present = log.workouts.filter((w) => w.exercises.some((e) => e.sets.length));
  const dated = present.length > 0 && present.every((w) => w.date !== null);
  const ordered = dated ? [...present].sort((a, b) => a.date!.localeCompare(b.date!)) : present;
  const canonical = new Map<string, string>();
  const planReps = options.reps === null ? "" : options.reps.max === null ? String(options.reps.min) : `${options.reps.min}-${options.reps.max}`;
  const sheets: { rows: unknown[][]; cellOrigins: (ImportCellOrigin | null)[][] }[] = [];
  let week = 0; let weekKey: string | null = null; const titles = new Map<string, number>();
  for (const workout of ordered) {
    const key: string = workout.date ? monday(workout.date) : weekKey ?? "undated";
    if (key !== weekKey) { week += 1; weekKey = key; titles.clear(); }
    const count = (titles.get(workout.title) ?? 0) + 1; titles.set(workout.title, count);
    const title = count === 1 ? workout.title : `${workout.title} ${count}`;
    const sheet = sheets[Math.floor((week - 1) / WEEKS_PER_SHEET)] ??= { rows: [COLUMNS.map((field) => legacyFields[field])], cellOrigins: [[]] };
    for (const exercise of workout.exercises) {
      const name = canonical.get(logNameKey(exercise.name)) ?? exercise.name; canonical.set(logNameKey(exercise.name), name);
      const note = [exercise.note, ...exercise.sets.map((set, i) => set.note ? `Подход ${i + 1}: ${set.note}` : null)].filter(Boolean).join("; ");
      exercise.sets.forEach((set, i) => {
        sheet.rows.push([String((week - 1) % WEEKS_PER_SHEET + 1), title, name, 1, planReps, "", String(set.reps), set.loadKg === null ? "" : String(set.loadKg), "", i === 0 ? note : "", workout.date ?? ""]);
        const at = (row: number): ImportCellOrigin => ({ row, column: 1 });
        sheet.cellOrigins.push([null, at(workout.line), at(exercise.line), null, null, null, at(set.line), at(set.line), null, null, at(workout.line)]);
      });
    }
  }
  return sheets.map((sheet, i) => ({ name: i === 0 ? options.name : `${options.name} ${i + 1}`, ...sheet, source: "text" as const,
    ...(options.cycleType ? { cycle: { cycleType: options.cycleType, repRange: options.reps } } : {}) }));
}

/**
 * Заметки как книга из листов: дальше обычная сверка Excel-импорта. ID источника — хеш итоговых листов (текст после распределения,
 * объединения названий и с типом цикла): иная раскладка того же текста — иной источник, а не «Конфликт цикла» в черновике.
 */
export function workoutLogWorkbook(log: WorkoutLog, options: Parameters<typeof workoutLogTables>[1]): PickedWorkbook {
  const tables = workoutLogTables(log, options);
  if (!tables.length) throw new Error("В тексте нет подходов: проверьте строки вида «22 на 15».");
  const identity = JSON.stringify(tables.map((t) => [t.name, t.rows, t.cycle ?? null]));
  return { kind: "TABLES", filename: options.name, sourceId: `text:${bytesToHex(sha256(utf8ToBytes(identity)))}`, tables };
}
