import assert from "node:assert/strict";
import test from "node:test";
import { sheetSettle } from "../src/shared/ui/components/bottomSheetRules.ts";

// Высота листа 600 dp: порог по расстоянию — 180 dp, по скорости — 900 dp/с. Значения заданы из требования владельца
// («быстрый свайп закрывает, медленный и короткий — возвращает»), а не пересчитаны кодом.
test("BottomSheet: решение при отпускании ручки", () => {
  assert.equal(sheetSettle(0, 0, 600), "stay", "не двигали");
  assert.equal(sheetSettle(100, 100, 600), "stay", "короткий медленный сдвиг — лист возвращается");
  assert.equal(sheetSettle(180, 0, 600), "close", "ровно 30 % высоты — закрывается");
  assert.equal(sheetSettle(300, 50, 600), "close", "потянули далеко — закрывается");
  assert.equal(sheetSettle(40, 1200, 600), "close", "быстрый свайп закрывает даже после короткого сдвига");
  assert.equal(sheetSettle(5, 3000, 600), "stay", "касание ручки без сдвига не закрывает");
  assert.equal(sheetSettle(-80, -1500, 600), "stay", "вверх лист не тянется");
});
