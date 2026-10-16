import assert from "node:assert/strict";
import test from "node:test";
import { parseNumericDraft } from "../apps/mobile/src/shared/ui/components/numeric-draft.ts";

test("decimal drafts accept comma and dot without changing the raw text", () => {
  assert.deepEqual(parseNumericDraft("82,5"), { kind: "valid", value: 82.5 });
  assert.deepEqual(parseNumericDraft("82.5"), { kind: "valid", value: 82.5 });
  assert.deepEqual(parseNumericDraft("0"), { kind: "valid", value: 0 });
  assert.deepEqual(parseNumericDraft(""), { kind: "empty" });
});

test("unfinished drafts stay distinguishable from invalid input", () => {
  for (const raw of ["-", ",", ".", "82,", "82."]) {
    assert.deepEqual(parseNumericDraft(raw), { kind: "incomplete" }, raw);
  }
  for (const raw of ["82,,5", "NaN", "Infinity", "1 200"]) {
    assert.deepEqual(parseNumericDraft(raw), { kind: "invalid" }, raw);
  }
});

test("integer policy rejects fractions", () => {
  assert.deepEqual(parseNumericDraft("12", "integer"), { kind: "valid", value: 12 });
  assert.deepEqual(parseNumericDraft("12,5", "integer"), { kind: "invalid" });
});
