import type { AnswerValue, Answers, QuestionField, QuestionnaireSchema } from "../domain/QuestionnaireModel.ts";
import { formatDateInput, parseDateInput, parseNumberInput } from "../domain/QuestionnaireRules.ts";

/** What the trainer is typing: numbers and dates stay text until they are checked. */
export type InputValue = string | boolean | readonly string[] | undefined;
export type FormInputs = Readonly<Record<string, InputValue>>;

export function inputFromAnswer(target: QuestionField, value: AnswerValue | undefined): InputValue {
  if (value === undefined) return undefined;
  if (typeof value === "number") return String(value).replace(".", ",");
  if (target.type === "DATE" && typeof value === "string") return formatDateInput(value);
  return value;
}

/** The raw answer for validation, or a marker when number/date text does not parse. */
export function answerFromInput(target: QuestionField, input: InputValue): unknown {
  if (input === undefined) return null;
  if (target.type === "NUMBER" && typeof input === "string") {
    const parsed = parseNumberInput(input);
    return parsed === "invalid" ? input : parsed;
  }
  if (target.type === "DATE" && typeof input === "string") {
    const parsed = parseDateInput(input);
    return parsed === "invalid" ? "invalid-date" : parsed;
  }
  return input;
}

/** Valid parsed answers only, for live conditional visibility while typing. */
export function answersFromInputs(schema: QuestionnaireSchema, inputs: FormInputs): Answers {
  const result: Record<string, AnswerValue> = {};
  for (const item of schema.sections) {
    for (const entry of item.fields) {
      const raw = answerFromInput(entry, inputs[entry.id]);
      if (raw === null || raw === "invalid-date" || (entry.type === "NUMBER" && typeof raw === "string")) continue;
      result[entry.id] = raw as AnswerValue;
    }
  }
  return result;
}
