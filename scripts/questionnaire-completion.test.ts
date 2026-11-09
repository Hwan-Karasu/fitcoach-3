import assert from "node:assert/strict";
import test from "node:test";
import { completionPercent } from "../apps/mobile/src/features/questionnaire/domain/QuestionnaireRules.ts";
import type { QuestionField, QuestionnaireSchema } from "../apps/mobile/src/features/questionnaire/domain/QuestionnaireModel.ts";

const field = (id: string, type: QuestionField["type"], over: Partial<QuestionField> = {}): QuestionField => ({
  id, origin: "CUSTOM", semanticKey: null, type, label: id, help: null, required: false, hidden: false, retired: false,
  options: [], visibleIf: null, constraints: null, ...over });
const schemaOf = (fields: readonly QuestionField[], hiddenSection = false): QuestionnaireSchema => ({ formatVersion: 1,
  sections: [{ id: "s", origin: "CUSTOM", title: "Раздел", help: null, hidden: hiddenSection, fields }] });

test("UIX-10: процент анкеты — заполнено ÷ все видимые вопросы (решение владельца), скрытые и убранные не считаются", () => {
  const schema = schemaOf([
    field("a", "SHORT_TEXT"), field("b", "NUMBER"), field("c", "SWITCH"),
    field("d", "SHORT_TEXT", { hidden: true }), field("e", "SHORT_TEXT", { retired: true }),
    field("f", "SHORT_TEXT", { visibleIf: { sourceFieldId: "c", operator: "EQUALS", value: "true" } }),
  ]);
  assert.equal(completionPercent(schema, {}), 0);
  assert.equal(completionPercent(schema, { a: "x", b: "   " }), 33, "пустая строка не ответ; видимых три: a, b, c");
  assert.equal(completionPercent(schema, { a: "x", c: true }), 50, "включённый переключатель открывает f: видимых четыре, ответов два");
  assert.equal(completionPercent(schema, { a: "x", c: false }), 67, "«нет» — тоже ответ; f скрыт");
  assert.equal(completionPercent(schema, { a: "x", b: 5, c: true, d: "скрытый", e: "убранный", f: "y" }), 100, "скрытые ответы не меняют процент");
});

test("UIX-10: нет видимых вопросов — 0, не деление на ноль", () => {
  assert.equal(completionPercent(schemaOf([field("a", "SHORT_TEXT")], true), { a: "x" }), 0);
  assert.equal(completionPercent(schemaOf([]), {}), 0);
});
