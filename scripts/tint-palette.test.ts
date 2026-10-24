import assert from "node:assert/strict";
import test from "node:test";
import { resolvePalette } from "../apps/mobile/src/shared/ui/theme/resolver.ts";
import { contrastRatio, tintPalette } from "../apps/mobile/src/shared/ui/theme/tintPalette.ts";

test("UI-OWN-039 цвет недели как тема: акцент — тон недели, текст на нём читаем, текст и статусы не меняются", () => {
  for (const themeId of ["sage-milk", "night-mocha"] as const) {
    const base = resolvePalette({ themeId, accentId: null }, "sage-milk").tokens;
    for (const tone of [base.danger, base.warning, base.success, base.charts[1]]) {
      const tinted = tintPalette(base, tone);
      assert.equal(tinted.accentFill, tone);
      assert.ok(contrastRatio(tinted.accentInk, tinted.accentSoft) >= 4.5);
      assert.ok(contrastRatio(tinted.onAccentFill, tinted.accentFill) >= 3, `${themeId} ${tone}: подпись на заливке читаема`);
      assert.deepEqual([tinted.textPrimary, tinted.textSecondary, tinted.danger, tinted.success],
        [base.textPrimary, base.textSecondary, base.danger, base.success]);
      assert.notEqual(tinted.canvas, base.canvas, "фон слегка окрашен");
    }
  }
});
