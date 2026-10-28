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
/** `id` стабилен при переносах и правках названия: номер строки текста, у копии — `<id>+<n>`; `planSets` — плановая копия без фактов. */
export interface LogExercise { readonly id: string; readonly name: string; readonly note: string | null; readonly sets: readonly LogSet[]; readonly line: number; readonly planSets?: number }
/** `week` — неделя цикла (с нуля); тренировка внутри недели — по порядку среди тренировок той же недели («слот»). */
export interface LogWorkout { readonly title: string; readonly date: string | null; readonly week: number; readonly exercises: readonly LogExercise[]; readonly line: number }
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
  type Exercise = { id: string; name: string; note: string | null; sets: LogSet[]; line: number };
  type Workout = { title: string; date: string | null; week: number; exercises: Exercise[]; line: number };
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
      workout = { title: titleOf(date ? body.replace(date.match, " ") : body), date: date?.iso ?? null, week: 0, exercises: [], line };
      workouts.push(workout); exercise = null; continue;
    }
    if (/^\d/u.test(body) || !/\p{L}/u.test(body)) { unknownLines.push({ line, text: source }); continue; }
    if (!workout) { workout = { title: "Тренировка 1", date: null, week: 0, exercises: [], line }; workouts.push(workout); }
    exercise = { id: String(line), name: body, note, sets: [], line }; workout.exercises.push(exercise);
  }
  // Недели по хронологии: если даты есть у всех тренировок — по дате (календарные недели с понедельника, пустые не создаются);
  // тренировка без даты остаётся в текущей неделе, без дат вообще всё лежит в неделе 1.
  const ordered = workouts.length && workouts.every((w) => w.date) ? [...workouts].sort((a, b) => a.date!.localeCompare(b.date!)) : workouts;
  let week = -1; let key: string | null = null;
  for (const item of ordered) {
    const start = item.date ? monday(item.date) : null;
    if (start !== null && start !== key) { week = key === null ? Math.max(week, 0) : week + 1; key = start; } else if (week < 0) week = 0;
    item.week = week;
  }
  return { workouts: ordered, unknownLines };
}

const WEEKS_MAX = 100;
const SLOTS_MAX = 20;
/** Номер тренировки внутри её недели: порядок среди тренировок той же недели. */
const slotOf = (workouts: readonly LogWorkout[], index: number) => workouts.slice(0, index).filter((w) => w.week === workouts[index]!.week).length;
/** Индекс тренировки (неделя, слот); недостающие пустые «Тренировка N» этой недели добавляются в конец. */
function sessionAt(workouts: LogWorkout[], week: number, slot: number, line: number): number {
  let last = -1; let found = -1;
  for (const [i, w] of workouts.entries()) if (w.week === week && ++last === slot) found = i;
  if (found >= 0) return found;
  while (last < slot) { last += 1; workouts.push({ title: `Тренировка ${last + 1}`, date: null, week, exercises: [], line }); }
  return workouts.length - 1;
}
const findExercise = (log: WorkoutLog, id: string) => {
  for (const [workout, item] of log.workouts.entries()) {
    const exercise = item.exercises.findIndex((e) => e.id === id);
    if (exercise >= 0) return { workout, exercise, item: item.exercises[exercise]! };
  }
  return null;
};
/** Попадает ли упражнение в импорт: есть подходы из текста или это плановая копия. */
const included = (exercise: LogExercise) => exercise.sets.length > 0 || (exercise.planSets ?? 0) > 0;

/**
 * Шаг «Распределение»: упражнение `id` в неделю `week` и/или в тренировку `slot` внутри недели (что не задано — остаётся).
 * Недостающие неделя и тренировка создаются пустыми (в импорт пустые не попадают). Дата и название принадлежат тренировке
 * и не меняются вместе с упражнением: оно получает данные тренировки-приёмника.
 */
export function assignLogExercise(log: WorkoutLog, id: string, target: Readonly<{ week?: number; slot?: number }>): WorkoutLog {
  const at = findExercise(log, id); if (!at) return log;
  const from = log.workouts[at.workout]!; const fromSlot = slotOf(log.workouts, at.workout);
  const week = target.week ?? from.week; const slot = target.slot ?? fromSlot;
  if ((week === from.week && slot === fromSlot) || week < 0 || week >= WEEKS_MAX || slot < 0 || slot >= SLOTS_MAX) return log;
  const workouts = [...log.workouts]; const to = sessionAt(workouts, week, slot, at.item.line);
  workouts[at.workout] = { ...workouts[at.workout]!, exercises: workouts[at.workout]!.exercises.filter((e) => e.id !== id) };
  workouts[to] = { ...workouts[to]!, exercises: [...workouts[to]!.exercises, at.item] };
  return { ...log, workouts };
}

/** Копия упражнения без фактов — плановая строка (`planSets` подходов); сразу уходит в следующую тренировку той же недели, номер меняется пикером. */
export function duplicateLogExercise(log: WorkoutLog, id: string): Readonly<{ log: WorkoutLog; id: string }> | null {
  const at = findExercise(log, id); if (!at) return null;
  const base = id.split("+")[0]!; const taken = new Set(log.workouts.flatMap((w) => w.exercises.map((e) => e.id)));
  let n = 1; while (taken.has(`${base}+${n}`)) n += 1;
  const copy: LogExercise = { id: `${base}+${n}`, name: at.item.name, note: null, sets: [], line: at.item.line, planSets: Math.max(1, at.item.sets.length || at.item.planSets || 1) };
  const workouts = log.workouts.map((w, i) => i === at.workout ? { ...w, exercises: [...w.exercises, copy] } : w);
  return { log: assignLogExercise({ ...log, workouts }, copy.id, { slot: slotOf(log.workouts, at.workout) + 1 }), id: copy.id };
}

