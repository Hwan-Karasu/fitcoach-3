import assert from "node:assert/strict";
import test from "node:test";
import { participantChipLayout } from "../apps/mobile/src/features/training/plans/domain/ParticipantGroupState.ts";

// Ожидаемые значения — из геометрии: карточка 150 dp, зазор 4 dp; полоса телефона ~370 dp (скриншот владельца: 2 участника, справа пусто).
test("UIX-FIT-12: два участника при полосе 370 dp делят ширину поровну (ряд симметричен, справа не пусто)", () => {
  assert.equal(participantChipLayout(370, 2, 150, 4), "fill");
});

test("UIX-FIT-12: три карточки (3×150 + 2×4 = 458) на полосу 370 не помещаются — прокрутка, как раньше", () => {
  assert.equal(participantChipLayout(370, 3, 150, 4), "scroll");
  assert.equal(participantChipLayout(370, 5, 150, 4), "scroll");
});

test("UIX-FIT-12: граница — ровно помещаются (2×150 + 4 = 304)", () => {
  assert.equal(participantChipLayout(304, 2, 150, 4), "fill");
  assert.equal(participantChipLayout(303, 2, 150, 4), "scroll");
});

test("UIX-FIT-12: до измерения ширины и без участников — прокрутка (карточки не растягиваются на неизвестную ширину)", () => {
  assert.equal(participantChipLayout(0, 2, 150, 4), "scroll");
  assert.equal(participantChipLayout(370, 0, 150, 4), "scroll");
});
