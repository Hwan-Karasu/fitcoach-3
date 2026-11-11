import { EMPTY_VALUES, type ConfirmationMode, type SetFact, type SetValues, type TrackingMetric } from "./ExecutionModel.ts";
import { confirmationAfterSave, type SetField } from "./ExecutionRules.ts";

/**
 * Видимое состояние «выполнен» строки подхода, посчитанное по тексту в ячейках, а не по ответу базы.
 * Раньше зелёная подсветка, обводка и запуск таймера появлялись только после записи (пауза 700 мс + транзакция),
 * а стирание значения снимало отметку так же поздно. Теперь экран использует те же правила, что и транзакция
 * (`confirmationAfterSave`), на значениях, которые пользователь уже ввёл; когда запись дошла и черновик больше не
 * ждёт записи, снова показывается факт из базы.
 */
export interface VisibleSetConfirmation {
  /** Подход выполнен (у одностороннего — хотя бы одна сторона). */
  readonly confirmed: boolean;
  readonly left: boolean;
  readonly right: boolean;
}

/**
 * Несохранённые значения ячеек строки: ключ `S:<поле>` — обычный подход, `L:<поле>` / `R:<поле>` — стороны; значение —
 * введённое число, `null` — ячейка очищена. Неверный ввод в черновик не попадает (в базу он тоже не уйдёт).
 */
export type RowDrafts = Readonly<Record<string, number | null>>;

export const draftKey = (side: "S" | "L" | "R", field: SetField): string => `${side}:${field}`;

const METRIC_OF_FIELD: Readonly<Record<SetField, TrackingMetric>> = { reps: "reps", loadGrams: "load", durationSec: "duration", distanceM: "distance" };

/** Поля колонок дневника → метрики профиля (обратное к `fieldsOf`): по ним считается та же полнота подхода, что в транзакции. */
export function metricsOfFields(fields: readonly SetField[]): readonly TrackingMetric[] {
  return fields.map((field) => METRIC_OF_FIELD[field]);
}

function stored(fact: SetFact | undefined): VisibleSetConfirmation {
  return { confirmed: fact?.confirmed === true, left: fact?.sides?.left.confirmed === true, right: fact?.sides?.right.confirmed === true };
}

function overlay(base: SetValues, side: "S" | "L" | "R", fields: readonly SetField[], drafts: RowDrafts): SetValues {
  let values = base;
  for (const field of fields) {
    const key = draftKey(side, field);
    if (key in drafts) values = { ...values, [field]: drafts[key] ?? null };
  }
  return values;
}

/**
 * Что показывать у строки. Без черновиков — ровно то, что в базе. Дроп-сет не накладывается: его мини-сеты правятся своими
 * ячейками и подтверждаются по ответу базы.
 */
export function visibleConfirmation(input: Readonly<{
  mode: ConfirmationMode;
  fact: SetFact | undefined;
  fields: readonly SetField[];
  sided: boolean;
  drafts: RowDrafts;
}>): VisibleSetConfirmation {
  const { mode, fact, fields, sided, drafts } = input;
  const base = stored(fact);
  if (Object.keys(drafts).length === 0 || fact?.setType === "DROP") return base;
  const metrics = metricsOfFields(fields);
  if (!sided) {
    const change = confirmationAfterSave(mode, base.confirmed, { setType: fact?.setType ?? "NORMAL", values: overlay(fact?.values ?? EMPTY_VALUES, "S", fields, drafts), drops: fact?.drops ?? [] }, metrics);
    return { confirmed: change.confirmed, left: false, right: false };
  }
  const side = (which: "L" | "R", was: boolean, values: SetValues | undefined): boolean => confirmationAfterSave(mode, was,
    { setType: "NORMAL", values: overlay(values ?? EMPTY_VALUES, which, fields, drafts), drops: [] }, metrics).confirmed;
  const left = side("L", base.left, fact?.sides?.left.values);
  const right = side("R", base.right, fact?.sides?.right.values);
  return { confirmed: left || right, left, right };
}

export const sameVisible = (a: VisibleSetConfirmation | null, b: VisibleSetConfirmation): boolean =>
  a !== null && a.confirmed === b.confirmed && a.left === b.left && a.right === b.right;
