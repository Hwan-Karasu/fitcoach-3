import assert from "node:assert/strict";
import test from "node:test";
import { mesocycleBuilderDraftKey } from "../apps/mobile/src/features/training/plans/domain/PeriodizedDraft.ts";
import { templateCycles, templateOpensInBuilder, type TemplatePayload } from "../apps/mobile/src/features/training/plans/domain/TemplateModel.ts";

// TEMPLATE-OPEN-2: шаблон любого вида открывается в конструкторе; мезоциклы шаблона — циклы конструктора.
const cycle = (title: string, weeks: number) => ({ title, weeks: Array.from({ length: weeks }, () => ({ type: "base" as const, workouts: [] })) });

test("циклы шаблона: Простая — нет, Расширенная — все по порядку, Мезоцикл — один", () => {
  const simple: TemplatePayload = { kind: "SIMPLE", weeks: 4, workouts: [] };
  const periodized: TemplatePayload = { kind: "PERIODIZED", mesocycles: [cycle("Объём", 4), cycle("Сила", 6)] };
  const single: TemplatePayload = { kind: "MESOCYCLE", mesocycle: cycle("Волна", 10) };
  assert.deepEqual(templateCycles(simple), []);
  assert.deepEqual(templateCycles(periodized).map((item) => item.title), ["Объём", "Сила"]);
  assert.deepEqual(templateCycles(single).map((item) => [item.title, item.weeks.length]), [["Волна", 10]]);
});

test("нажатие на карточку открывает конструктор для любого вида, кроме пустой Расширенной", () => {
  assert.equal(templateOpensInBuilder({ kind: "SIMPLE", weeks: 4, workouts: [] }), true);
  assert.equal(templateOpensInBuilder({ kind: "MESOCYCLE", mesocycle: cycle("Волна", 10) }), true);
  assert.equal(templateOpensInBuilder({ kind: "PERIODIZED", mesocycles: [cycle("Объём", 4)] }), true);
  assert.equal(templateOpensInBuilder({ kind: "PERIODIZED", mesocycles: [] }), false);
});

test("TEMPLATE-EDIT ключ черновика правки шаблона свой и не пересекается с новой программой и программой клиента", () => {
  assert.equal(mesocycleBuilderDraftKey({ programId: null, mesocycleId: null }), "new:PERIODIZED");
  assert.equal(mesocycleBuilderDraftKey({ programId: null, mesocycleId: "template:t1" }), "builder:template:t1");
  assert.equal(mesocycleBuilderDraftKey({ programId: "p1", mesocycleId: "m1" }), "builder:p1:m1");
  assert.equal(mesocycleBuilderDraftKey({ programId: "p1", mesocycleId: null }), "builder:p1:add");
});
