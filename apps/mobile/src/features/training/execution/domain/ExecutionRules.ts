import { isLocalDate } from "../../../../shared/domain/LocalDate.ts";
import { DROPS_MAX, EMPTY_VALUES, type ConfirmationMode, type PreviousSet, type SetType, type SetValues, type TrackingMetric,
  type WeekStatus, type WorkoutOutcome, type WorkoutStatus } from "./ExecutionModel.ts";

/** Поле факта подхода, которое заполняет величина профиля (§33.2). */
export type SetField = keyof SetValues;

export function fieldsOf(metrics: readonly TrackingMetric[]): readonly SetField[] {
  return metrics.map((metric): SetField => metric === "reps" ? "reps" : metric === "duration" ? "durationSec"
    : metric === "distance" ? "distanceM" : "loadGrams");
}

export const VALUE_LIMITS: Readonly<Record<SetField, Readonly<{ min: number; max: number }>>> = {
  reps: { min: 1, max: 999 },
  loadGrams: { min: 0, max: 1_000_000 },
  durationSec: { min: 1, max: 86_400 },
  distanceM: { min: 1, max: 1_000_000 },
};

const ALL_FIELDS = Object.keys(VALUE_LIMITS) as readonly SetField[];

/** Значение ячейки в допустимых пределах поля (ноль килограммов допустим, ноль повторов — нет). */
export function inLimits(field: SetField, value: number): boolean {
  const { min, max } = VALUE_LIMITS[field];
  return Number.isInteger(value) && value >= min && value <= max;
}

/** Подсказка под невалидной ячейкой. */
export function limitHint(field: SetField): string {
  const { min, max } = VALUE_LIMITS[field];
  return field === "loadGrams" ? `Вес от ${min / 1000} до ${max / 1000} кг`
    : field === "durationSec" ? "Время от 1 секунды до 24 часов" : `От ${min} до ${max}`;
}

/** Содержимое подхода, от которого зависит подтверждение: тип, основной сет и мини-сеты дроп-сета. */
export interface SetContent {
  readonly setType: SetType;
  readonly values: SetValues;
  readonly drops: readonly SetValues[];
}

function validateOne(values: SetValues, allowed: ReadonlySet<SetField>): void {
  for (const field of ALL_FIELDS) {
    const value = values[field];
    if (value === null) continue;
    const limit = VALUE_LIMITS[field];
    if (!allowed.has(field) || !Number.isInteger(value) || value < limit.min || value > limit.max) {
      throw new Error("INVALID_METRIC");
    }
  }
}

/**
 * Значения по профилю: лишних полей нет, числа целые и в пределах; RPE — 1–10 или пусто (§48.65 п. 6).
 * Мини-сеты есть только у дроп-сета, их от 1 до DROPS_MAX.
 */
export function validateContent(content: SetContent, rpe: number | null, metrics: readonly TrackingMetric[]): void {
  const allowed = new Set(fieldsOf(metrics));
  validateOne(content.values, allowed);
  if (content.setType === "DROP" ? content.drops.length < 1 || content.drops.length > DROPS_MAX : content.drops.length > 0) {
    throw new Error("INVALID_METRIC");
  }
  for (const drop of content.drops) validateOne(drop, allowed);
  if (rpe !== null && (!Number.isInteger(rpe) || rpe < 1 || rpe > 10)) throw new Error("INVALID_METRIC");
}

/** §48.52: все обязательные величины профиля заполнены; `0 кг` — заполнено, RPE не обязателен. */
export function isComplete(values: SetValues, metrics: readonly TrackingMetric[]): boolean {
  return metrics.length > 0 && fieldsOf(metrics).every((field) => values[field] !== null);
}

/** §48.60 п. 2: дроп-сет полон, когда заполнены основной сет и все его мини-сеты. */
export function isSetComplete(content: SetContent, metrics: readonly TrackingMetric[]): boolean {
  return isComplete(content.values, metrics) && (content.setType !== "DROP"
    || (content.drops.length > 0 && content.drops.every((drop) => isComplete(drop, metrics))));
}

export interface ConfirmationChange {
  readonly confirmed: boolean;
  /** Новый переход «не выполнен → выполнен»: от него запускается таймер отдыха (§48.55). */
  readonly confirmedNow: boolean;
}

/**
 * Подтверждение после сохранения значений — ввод или нажатие «Пред.» (§48.48, §48.55, §48.69).
 * Автоматический режим: полный подход выполнен; очистка обязательного поля снимает подтверждение.
 * Ручной: значения не подтверждают, но неполный подход подтверждённым не остаётся.
 */
export function confirmationAfterSave(mode: ConfirmationMode, wasConfirmed: boolean, content: SetContent,
  metrics: readonly TrackingMetric[]): ConfirmationChange {
  if (!isSetComplete(content, metrics)) return { confirmed: false, confirmedNow: false };
  if (mode === "AUTO") return { confirmed: true, confirmedNow: !wasConfirmed };
  return { confirmed: wasConfirmed, confirmedNow: false };
}