/**
 * Переносит подходы (вес, повторы, заметки) в упражнение без фактов. Источник выбирает `copySetsSource` (то же название);
 * здесь только защита: факты существующих подходов не затираются.
 */
export function copyLogSets(log: WorkoutLog, toId: string, fromId: string): WorkoutLog {
  const to = findExercise(log, toId); const from = findExercise(log, fromId);
  if (!to || !from || toId === fromId || to.item.sets.length || !from.item.sets.length) return log;
  const { id, name, note, line } = to.item;
  return { ...log, workouts: log.workouts.map((w, i) => i === to.workout ? { ...w, exercises: w.exercises.map((e) => e.id === toId ? { id, name, note, line, sets: from.item.sets } : e) } : w) };
}

/** Убирает ненужное упражнение (копию или запись из текста) из черновика импорта; сам текст заметки не меняется. */
export function removeLogExercise(log: WorkoutLog, id: string): WorkoutLog {
  if (!findExercise(log, id)) return log;
  return { ...log, workouts: log.workouts.map((w) => ({ ...w, exercises: w.exercises.filter((e) => e.id !== id) })) };
}

/**
 * Единый список упражнений в порядке текста (копия — сразу после исходного) с неделей и номером тренировки в неделе. Порядок
 * не зависит от распределения: перенос не двигает карточку.
 */
export function logExercises(log: WorkoutLog): readonly Readonly<{ exercise: LogExercise; week: number; slot: number }>[] {
  const key = (id: string) => { const [base = "0", copy = "0"] = id.split("+"); return [Number(base), Number(copy)] as const; };
  return log.workouts.flatMap((w, i) => { const slot = slotOf(log.workouts, i); return w.exercises.map((exercise) => ({ exercise, week: w.week, slot })); })
    .sort((a, b) => { const [x, y] = [key(a.exercise.id), key(b.exercise.id)]; return x[0] - y[0] || x[1] - y[1]; });
}

/**
 * Откуда копировать подходы в упражнение без фактов: исходное упражнение копии, иначе ближайшее по тексту предыдущее с тем же названием.
 */
export function copySetsSource(log: WorkoutLog, id: string): LogExercise | null {
  const list = logExercises(log).map((item) => item.exercise); const at = list.findIndex((e) => e.id === id);
  if (at < 0 || list[at]!.sets.length) return null;
  const key = logNameKey(list[at]!.name); const same = list.filter((e) => e.id !== id && e.sets.length && logNameKey(e.name) === key);
  const before = same.filter((e) => list.indexOf(e) < at);
  return same.find((e) => e.id === id.split("+")[0]) ?? before[before.length - 1] ?? same[0] ?? null;
}

/** Что попадёт в импорт: недели, тренировки, упражнения и подходы (у плановой копии — плановые). Пустые тренировки и недели не считаются. */
export function logStats(log: WorkoutLog): Readonly<{ weeks: number; workouts: number; exercises: number; sets: number }> {
  let workouts = 0; let exercises = 0; let sets = 0; const weeks = new Set<number>();
  for (const workout of log.workouts) {
    const items = workout.exercises.filter(included); if (!items.length) continue;
    workouts += 1; weeks.add(workout.week); exercises += items.length; sets += items.reduce((n, e) => n + (e.sets.length || e.planSets!), 0);
  }
  return { weeks: weeks.size, workouts, exercises, sets };
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
 * Лист на каждые 52 недели с занятиями. Неделя — `workout.week` (хронология по датам задаётся разбором, дальше её правит тренер),
 * пустые недели не создаются; внутри недели тренировки идут по порядку. Повтор названия в неделе получает номер («Фуллбоди 2»).
 * План повторений — по типу цикла.
 */
export function workoutLogTables(log: WorkoutLog, options: Readonly<{ name: string; reps: RepRange; cycleType?: CycleType }>): readonly ImportTable[] {
  // Тренировка без подходов и плановых копий (опустевшая при распределении) не создаёт неделю.
  const ordered = log.workouts.filter((w) => w.exercises.some(included)).sort((a, b) => a.week - b.week);
  const canonical = new Map<string, string>();
  const planReps = options.reps === null ? "" : options.reps.max === null ? String(options.reps.min) : `${options.reps.min}-${options.reps.max}`;
  const sheets: { rows: unknown[][]; cellOrigins: (ImportCellOrigin | null)[][] }[] = [];
  let week = 0; let weekKey: number | null = null; const titles = new Map<string, number>();
  for (const workout of ordered) {
    if (workout.week !== weekKey) { week += 1; weekKey = workout.week; titles.clear(); }
    const count = (titles.get(workout.title) ?? 0) + 1; titles.set(workout.title, count);
    const title = count === 1 ? workout.title : `${workout.title} ${count}`;
    const sheet = sheets[Math.floor((week - 1) / WEEKS_PER_SHEET)] ??= { rows: [COLUMNS.map((field) => legacyFields[field])], cellOrigins: [[]] };
    for (const exercise of workout.exercises) {
      if (!included(exercise)) continue;
      const name = canonical.get(logNameKey(exercise.name)) ?? exercise.name; canonical.set(logNameKey(exercise.name), name);
      if (!exercise.sets.length) {
        // Плановая копия: строка без фактов, число подходов — в «Подходах».
        sheet.rows.push([String((week - 1) % WEEKS_PER_SHEET + 1), title, name, exercise.planSets, planReps, "", "", "", "", "", workout.date ?? ""]);
        const at = (row: number): ImportCellOrigin => ({ row, column: 1 });
        sheet.cellOrigins.push([null, at(workout.line), at(exercise.line), null, null, null, null, null, null, null, at(workout.line)]);
        continue;
      }
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
