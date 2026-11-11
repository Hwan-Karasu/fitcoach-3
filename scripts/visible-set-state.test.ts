import assert from "node:assert/strict";
import test from "node:test";
import { fieldsOf } from "../apps/mobile/src/features/training/execution/domain/ExecutionRules.ts";
import type { SetFact, SetValues } from "../apps/mobile/src/features/training/execution/domain/ExecutionModel.ts";
import { draftKey, metricsOfFields, sameVisible, visibleConfirmation } from "../apps/mobile/src/features/training/execution/domain/VisibleSetState.ts";

// Ожидаемые значения — из требований §48.52/§48.55/§48.80 и жалобы владельца: «выполнен» виден сразу по тексту в ячейках,
// стирание обязательного поля снимает отметку сразу; без черновиков показывается ровно то, что в базе.
const FIELDS = ["reps", "loadGrams"] as const;
const values = (reps: number | null, loadGrams: number | null): SetValues => ({ reps, loadGrams, durationSec: null, distanceM: null });
const fact = (over: Partial<SetFact>): SetFact => ({ id: "f1", plannedSetId: "s1", plannedExerciseId: "e1", exerciseId: "x1", position: 1, setType: "NORMAL",
  values: values(null, null), drops: [], rpe: null, confirmed: false, sides: null, extra: false, origin: "TRAINER_INPUT", revision: 1, ...over } as SetFact);
const side = (v: SetValues, confirmed: boolean) => ({ values: v, confirmed, rpe: null });

test("метрики колонок дают те же поля, что и профиль упражнения", () => {
  for (const fields of [["reps", "loadGrams"], ["reps"], ["durationSec"], ["distanceM", "durationSec"], ["loadGrams", "reps", "durationSec"]] as const) {
    assert.deepEqual([...fieldsOf(metricsOfFields(fields))].sort(), [...fields].sort());
  }
});

test("без черновиков — ровно факт из базы", () => {
  const confirmed = fact({ values: values(10, 50_000), confirmed: true });
  assert.deepEqual(visibleConfirmation({ mode: "AUTO", fact: confirmed, fields: FIELDS, sided: false, drafts: {} }), { confirmed: true, left: false, right: false });
  assert.deepEqual(visibleConfirmation({ mode: "AUTO", fact: undefined, fields: FIELDS, sided: false, drafts: {} }), { confirmed: false, left: false, right: false });
});

test("AUTO: последняя недостающая ячейка сразу делает подход выполненным", () => {
  const partial = fact({ values: values(10, null) });
  const shown = visibleConfirmation({ mode: "AUTO", fact: partial, fields: FIELDS, sided: false, drafts: { [draftKey("S", "loadGrams")]: 60_000 } });
  assert.equal(shown.confirmed, true);
  // Подхода ещё нет в базе вовсе: вводим обе ячейки.
  const both = visibleConfirmation({ mode: "AUTO", fact: undefined, fields: FIELDS, sided: false,
    drafts: { [draftKey("S", "reps")]: 8, [draftKey("S", "loadGrams")]: 0 } });
  assert.equal(both.confirmed, true, "0 кг — заполнено");
});

test("AUTO и MANUAL: очистка обязательной ячейки сразу снимает «выполнен»", () => {
  const done = fact({ values: values(10, 50_000), confirmed: true });
  for (const mode of ["AUTO", "MANUAL"] as const) {
    assert.equal(visibleConfirmation({ mode, fact: done, fields: FIELDS, sided: false, drafts: { [draftKey("S", "reps")]: null } }).confirmed, false, mode);
  }
  assert.equal(visibleConfirmation({ mode: "AUTO", fact: done, fields: FIELDS, sided: false, drafts: { [draftKey("S", "reps")]: 12 } }).confirmed, true, "правка значения не снимает отметку");
});

test("MANUAL: полные значения сами подход не подтверждают", () => {
  const partial = fact({ values: values(10, null) });
  assert.equal(visibleConfirmation({ mode: "MANUAL", fact: partial, fields: FIELDS, sided: false, drafts: { [draftKey("S", "loadGrams")]: 60_000 } }).confirmed, false);
  const done = fact({ values: values(10, 50_000), confirmed: true });
  assert.equal(visibleConfirmation({ mode: "MANUAL", fact: done, fields: FIELDS, sided: false, drafts: { [draftKey("S", "loadGrams")]: 55_000 } }).confirmed, true, "уже подтверждённый остаётся подтверждённым");
});

test("односторонний: стороны считаются отдельно, подход выполнен, если выполнена любая", () => {
  const sides = { left: side(values(10, 50_000), true), right: side(values(10, null), false) };
  const base = fact({ confirmed: true, sides });
  assert.deepEqual(visibleConfirmation({ mode: "AUTO", fact: base, fields: FIELDS, sided: true, drafts: { [draftKey("R", "loadGrams")]: 50_000 } }),
    { confirmed: true, left: true, right: true }, "правая сторона дозаполнена");
  assert.deepEqual(visibleConfirmation({ mode: "AUTO", fact: base, fields: FIELDS, sided: true, drafts: { [draftKey("L", "reps")]: null } }),
    { confirmed: false, left: false, right: false }, "левую очистили, правая неполная — подход не выполнен");
});

test("дроп-сет не накладывается: решает ответ базы", () => {
  const drop = fact({ setType: "DROP", values: values(10, 50_000), drops: [values(8, null)], confirmed: false });
  assert.equal(visibleConfirmation({ mode: "AUTO", fact: drop, fields: FIELDS, sided: false, drafts: { [draftKey("S", "reps")]: 12 } }).confirmed, false);
});

test("sameVisible сравнивает по значению, null — другое состояние", () => {
  const a = { confirmed: true, left: false, right: false };
  assert.equal(sameVisible(a, { ...a }), true);
  assert.equal(sameVisible(null, a), false);
  assert.equal(sameVisible(a, { ...a, confirmed: false }), false);
});