/** Галочка ручного режима — обратимая (§48.55 п. 2); подтвердить неполный подход нельзя (§48.52 п. 4). */
export function toggleConfirmation(wasConfirmed: boolean, content: SetContent,
  metrics: readonly TrackingMetric[]): ConfirmationChange {
  if (wasConfirmed) return { confirmed: false, confirmedNow: false };
  if (!isSetComplete(content, metrics)) throw new Error("INVALID_METRIC");
  return { confirmed: true, confirmedNow: true };
}

export interface SidesChange {
  readonly left: ConfirmationChange;
  readonly right: ConfirmationChange;
}

type SideFlags = Readonly<{ left: boolean; right: boolean }>;
type SideValuesPair = Readonly<{ left: SetValues; right: SetValues }>;

const plain = (values: SetValues): SetContent => ({ setType: "NORMAL", values, drops: [] });

/**
 * §48.76, §48.80: стороны одностороннего подхода засчитываются отдельно по тем же правилам, что и подход;
 * новый переход любой стороны — повод для таймера (§48.80 п. 6).
 */
export function sidesAfterSave(mode: ConfirmationMode, was: SideFlags, sides: SideValuesPair,
  metrics: readonly TrackingMetric[]): SidesChange {
  return { left: confirmationAfterSave(mode, was.left, plain(sides.left), metrics),
    right: confirmationAfterSave(mode, was.right, plain(sides.right), metrics) };
}

/** Галочка ручного режима у одной стороны; другая не меняется. */
export function toggleSide(was: SideFlags, sides: SideValuesPair, side: "L" | "R",
  metrics: readonly TrackingMetric[]): SidesChange {
  const keep = (confirmed: boolean): ConfirmationChange => ({ confirmed, confirmedNow: false });
  return side === "L"
    ? { left: toggleConfirmation(was.left, plain(sides.left), metrics), right: keep(was.right) }
    : { left: keep(was.left), right: toggleConfirmation(was.right, plain(sides.right), metrics) };
}

/** Односторонний подход: значения только в сторонах; дроп-сет со сторонами — отдельный срез. */
export function validateSides(content: SetContent, sides: SideValuesPair, rpe: number | null,
  metrics: readonly TrackingMetric[]): void {
  if (content.setType === "DROP" || content.drops.length > 0 || hasEnteredData([{ values: content.values, confirmed: false }])) {
    throw new Error("INVALID_METRIC");
  }
  validateContent(plain(sides.left), rpe, metrics);
  validateContent(plain(sides.right), null, metrics);
}

/**
 * §48.61: у выполненного дроп-сета нельзя добавить, убрать или сменить на другой тип мини-сеты —
 * сначала снять выполнение. Числа в существующих мини-сетах исправлять можно.
 */
export function assertDropStructure(was: Readonly<{ confirmed: boolean; setType: SetType; dropCount: number }>,
  next: SetContent): void {
  if (!was.confirmed || was.setType !== "DROP") return;
  if (next.setType !== "DROP" || next.drops.length !== was.dropCount) throw new Error("DROP_STRUCTURE_LOCKED");
}

/** Мини-сеты при смене типа: дроп получает хотя бы один пустой мини-сет, остальные типы — ни одного. */
export function dropsForType(setType: SetType, current: readonly SetValues[]): readonly SetValues[] {
  if (setType !== "DROP") return [];
  return current.length > 0 ? current : [EMPTY_VALUES];
}

/**
 * Начата ли тренировка (§48.34): есть значение, введённое тренером, или подтверждённый подход; просмотр — не начало.
 * Предварительные значения после копирования недели (`origin = "COPY"`) без подтверждения тренировку не начинают.
 */
export function hasEnteredData(facts: Iterable<Readonly<{ values: SetValues; confirmed: boolean; origin?: "INPUT" | "COPY" | "IMPORT";
  sides?: Readonly<{ left: Readonly<{ values: SetValues }>; right: Readonly<{ values: SetValues }> }> | null }>>): boolean {
  const filled = (values: SetValues) => ALL_FIELDS.some((field) => values[field] !== null);
  for (const fact of facts) {
    if (fact.confirmed) return true;
    if (fact.origin === "COPY") continue;
    if (filled(fact.values)) return true;
    if (fact.sides && (filled(fact.sides.left.values) || filled(fact.sides.right.values))) return true;
  }
  return false;
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** Момент времени `YYYY-MM-DDTHH:MM:SS(.mmm)Z` (UTC), который можно разобрать. */
export const isInstant = (value: string): boolean => INSTANT.test(value) && !Number.isNaN(Date.parse(value));

/**
 * PC §48.86.10/13/17: длительность занятия в секундах — только при обеих отметках, где окончание позже начала; иначе `null`
 * («Нет данных», а не выдуманное значение). Исход тренировки на неё не влияет.
 */
export function sessionDurationSec(startedAt: string | null, finishedAt: string | null): number | null {
  if (startedAt === null || finishedAt === null || !isInstant(startedAt) || !isInstant(finishedAt)) return null;
  const seconds = (Date.parse(finishedAt) - Date.parse(startedAt)) / 1000;
  return seconds > 0 ? seconds : null;
}

/** Момент UTC из даты занятия `YYYY-MM-DD` и минут от начала суток по местному времени устройства (ручная правка отметок). */
export function instantFromLocal(date: string, minuteOfDay: number, addDays = 0): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, day + addDays, Math.floor(minuteOfDay / 60), minuteOfDay % 60).toISOString();
}

