import type { NutritionCalcPort } from "../domain/NutritionCalcPort.ts";

export type DayDataField = "weight" | "steps" | "workout";
export type WorkoutChoice = "NONE" | "YES" | "NO";
export type DayDataErrors = Partial<Record<DayDataField, string>>;

/** `null` у поля — оно не менялось и не записывается. */
export interface DayDataEdit {
  readonly localDate: string;
  readonly weight: string | null;
  readonly steps: string | null;
  readonly workout: WorkoutChoice | null;
}

export interface DayDataPorts {
  readonly clientId: string;
  readonly calc: NutritionCalcPort;
  /** Вес — факт Measurements: запись одного дневного значения (владелец — Measurements, поэтому функция приходит снаружи). */
  readonly recordWeight: (valueX10: number, localDate: string) => Promise<unknown>;
}

function failureText(failure: unknown): string {
  switch (failure instanceof Error ? failure.message : "") {
    case "MEASUREMENT_VALUE_INVALID": return "Вес вне допустимого диапазона (20–400 кг).";
    case "MEASUREMENT_DATE_INVALID": return "Замер не может быть в будущем.";
    case "MEASUREMENT_AMBIGUOUS_DAY": return "За эту дату несколько записей веса. Выберите основную в журнале замеров.";
    case "CALC_STEPS_INVALID": return "Шаги — от 1 до 100 000.";
    default: return "Не удалось сохранить. Данные не изменены.";
  }
}

/**
 * Данные дня клиента за дату: вес, шаги, отметка тренировки. Каждое значение — отдельная запись: пустое или неудачное поле не мешает остальным (решение владельца),
 * ошибка возвращается по полю. Пустые шаги очищают день («нет данных»), пустой вес не записывается (удаление веса — в журнале замеров).
 */
export async function saveDayData(ports: DayDataPorts, edit: DayDataEdit): Promise<DayDataErrors> {
  const errors: { -readonly [K in DayDataField]?: string } = {};
  const attempt = async (field: DayDataField, work: () => Promise<unknown>) => {
    try { await work(); } catch (failure) { errors[field] = failureText(failure); }
  };
  const weight = edit.weight?.trim().replace(",", ".") ?? "";
  if (weight !== "") {
    if (!/^\d{1,3}(\.\d)?$/u.test(weight)) errors.weight = "Вес — число с одним знаком после запятой, например 85,4.";
    else await attempt("weight", () => ports.recordWeight(Math.round(Number(weight) * 10), edit.localDate));
  }
  if (edit.steps !== null) {
    const steps = edit.steps.trim();
    if (steps === "") await attempt("steps", () => ports.calc.clearSteps(ports.clientId, edit.localDate));
    else if (!/^\d{1,6}$/u.test(steps)) errors.steps = "Шаги — целое число, например 8000.";
    else await attempt("steps", () => ports.calc.setSteps(ports.clientId, edit.localDate, Number(steps)));
  }
  if (edit.workout !== null) {
    const workout = edit.workout;
    await attempt("workout", () => workout === "NONE" ? ports.calc.clearWorkoutMark(ports.clientId, edit.localDate)
      : ports.calc.setWorkoutMark(ports.clientId, edit.localDate, workout === "YES"));
  }
  return errors;
}
