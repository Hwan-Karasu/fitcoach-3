import assert from "node:assert/strict";
import test from "node:test";
import { panelBottomPadding } from "../src/shared/ui/components/bottomPanelRules.ts";

test("REST-DOCK-2: системный нижний отступ учитывается один раз и убирается над клавиатурой", () => {
  assert.equal(panelBottomPadding(24, false), 28);
  assert.equal(panelBottomPadding(0, false), 4);
  assert.equal(panelBottomPadding(24, true), 4);
  assert.equal(panelBottomPadding(-5, false), 4);
});