/** Минуты от начала суток по местному времени из момента UTC. */
export function localMinuteOfDay(instant: string): number {
  const date = new Date(instant);
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Окончание, выбранное по часам: если оно не позже начала, занятие шло через полночь — окончание на следующий день, но только когда
 * длительность не больше 12 часов; иначе (скорее опечатка) остаётся тот же день и пара считается невалидной («Нет данных» до правки).
 */
export function endInstantAfter(startedAt: string | null, date: string, minuteOfDay: number): string {
  const sameDay = instantFromLocal(date, minuteOfDay);
  if (startedAt === null || !isInstant(startedAt) || Date.parse(sameDay) > Date.parse(startedAt)) return sameDay;
  const nextDay = instantFromLocal(date, minuteOfDay, 1);
  return Date.parse(nextDay) - Date.parse(startedAt) <= 12 * 3600_000 ? nextDay : sameDay;
}

export function workoutStatus(outcome: WorkoutOutcome | null, started: boolean): WorkoutStatus {
  return outcome ?? (started ? "IN_PROGRESS" : "NOT_STARTED");
}

/** §48.38: повторное нажатие активного исхода снимает его, другой исход заменяет прежний. */
export function nextOutcome(current: WorkoutOutcome | null, pressed: WorkoutOutcome): WorkoutOutcome | null {
  return current === pressed ? null : pressed;
}

/** §48.26, §48.46: статус недели по статусам её тренировок. */
export function weekStatus(statuses: readonly WorkoutStatus[]): WeekStatus {
  if (statuses.length === 0) return "NOT_STARTED";
  if (statuses.every((status) => status === "COMPLETED")) return "COMPLETED";
  if (statuses.every((status) => status !== "NOT_STARTED" && status !== "IN_PROGRESS")) return "CLOSED_WITH_DEVIATIONS";
  return statuses.some((status) => status !== "NOT_STARTED") ? "IN_PROGRESS" : "NOT_STARTED";
}

/**
 * Порядок строк в дневнике: разминочные подходы — первыми, остальные в плановом порядке. Номер — у
 * каждого неразминочного подхода (обычный, отказной, дроп) по порядку; у разминки номера нет.
 */
export function displayOrder<T extends Readonly<{ setType: SetType }>>(sets: readonly T[]):
  readonly Readonly<{ item: T; number: number | null }>[] {
  const warmups = sets.filter((set) => set.setType === "WARMUP");
  const working = sets.filter((set) => set.setType !== "WARMUP");
  return [...warmups.map((item) => ({ item, number: null })), ...working.map((item, index) => ({ item, number: index + 1 }))];
}

/**
 * §37.11, §48.75: подход сопоставляется с прошлым по типу и номеру внутри своего типа; разминка не сдвигает
 * рабочие, недостающий подход остаётся без «Пред.», чужой тип не подставляется.
 */
export function matchPrevious<T>(current: readonly Readonly<{ plannedSetId: string; setType: SetType }>[],
  source: readonly Readonly<{ setType: SetType; value: T }>[]): ReadonlyMap<string, T> {
  const byType = new Map<SetType, T[]>();
  for (const set of source) byType.set(set.setType, [...(byType.get(set.setType) ?? []), set.value]);
  const used = new Map<SetType, number>();
  const result = new Map<string, T>();
  for (const set of current) {
    const ordinal = used.get(set.setType) ?? 0;
    used.set(set.setType, ordinal + 1);
    const match = byType.get(set.setType)?.[ordinal];
    if (match !== undefined) result.set(set.plannedSetId, match);
  }
  return result;
}

/**
 * «Пред.» по сторонам одностороннего подхода: засчитанные стороны прошлого подхода как есть; подход, записанный без сторон
 * (импорт из 2.0, упражнение стало односторонним позже), даёт своё значение обеим сторонам — иначе нажатие «Пред.» ничего не переносило.
 */
export function previousSides(previous: PreviousSet): Readonly<{ left: SetValues | null; right: SetValues | null }> {
  return previous.sides ?? { left: previous.values, right: previous.values };
}

/** «Пред.» для обычного (двустороннего) подхода: прошлый односторонний подход даёт значения первой засчитанной стороны. */
export function previousPlainValues(previous: PreviousSet): SetValues {
  return previous.sides === null ? previous.values : previous.sides.left ?? previous.sides.right ?? previous.values;
}

/** Локальная календарная дата `YYYY-MM-DD` (§48.84 п. 1). */
export function localDateOf(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export { isLocalDate };
