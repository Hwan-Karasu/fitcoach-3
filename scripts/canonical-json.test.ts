import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { canonicalJson } from "../apps/mobile/src/shared/training-transfer/CanonicalJson.ts";
import { workbookSheetHash } from "../apps/mobile/src/shared/training-transfer/WorkbookSheetIdentity.ts";
import { remapTrainingTransfer } from "../apps/mobile/src/app/composition/createTrainingTransfer.ts";
import { trainingTransferFixture } from "./training-transfer-fixture.ts";

// Эталоны сняты кодом до ускорения (сортировка ключей `localeCompare` на каждый объект) и не пересчитываются здесь:
// от них зависят сохранённые квитанции повторного импорта.
test("canonical text keeps the locale order of keys, skips undefined and hashes exactly as before", () => {
  const sample = { B: 1, a: 2, A: 3, b: 4, plannedSetId: "s", plannedExerciseId: "e", x: undefined, nested: [{ z: null, Z: 1, y: [1, { q: 2, Q: 3 }] }], "éa": 5, e: 6 };
  const text = canonicalJson(sample);
  assert.equal(text, '{"a":2,"A":3,"b":4,"B":1,"e":6,"éa":5,"nested":[{"y":[1,{"q":2,"Q":3}],"z":null,"Z":1}],"plannedExerciseId":"e","plannedSetId":"s"}');
  assert.equal(createHash("sha256").update(text).digest("hex"), "2747eba05c1457ab34bd8ef794123c72d4128d78beb01d125bcc886db8ae6318");
});

test("remembered key order does not leak between objects with the same keys in a different insertion order", () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalJson({ a: 2, b: 1 }), '{"a":2,"b":1}');
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalJson({ "a,b": 1, a: 2 }), '{"a":2,"a,b":1}');
});

test("sheet receipts and remapped ids are identical to those written by the previous version", () => {
  const transfer = trainingTransferFixture(); const cycle = transfer.programs[0]!.mesocycles[0]!;
  assert.equal(workbookSheetHash(cycle, transfer.sessions, { press: "target-press" }), "bb1f8f685ef0a57b88c69e8675013eeabc37fc313cb099f22907d7b792075b92");
  const remapped = remapTrainingTransfer(transfer, "client-local", { press: "target-press" });
  assert.deepEqual([remapped.programs[0]!.id, remapped.programs[0]!.mesocycles[0]!.weeks[0]!.workouts[0]!.id, remapped.sessions[0]!.facts[0]!.plannedSetId, remapped.sessions[1]!.id],
    ["c3171330-54f6-4f38-81d5-66b9c22e3907", "34fcf061-aad5-4e53-8b0e-c19b2513fdc4", "6657dfe2-5995-46b7-8982-6e3bf492199c", "22b31787-00bc-4098-8d27-121baad22456"]);
});
