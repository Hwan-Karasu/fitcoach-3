import type { PaletteTokens } from "../../../../shared/ui/theme/resolver.ts";
import { formatDuration, parseDuration, parseLoad } from "../../plans/public.ts";
import type { SetType, SetValues, TrackingMetric, WeekStatus, WorkoutStatus } from "../domain/ExecutionModel.ts";
import { fieldsOf, type SetField } from "../domain/ExecutionRules.ts";

/** Порядок колонок дневника (§48.65 п. 1): повторы, затем вес; дистанция перед временем. */
const FIELD_ORDER: readonly SetField[] = ["reps", "loadGrams", "distanceM", "durationSec"];

export function diaryFields(metrics: readonly TrackingMetric[]): readonly SetField[] {
  const own = new Set(fieldsOf(metrics));
  return FIELD_ORDER.filter((field) => own.has(field));
}

export const fieldHeaders: Readonly<Record<SetField, string>> = { reps: "повт.", loadGrams: "кг", distanceM: "м", durationSec: "время" };

export const fieldNames: Readonly<Record<SetField, string>> = { reps: "Повторы", loadGrams: "Вес, кг", distanceM: "Метры", durationSec: "Время" };

export function rawOf(values: SetValues, field: SetField): string {
  const value = values[field];
  if (value === null) return "";
  if (field === "loadGrams") return String(value / 1000).replace(".", ",");
  if (field === "durationSec") return formatDuration(value);
  return String(value);
}

export function parseField(field: SetField, text: string): number | null | "invalid" {
  if (field === "loadGrams") return parseLoad(text);
  if (field === "durationSec") return parseDuration(text);
  const value = text.trim();
  if (value === "") return null;
  return /^\d+$/.test(value) ? Number(value) : "invalid";
}

/** Компактно для колонок «План» и «Пред.»: `8 × 60`; пусто — «—». */
export function compactValues(values: SetValues, fields: readonly SetField[]): string {
  const parts = fields.map((field) => values[field] === null ? null : rawOf(values, field)).filter((part) => part !== null);
  return parts.length === 0 ? "—" : parts.join(" × ");
}

/** Мини-сеты дроп-сета через « / », как в FitCoach 2.0: `8 × 100 / 6 × 80`. */
export function compactWithDrops(values: SetValues, drops: readonly SetValues[], fields: readonly SetField[]): string {
  return [values, ...drops].map((item) => compactValues(item, fields)).join(" / ");
}

export const setTypeLabels: Readonly<Record<SetType, string>> = {
  NORMAL: "Обычный", WARMUP: "Разминочный", FAILURE: "Отказной", DROP: "Дроп-сет",
};

/** Пояснение в окне выбора типа (§48.57–48.60). */
export const setTypeHints: Readonly<Record<SetType, string>> = {
  NORMAL: "Рабочий подход.",
  WARMUP: "Добавит разминочный подход в начало упражнения; плановые подходы не изменятся.",
  FAILURE: "Рабочий подход до отказа. Записывайте последнее полностью выполненное повторение.",
  DROP: "После отказа — продолжение с меньшим весом. Один подход: под ним строки мини-сетов.",
};

/** Цвет типа подхода из токенов темы; у обычного — без цвета. */
export function setTypeTone(type: SetType, colors: PaletteTokens): string | null {
  return type === "WARMUP" ? colors.warning : type === "FAILURE" ? colors.danger : type === "DROP" ? colors.charts[1] : null;
}

/** Цвет RPE: лёгкий — зелёный, средний — жёлтый, тяжёлый — красный. */
export function rpeTone(rpe: number, colors: PaletteTokens): string {
  return rpe <= 4 ? colors.success : rpe <= 7 ? colors.warning : colors.danger;
}

export const workoutStatusLabels: Readonly<Record<WorkoutStatus, string>> = {
  NOT_STARTED: "Не начата", IN_PROGRESS: "В работе", COMPLETED: "Завершена", MISSED: "Пропущена", CANCELLED: "Отменена",
};

export const weekStatusLabels: Readonly<Record<WeekStatus, string>> = {
  NOT_STARTED: "Не начата", IN_PROGRESS: "В работе", COMPLETED: "Завершена", CLOSED_WITH_DEVIATIONS: "Закрыта с отклонениями",
};

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** `2026-10-17` → «17 окт». */
export function shortDate(date: string): string {
  const [, month, day] = date.split("-").map(Number) as [number, number, number];
  return `${day} ${MONTHS[month - 1] ?? ""}`;
}
