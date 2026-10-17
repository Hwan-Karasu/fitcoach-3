import assert from "node:assert/strict";
import test from "node:test";
import { emojiFromInput } from "../apps/mobile/src/shared/ui/components/emojiInput.ts";

test("§7.8 эмодзи с клавиатуры: принимаются только смайлы, буквы и цифры — нет", () => {
  assert.equal(emojiFromInput("💪"), "💪");
  assert.equal(emojiFromInput(" 🏋️‍♂️ "), "🏋️‍♂️");
  assert.equal(emojiFromInput("❤️"), "❤️");
  assert.equal(emojiFromInput(""), null);
  assert.equal(emojiFromInput("a"), null);
  assert.equal(emojiFromInput("Д"), null);
  assert.equal(emojiFromInput("1"), null);
  assert.equal(emojiFromInput("💪a"), null);
  assert.equal(emojiFromInput("💪💪💪💪💪💪💪💪💪"), null, "длиннее 8 кодовых точек хранилище не примет");
});
