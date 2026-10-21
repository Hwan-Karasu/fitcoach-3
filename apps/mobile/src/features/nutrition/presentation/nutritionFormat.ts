import type { MealSlot } from "../domain/DiaryModel.ts";
import { formatDecimalX10 } from "../domain/FoodRules.ts";
import type { FoodBasis, FoodBasisUnit, Nutrients } from "../domain/FoodModel.ts";
import type { RangeVerdict, TargetMetric, TargetRange } from "../domain/TargetModel.ts";
import type { StatusKind } from "../../../shared/ui/components/public.ts";

export const slotLabels: Readonly<Record<MealSlot, string>> = { BREAKFAST: "Завтрак", LUNCH: "Обед", DINNER: "Ужин", SNACK: "Перекус" };

export const metricLabels: Readonly<Record<TargetMetric, string>> = { kcal: "Ккал", protein: "Белки", fat: "Жиры", carbs: "Углеводы" };

export const unitLabels: Readonly<Record<FoodBasisUnit, string>> = { G: "г", ML: "мл", PIECE: "шт.", PORTION: "порц." };

/** Единицы в десятых → «1 800»; неизвестное — «—» (не ноль). Калории и граммы показываются целыми. */
export function wholeText(valueX10: number | null): string {
  if (valueX10 === null) return "—";
  return String(Math.round(valueX10 / 10)).replace(/\B(?=(\d{3})+(?!\d))/gu, " ");
}

export const kcalText = (nutrients: Nutrients): string => nutrients.kcalX10 === null ? "— ккал" : `${wholeText(nutrients.kcalX10)} ккал`;

/** «на 100 г» — основа продукта; порция — «на 1 порц.». */
export const basisText = (basis: FoodBasis): string => `на ${formatDecimalX10(basis.amountX10)} ${unitLabels[basis.unit]}`;

/** Количество записи: «50 г», «1,5 порц.». */
export const quantityText = (basis: FoodBasis, quantityX10: number): string => `${formatDecimalX10(quantityX10)} ${unitLabels[basis.unit]}`;

export const rangeText = (range: TargetRange | null): string | null =>
  range === null ? null : range.minX10 === range.maxX10 ? wholeText(range.minX10) : `${wholeText(range.minX10)}–${wholeText(range.maxX10)}`;

export const verdictLabels: Readonly<Record<RangeVerdict, string>> = { BELOW: "Ниже", IN: "В коридоре", ABOVE: "Выше", UNKNOWN: "" };
export const verdictKinds: Readonly<Record<RangeVerdict, StatusKind>> = { BELOW: "warning", IN: "success", ABOVE: "warning", UNKNOWN: "neutral" };

const pad = (value: number) => String(value).padStart(2, "0");

/** Сегодня по часам устройства, `YYYY-MM-DD`. */
export function todayLocal(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function shiftDate(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const weekdayNames = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const monthNames = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** «Сегодня, 20 октября» / «Вчера, 19 октября» / «вторник, 20 октября». */
export function dayTitle(localDate: string, today: string): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  const text = `${date.getUTCDate()} ${monthNames[date.getUTCMonth()]}`;
  if (localDate === today) return `Сегодня, ${text}`;
  if (localDate === shiftDate(today, -1)) return `Вчера, ${text}`;
  if (localDate === shiftDate(today, 1)) return `Завтра, ${text}`;
  return `${weekdayNames[date.getUTCDay()]}, ${text}`;
}

/** Ошибки хранилищ питания → понятный текст, без технических кодов. */
export function nutritionErrorText(error: unknown): string {
  switch (error instanceof Error ? error.message : "") {
    case "SAVED_MEAL_NAME_INVALID": return "Введите название набора (до 80 символов).";
    case "SAVED_MEAL_ITEMS_INVALID": return "В наборе должно быть от 1 до 50 позиций.";
    case "SAVED_MEAL_STALE": return "Набор уже изменён или удалён. Закройте редактор и откройте его заново.";
    case "FOOD_NAME_INVALID": return "Введите название (до 80 символов).";
    case "FOOD_BASIS_INVALID": return "Укажите, на какое количество даны значения: больше нуля.";
    case "FOOD_NUTRIENT_INVALID": return "Проверьте значения: они не могут быть отрицательными или слишком большими.";
    case "FOOD_NUTRIENTS_EMPTY": return "Заполните хотя бы одно значение: калории, белки, жиры или углеводы.";
    case "FOOD_BARCODE_INVALID": return "Штрихкод — от 4 до 32 цифр или букв, без пробелов.";
    case "FOOD_PIECE_MASS_INVALID": return "Масса одной штуки — число больше нуля, например 45.";
    case "PIECE_MASS_UNKNOWN": return "Масса одной штуки не указана: откройте продукт и заполните её, чтобы вводить штуки.";
    case "INVALID_PORTION": return "Количество должно быть больше нуля.";
    case "WATER_INVALID": return "Вода — от 1 до 20 000 мл.";
    case "DIARY_STALE": return "Запись уже изменилась. Дневник обновлён, повторите действие.";
    case "FOOD_STALE": return "Продукт уже изменён или скрыт. Откройте его заново.";
    case "DIARY_COMMAND_REUSED": return "Выбор изменился. Закройте подтверждение и попробуйте снова.";
    default: return "Не удалось сохранить. Данные не изменены.";
  }
}
